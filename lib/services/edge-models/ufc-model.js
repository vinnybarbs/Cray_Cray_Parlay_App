// lib/services/edge-models/ufc-model.js
//
// UFC fight edge model, first working cut.
//
// The core edge calculator prices team sports from records and standings.
// Fighters have neither, so every UFC game failed its data bail and no UFC
// pick ever published. This module prices a two way fight market instead.
//
// What it does today:
//   1. Market only baseline. Devigs each book's h2h pair, takes the median
//      fair probability across books, and compares it to the devigged
//      reference book pair the pipeline would actually bet into.
//   2. Optional ratings blend. When a ratings provider is supplied and both
//      fighters have enough rated fights, an Elo style probability is
//      blended into the market prior at a capped weight. The provider can
//      be absent or return null and the market baseline stands alone.
//
// The return shape mirrors EdgeCalculator.calculateEdge so pickBestSide,
// edgeScoreFromCalc, buildPickText, and the game_analysis upsert consume it
// unchanged. Spread and total keys are always null because UFC settlement
// grades moneyline only. Design doc: docs/models/ufc-edge-model.md

'use strict';

// Same defensive cap as the core calculator. Real double digit edges in a
// mature market are close to nonexistent, so anything larger is treated as
// model error and clamped.
const MAX_EDGE = 0.15;

// Elo logistic scale. Standard chess constant, also used by the public UFC
// Elo implementations this design references.
const ELO_SCALE = 400;

// Ratings blend controls. Below MIN_RATED_FIGHTS on either side the blend
// weight is zero. The weight ramps at WEIGHT_PER_FIGHT per rated fight of
// the less experienced fighter and never exceeds MAX_RATINGS_WEIGHT, so the
// market stays the majority prior at any sample size.
const MIN_RATED_FIGHTS = 3;
const WEIGHT_PER_FIGHT = 0.05;
const MAX_RATINGS_WEIGHT = 0.35;

// Book preferred for the implied probability the edge is measured against.
// Matches the pipeline, which bets DraftKings prices when available.
const DEFAULT_REFERENCE_BOOK = 'draftkings';

// ---------------------------------------------------------------------------
// Pure math helpers (exported for tests and reuse)
// ---------------------------------------------------------------------------

/**
 * American price to raw implied probability.
 * -180 gives 0.6429, +150 gives 0.4000.
 * Returns null for anything that is not a valid American price.
 */
function americanToProb(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || Math.abs(p) < 100) return null;
  return p < 0 ? Math.abs(p) / (Math.abs(p) + 100) : 100 / (p + 100);
}

/**
 * Multiplicative devig of a two way pair of American prices.
 * Returns { probA, probB, overround } or null when either price is invalid.
 * probA + probB always equals 1. Overround is the book margin, for example
 * 0.045 on a standard -110 / -110 pair.
 */
function devigTwoWay(priceA, priceB) {
  const rawA = americanToProb(priceA);
  const rawB = americanToProb(priceB);
  if (rawA == null || rawB == null) return null;
  const total = rawA + rawB;
  if (total <= 0) return null;
  return {
    probA: rawA / total,
    probB: rawB / total,
    overround: total - 1,
  };
}

/** Median of a numeric array. Returns null on empty input. */
function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Consensus fair probability across books.
 * Input: array of { bookmaker, homePrice, awayPrice }.
 * Output: { homeFair, awayFair, avgOverround, books, perBook } or null when
 * no book has a complete valid pair. Median across books, so one stale book
 * cannot drag the consensus.
 */
function consensusFairProb(pairs) {
  if (!Array.isArray(pairs)) return null;
  const perBook = [];
  for (const pair of pairs) {
    if (!pair) continue;
    const devig = devigTwoWay(pair.homePrice, pair.awayPrice);
    if (!devig) continue;
    perBook.push({
      bookmaker: pair.bookmaker || 'unknown',
      homeFair: devig.probA,
      awayFair: devig.probB,
      overround: devig.overround,
    });
  }
  if (perBook.length === 0) return null;
  const homeFair = median(perBook.map((b) => b.homeFair));
  const avgOverround = perBook.reduce((s, b) => s + b.overround, 0) / perBook.length;
  return {
    homeFair,
    awayFair: 1 - homeFair,
    avgOverround,
    books: perBook.length,
    perBook,
  };
}

/**
 * Elo logistic win probability for the home slot fighter.
 * P(home) = 1 / (1 + 10^((ratingAway - ratingHome) / scale))
 */
function eloWinProbability(ratingHome, ratingAway, scale = ELO_SCALE) {
  if (ratingHome == null || ratingAway == null) return null;
  const rh = Number(ratingHome);
  const ra = Number(ratingAway);
  if (!Number.isFinite(rh) || !Number.isFinite(ra)) return null;
  return 1 / (1 + Math.pow(10, (ra - rh) / scale));
}

/**
 * Blend weight for the ratings probability, driven by the smaller of the two
 * fighters' rated fight counts. Zero under MIN_RATED_FIGHTS, then a linear
 * ramp capped at MAX_RATINGS_WEIGHT.
 */
function ratingsWeight(fightsHome, fightsAway, opts = {}) {
  const minFights = Math.min(Number(fightsHome) || 0, Number(fightsAway) || 0);
  const floor = opts.minBlendFights ?? MIN_RATED_FIGHTS;
  const cap = opts.maxRatingsWeight ?? MAX_RATINGS_WEIGHT;
  const perFight = opts.weightPerFight ?? WEIGHT_PER_FIGHT;
  if (minFights < floor) return 0;
  return Math.min(cap, perFight * minFights);
}

/**
 * Convex blend of the market prior and the ratings probability.
 * weight 0 returns the market prior untouched.
 */
function blendProbabilities(marketProb, ratingsProb, weight) {
  if (ratingsProb == null || !weight) return marketProb;
  const w = Math.max(0, Math.min(1, weight));
  return w * ratingsProb + (1 - w) * marketProb;
}

// ---------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------

const normName = (s) => (s || '').toString().trim().toLowerCase();

/**
 * Extract { bookmaker, homePrice, awayPrice } pairs from a fight context.
 * Accepts, in order of preference:
 *   1. fight.books: array of { bookmaker, outcomes: [{name, price}] } rows
 *      (one odds_cache h2h row per book), or pre-shaped
 *      { bookmaker, homePrice, awayPrice } objects.
 *   2. fight.markets.h2h: the single book shape the rest of the pipeline
 *      already builds (outcomes array with fighter names).
 * Fighter names are matched case insensitively against home_team and
 * away_team.
 */
function extractBookPairs(fight) {
  if (!fight) return [];
  const home = normName(fight.home_team);
  const away = normName(fight.away_team);
  const pairs = [];

  const fromOutcomes = (bookmaker, outcomes) => {
    if (!Array.isArray(outcomes)) return null;
    const h = outcomes.find((o) => normName(o && o.name) === home);
    const a = outcomes.find((o) => normName(o && o.name) === away);
    if (!h || !a) return null;
    return { bookmaker, homePrice: h.price, awayPrice: a.price };
  };

  if (Array.isArray(fight.books)) {
    for (const book of fight.books) {
      if (!book) continue;
      if (book.homePrice != null && book.awayPrice != null) {
        pairs.push({
          bookmaker: book.bookmaker || 'unknown',
          homePrice: book.homePrice,
          awayPrice: book.awayPrice,
        });
        continue;
      }
      const pair = fromOutcomes(book.bookmaker || 'unknown', book.outcomes);
      if (pair) pairs.push(pair);
    }
  }

  if (pairs.length === 0 && fight.markets && Array.isArray(fight.markets.h2h)) {
    const pair = fromOutcomes(fight.bookmaker || 'unknown', fight.markets.h2h);
    if (pair) pairs.push(pair);
  }

  return pairs;
}

/** Pick the reference pair the edge is measured against. */
function pickReferencePair(pairs, referenceBook) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const ref = normName(referenceBook || DEFAULT_REFERENCE_BOOK);
  return pairs.find((p) => normName(p.bookmaker) === ref) || pairs[0];
}

// ---------------------------------------------------------------------------
// Ratings interface
// ---------------------------------------------------------------------------

/**
 * Fetch both fighters from the optional ratings provider.
 * Provider contract: async getFighter(name) returning
 * { rating, fights, lastFightDate } or null.
 * Any error or missing data returns null so ratings problems can never
 * break the market baseline.
 */
async function fetchRatings(ratings, homeName, awayName) {
  if (!ratings || typeof ratings.getFighter !== 'function') return null;
  try {
    const [home, away] = await Promise.all([
      ratings.getFighter(homeName),
      ratings.getFighter(awayName),
    ]);
    if (!home || !away) return null;
    if (!Number.isFinite(Number(home.rating)) || !Number.isFinite(Number(away.rating))) return null;
    return { home, away };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Compute per side moneyline edges for a UFC fight.
 *
 * @param {object} fight    { home_team, away_team, books?, markets?, commence_time? }
 * @param {object} options  {
 *   ratings?: { getFighter(name) },   optional ratings provider
 *   calibrationMultiplier?: number,   edge_calibration value for 'UFC:ml', default 1
 *   referenceBook?: string,           default 'draftkings'
 *   maxEdge?: number,                 default 0.15
 * }
 * @returns {object|null} edge result in the EdgeCalculator.calculateEdge
 *   shape, or null when both sides cannot be priced from at least one book.
 */
async function computeUfcEdge(fight, options = {}) {
  if (!fight || !fight.home_team || !fight.away_team) return null;

  const pairs = extractBookPairs(fight);
  const consensus = consensusFairProb(pairs);
  if (!consensus) return null;

  const refPair = pickReferencePair(pairs, options.referenceBook);
  const refDevig = devigTwoWay(refPair.homePrice, refPair.awayPrice);
  if (!refDevig) return null;
  const impliedHomeProb = refDevig.probA;
  const impliedAwayProb = refDevig.probB;

  // Ratings blend. Weight stays zero without a provider or enough sample.
  const rated = await fetchRatings(options.ratings, fight.home_team, fight.away_team);
  let ratingsProb = null;
  let weight = 0;
  if (rated) {
    ratingsProb = eloWinProbability(rated.home.rating, rated.away.rating);
    weight = ratingsWeight(rated.home.fights, rated.away.fights, options);
    if (ratingsProb == null) weight = 0;
  }

  let homeWinProb = blendProbabilities(consensus.homeFair, ratingsProb, weight);
  // No certainties, same clamp as the core calculator.
  homeWinProb = Math.max(0.02, Math.min(0.98, homeWinProb));
  const awayWinProb = 1 - homeWinProb;

  const adjustments = [];
  if (weight > 0) {
    const impact = homeWinProb - consensus.homeFair;
    adjustments.push({
      factor: 'Fighter ratings blend',
      impact: parseFloat(impact.toFixed(4)),
      detail: `Elo prob ${(ratingsProb * 100).toFixed(1)}% at weight ${weight.toFixed(2)} over market ${(consensus.homeFair * 100).toFixed(1)}%`,
    });
  }

  // Edges. Raw first, then calibration multiplier, then the hard cap.
  const maxEdge = options.maxEdge ?? MAX_EDGE;
  const calMult = Number.isFinite(Number(options.calibrationMultiplier))
    ? Number(options.calibrationMultiplier)
    : 1;
  const clamp = (e) => Math.max(-maxEdge, Math.min(maxEdge, e));

  const round4 = (x) => (x == null ? null : parseFloat(x.toFixed(4)));
  const round2 = (x) => (x == null ? null : parseFloat(x.toFixed(2)));

  const homeMlEdgeRaw = homeWinProb - impliedHomeProb;
  const awayMlEdgeRaw = awayWinProb - impliedAwayProb;
  // Round before the legacy scalar tie break. The two sides are exact
  // negations in theory, and rounding keeps floating point noise from
  // flipping which one wins the magnitude comparison.
  const homeMlEdge = round4(clamp(homeMlEdgeRaw * calMult));
  const awayMlEdge = round4(clamp(awayMlEdgeRaw * calMult));

  // Legacy scalars, kept for callers that read edge and edgeSide directly.
  let edge;
  let edgeSide;
  if (Math.abs(homeMlEdge) >= Math.abs(awayMlEdge)) {
    edge = homeMlEdge;
    edgeSide = homeMlEdge >= 0 ? 'home' : 'away';
  } else {
    edge = awayMlEdge;
    edgeSide = awayMlEdge >= 0 ? 'away' : 'home';
  }
  const edgePercent = Math.abs(edge) * 100;

  // Confidence. Market only output is low confidence by design. The blend
  // lifts it to medium, and high needs both a real ratings weight and three
  // or more books, which today's two book feed cannot reach.
  let confidence = 'low';
  if (weight > 0 && consensus.books >= 2) confidence = 'medium';
  if (weight >= 0.25 && consensus.books >= 3) confidence = 'high';

  return {
    homeWinProb: round4(homeWinProb),
    awayWinProb: round4(awayWinProb),
    impliedHomeProb: round4(impliedHomeProb),
    impliedAwayProb: round4(impliedAwayProb),
    edge,
    edgeSide,
    edgePercent: round2(edgePercent),
    // Per side signed edges, positive is value, negative is a trap read.
    // Spread and total stay null: UFC settlement grades moneyline only.
    edges: {
      home_ml: round4(homeMlEdge),
      away_ml: round4(awayMlEdge),
      home_spread: null,
      away_spread: null,
      over: null,
      under: null,
    },
    // Pre calibration, pre cap values for the calibration loop.
    edgesRaw: {
      home_ml: round4(homeMlEdgeRaw),
      away_ml: round4(awayMlEdgeRaw),
      home_spread: null,
      away_spread: null,
      over: null,
      under: null,
    },
    modelMargin: null,
    market: { homeSpread: null, awaySpread: null },
    factors: {
      marketConsensus: {
        books: consensus.books,
        homeFairProb: round4(consensus.homeFair),
        awayFairProb: round4(consensus.awayFair),
        avgOverround: round4(consensus.avgOverround),
        referenceBook: refPair.bookmaker,
        perBook: consensus.perBook.map((b) => ({
          bookmaker: b.bookmaker,
          homeFair: round4(b.homeFair),
          overround: round4(b.overround),
        })),
      },
      ratings: rated
        ? {
            home: { rating: Number(rated.home.rating), fights: Number(rated.home.fights) || 0 },
            away: { rating: Number(rated.away.rating), fights: Number(rated.away.fights) || 0 },
            ratingsProb: round4(ratingsProb),
            weight: round4(weight),
          }
        : null,
      calibrationMultiplier: calMult,
    },
    adjustments,
    confidence,
    dataQuality: {
      books: consensus.books,
      hasConsensus: true,
      hasRatings: weight > 0,
      ratedFights: rated
        ? { home: Number(rated.home.fights) || 0, away: Number(rated.away.fights) || 0 }
        : null,
    },
  };
}

module.exports = {
  computeUfcEdge,
  // Pure helpers exported for tests and future models.
  americanToProb,
  devigTwoWay,
  consensusFairProb,
  eloWinProbability,
  ratingsWeight,
  blendProbabilities,
  extractBookPairs,
  median,
  MAX_EDGE,
  MIN_RATED_FIGHTS,
  MAX_RATINGS_WEIGHT,
};
