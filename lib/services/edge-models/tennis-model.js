// lib/services/edge-models/tennis-model.js
//
// TRUE TENNIS EDGE MODEL, first cut.
//
// Tennis never graded through edge-calculator because that model is built on
// team records and standings that do not exist for player vs player sports.
// This module replaces the team-record probability with two tennis-native
// signals and returns the exact result shape edge-calculator produces, so
// pickBestSide, edgeScoreFromCalc, pick-grader tiers, and the publication
// gate in pre-analyze-games.js all work unchanged.
//
// Signals:
//   1. Market consensus (works today, no ratings data needed). Devig each
//      book's two-way moneyline, take the median fair probability across
//      books, and compare it to the fair probability at the book we would
//      actually bet. A book priced off consensus is the edge.
//   2. Surface Elo (optional, behind a data interface). When a ratings
//      provider is supplied and returns ratings for both players, the Elo
//      win probability is blended into the market prior at a configurable
//      weight. When ratings are absent the model degrades cleanly to the
//      market-only baseline.
//
// Design notes live in docs/models/tennis-edge-model.md.

'use strict';

// Hard cap on any published edge, same value as edge-calculator's MAX_EDGE.
const MAX_EDGE = 0.15;

// Default weight of the Elo signal in the blend. Research is consistent that
// closing odds carry most of the predictive information in tennis, so the
// market stays the senior partner until calibration proves the Elo term out.
const DEFAULT_ELO_WEIGHT = 0.30;

// Weight of the surface-specific rating inside the effective Elo.
// Tennis Abstract blends overall and surface Elo about evenly.
const DEFAULT_SURFACE_BLEND = 0.50;

// Fatigue: matches above this count in the trailing 14 days start costing
// probability, at FATIGUE_STEP per extra match, capped at FATIGUE_CAP.
const FATIGUE_FREE_MATCHES = 4;
const FATIGUE_STEP = 0.005;
const FATIGUE_CAP = 0.02;

// ---------------------------------------------------------------------------
// Pure odds math
// ---------------------------------------------------------------------------

/**
 * American price to raw implied probability. -180 gives 0.6429, +150 gives 0.4.
 * Returns null for junk input.
 */
function americanToProb(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || p === 0) return null;
  return p > 0 ? 100 / (p + 100) : Math.abs(p) / (Math.abs(p) + 100);
}

/**
 * Multiplicative (proportional) devig of a two-way market.
 * Returns { home, away } fair probabilities summing to 1, or null.
 */
function devigMultiplicative(rawHome, rawAway) {
  if (rawHome == null || rawAway == null) return null;
  const total = rawHome + rawAway;
  if (!(total > 0)) return null;
  return { home: rawHome / total, away: rawAway / total };
}

/**
 * Power devig of a two-way market. Solves for k such that
 * rawHome^k + rawAway^k = 1, then returns the powered probabilities.
 *
 * Why: multiplicative devig strips the overround proportionally, which
 * overstates the longshot in lopsided matches (favorite-longshot bias).
 * Tennis prices routinely reach -500 and beyond, so the correction matters
 * here more than in team sports. Power devig shifts more of the vig removal
 * onto the longshot side.
 */
function devigPower(rawHome, rawAway) {
  if (rawHome == null || rawAway == null) return null;
  if (!(rawHome > 0) || !(rawAway > 0) || rawHome >= 1 || rawAway >= 1) {
    return devigMultiplicative(rawHome, rawAway);
  }
  const sumAt = (k) => Math.pow(rawHome, k) + Math.pow(rawAway, k);
  // Bisection on k. sumAt is strictly decreasing in k for probs in (0,1).
  let lo = 0.25, hi = 8;
  if (sumAt(lo) < 1 || sumAt(hi) > 1) {
    // Degenerate market, fall back rather than extrapolate.
    return devigMultiplicative(rawHome, rawAway);
  }
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (sumAt(mid) > 1) lo = mid; else hi = mid;
  }
  const k = (lo + hi) / 2;
  const home = Math.pow(rawHome, k);
  const away = Math.pow(rawAway, k);
  const total = home + away;
  return { home: home / total, away: away / total };
}

function devigPair(rawHome, rawAway, method) {
  return method === 'multiplicative'
    ? devigMultiplicative(rawHome, rawAway)
    : devigPower(rawHome, rawAway);
}

function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Consensus fair probability across books.
 *
 * books: [{ bookmaker, home_price, away_price }]
 * Returns { homeProb, awayProb, booksUsed, perBook } or null when no book
 * has both sides priced. perBook keeps each book's fair home probability so
 * callers can surface which book is off market.
 */
function consensusFromBooks(books, { devigMethod = 'power' } = {}) {
  if (!Array.isArray(books) || books.length === 0) return null;
  const perBook = [];
  for (const b of books) {
    if (!b) continue;
    const rawHome = americanToProb(b.home_price);
    const rawAway = americanToProb(b.away_price);
    const fair = devigPair(rawHome, rawAway, devigMethod);
    if (!fair) continue;
    perBook.push({ bookmaker: b.bookmaker || 'unknown', homeFair: fair.home, awayFair: fair.away });
  }
  if (perBook.length === 0) return null;
  const homeProb = median(perBook.map((p) => p.homeFair));
  return { homeProb, awayProb: 1 - homeProb, booksUsed: perBook.length, perBook };
}

// ---------------------------------------------------------------------------
// Elo math
// ---------------------------------------------------------------------------

/**
 * Standard Elo win expectancy for the first player.
 */
function eloWinProb(ratingHome, ratingAway) {
  if (!Number.isFinite(ratingHome) || !Number.isFinite(ratingAway)) return null;
  return 1 / (1 + Math.pow(10, (ratingAway - ratingHome) / 400));
}

/**
 * Blend a player's overall and surface Elo into one effective rating.
 * rating: { elo, surfaceElo } where surfaceElo may be null.
 */
function effectiveElo(rating, surfaceBlend = DEFAULT_SURFACE_BLEND) {
  if (!rating || !Number.isFinite(rating.elo)) return null;
  if (!Number.isFinite(rating.surfaceElo)) return rating.elo;
  return (1 - surfaceBlend) * rating.elo + surfaceBlend * rating.surfaceElo;
}

/**
 * Invert a best-of-3 match win probability into an implied per-set win
 * probability. Model: independent sets, match prob m = s^2 * (3 - 2s).
 * Solved by bisection because the cubic has one root in [0, 1].
 */
function setProbFromBo3(matchProb) {
  if (!Number.isFinite(matchProb)) return null;
  if (matchProb <= 0) return 0;
  if (matchProb >= 1) return 1;
  const f = (s) => s * s * (3 - 2 * s);
  let lo = 0, hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < matchProb) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Best-of-5 match win probability from a per-set win probability.
 * P(win 3 of 5 first) = s^3 * (10 - 15s + 6s^2).
 */
function bo5FromSetProb(s) {
  if (!Number.isFinite(s)) return null;
  return s * s * s * (10 - 15 * s + 6 * s * s);
}

/**
 * Rescale a best-of-3 match probability to the requested format.
 * Elo ratings are fit mostly on best-of-3 tour matches, so treat the raw Elo
 * expectancy as a best-of-3 number. Slams (best of 5, ATP only) compress
 * variance and favorites win more often. Historically slam favorites win at
 * roughly 78 percent against 68 percent at best-of-3 events, and the set
 * inversion below reproduces that direction without a fitted fudge factor.
 */
function bestOfAdjust(matchProbBo3, bestOf) {
  if (!Number.isFinite(matchProbBo3)) return null;
  if (bestOf !== 5) return matchProbBo3;
  return bo5FromSetProb(setProbFromBo3(matchProbBo3));
}

// ---------------------------------------------------------------------------
// Input adapters
// ---------------------------------------------------------------------------

/**
 * Build the books array from raw odds_cache rows for one match.
 * Rows look like { bookmaker, market_type, outcomes: [{ name, price }] }.
 * Only h2h rows are used. Rows missing either player's price are skipped.
 */
function booksFromOddsRows(rows, homeName, awayName) {
  if (!Array.isArray(rows)) return [];
  const books = [];
  for (const row of rows) {
    if (!row || row.market_type !== 'h2h' || !Array.isArray(row.outcomes)) continue;
    const home = row.outcomes.find((o) => o && o.name === homeName);
    const away = row.outcomes.find((o) => o && o.name === awayName);
    if (!home || !away || home.price == null || away.price == null) continue;
    books.push({ bookmaker: row.bookmaker, home_price: home.price, away_price: away.price });
  }
  return books;
}

// ---------------------------------------------------------------------------
// Ratings interface
// ---------------------------------------------------------------------------

/**
 * Fetch ratings for both players through the injected provider. The provider
 * contract is one method:
 *
 *   getRating({ name, tour, surface }) ->
 *     { elo, surfaceElo, matchesLast14, lastMatchDate } | null
 *
 * The method may be sync or async. Any provider error is swallowed and
 * treated as "no ratings", because a ratings outage must never stop the
 * market-only baseline from grading.
 */
async function fetchRatings(provider, homeName, awayName, tour, surface) {
  if (!provider || typeof provider.getRating !== 'function') return { home: null, away: null };
  try {
    const [home, away] = await Promise.all([
      provider.getRating({ name: homeName, tour, surface }),
      provider.getRating({ name: awayName, tour, surface }),
    ]);
    return { home: home || null, away: away || null };
  } catch {
    return { home: null, away: null };
  }
}

/**
 * Fatigue penalty in probability points for one player. Zero when the match
 * count is missing or within the free allowance.
 */
function fatiguePenalty(matchesLast14) {
  if (!Number.isFinite(matchesLast14)) return 0;
  const extra = Math.max(0, matchesLast14 - FATIGUE_FREE_MATCHES);
  return Math.min(FATIGUE_CAP, extra * FATIGUE_STEP);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const round4 = (x) => (x == null ? null : parseFloat(x.toFixed(4)));
const round2 = (x) => (x == null ? null : parseFloat(x.toFixed(2)));
const clampEdge = (e) => (e == null ? null : Math.max(-MAX_EDGE, Math.min(MAX_EDGE, e)));

/**
 * Calculate the tennis edge for one match.
 *
 * context:
 *   home_player  string (also accepts home_team)
 *   away_player  string (also accepts away_team)
 *   books        [{ bookmaker, home_price, away_price }]  American prices
 *   best_of      3 or 5, defaults to 3
 *   surface      'hard' | 'clay' | 'grass' | null
 *   tour         'atp' | 'wta' | null
 *
 * options:
 *   ratings                ratings provider, see fetchRatings
 *   eloWeight              blend weight of the Elo signal, default 0.30
 *   surfaceBlend           surface share of effective Elo, default 0.50
 *   devigMethod            'power' (default) or 'multiplicative'
 *   betBookmaker           book whose price the pick would take, default 'draftkings'
 *   calibrationMultiplier  reliability multiplier from edge_calibration, default 1
 *
 * Returns the edge-calculator result shape, or null when no book has both
 * players priced. Spread and total keys are present but null, phase 1 is
 * moneyline only.
 */
async function calculateTennisEdge(context, options = {}) {
  if (!context) return null;
  const homeName = context.home_player || context.home_team;
  const awayName = context.away_player || context.away_team;
  if (!homeName || !awayName) return null;

  const devigMethod = options.devigMethod || 'power';
  const betBookmaker = options.betBookmaker || 'draftkings';
  const eloWeight = options.eloWeight != null ? options.eloWeight : DEFAULT_ELO_WEIGHT;
  const surfaceBlend = options.surfaceBlend != null ? options.surfaceBlend : DEFAULT_SURFACE_BLEND;
  const calMult = options.calibrationMultiplier != null ? Number(options.calibrationMultiplier) : 1;
  const bestOf = context.best_of === 5 ? 5 : 3;

  const consensus = consensusFromBooks(context.books, { devigMethod });
  if (!consensus) return null;

  // Fair probability at the book we would actually bet. Falls back to the
  // first usable book when the preferred book has no price.
  const betBook =
    consensus.perBook.find((p) => p.bookmaker === betBookmaker) || consensus.perBook[0];
  const impliedHomeProb = betBook.homeFair;
  const impliedAwayProb = betBook.awayFair;

  // ------------------------------------------------------------------
  // Elo signal, optional. Missing ratings mean eloProb stays null and the
  // model probability is pure market consensus.
  // ------------------------------------------------------------------
  const adjustments = [];
  let eloProb = null;
  let eloDetail = null;
  const { home: homeRating, away: awayRating } = await fetchRatings(
    options.ratings, homeName, awayName, context.tour, context.surface
  );
  const effHome = effectiveElo(homeRating, surfaceBlend);
  const effAway = effectiveElo(awayRating, surfaceBlend);
  if (effHome != null && effAway != null) {
    const bo3 = eloWinProb(effHome, effAway);
    eloProb = bestOfAdjust(bo3, bestOf);
    eloDetail = {
      home: round2(effHome),
      away: round2(effAway),
      bo3Prob: round4(bo3),
      bestOf,
    };

    // Fatigue differential, only when both counts exist. Applied to the Elo
    // signal, not the market prior, because the market already prices known
    // schedules better than we can.
    const homeFatigue = fatiguePenalty(homeRating && homeRating.matchesLast14);
    const awayFatigue = fatiguePenalty(awayRating && awayRating.matchesLast14);
    const fatigueDiff = awayFatigue - homeFatigue;
    if (fatigueDiff !== 0) {
      eloProb = Math.max(0.02, Math.min(0.98, eloProb + fatigueDiff));
      adjustments.push({
        factor: fatigueDiff > 0 ? `Fatigue edge to ${homeName}` : `Fatigue edge to ${awayName}`,
        impact: fatigueDiff,
        detail: `Matches last 14 days, ${homeName}: ${homeRating.matchesLast14 ?? '?'}, ${awayName}: ${awayRating.matchesLast14 ?? '?'}`,
      });
    }
  }

  // ------------------------------------------------------------------
  // Blend. Market consensus is the prior, Elo pulls at eloWeight.
  // ------------------------------------------------------------------
  let homeWinProb = consensus.homeProb;
  if (eloProb != null && eloWeight > 0) {
    homeWinProb = (1 - eloWeight) * consensus.homeProb + eloWeight * eloProb;
    adjustments.push({
      factor: 'Elo blend',
      impact: homeWinProb - consensus.homeProb,
      detail: `Elo ${(eloProb * 100).toFixed(1)}% vs market ${(consensus.homeProb * 100).toFixed(1)}%, weight ${eloWeight}`,
    });
  }
  homeWinProb = Math.max(0.02, Math.min(0.98, homeWinProb));
  const awayWinProb = 1 - homeWinProb;

  // ------------------------------------------------------------------
  // Per-side edges vs the bet book, calibrated and capped. Positive means
  // value on that side, negative means the market says the side is a trap.
  // ------------------------------------------------------------------
  const homeMlEdgeRaw = homeWinProb - impliedHomeProb;
  const awayMlEdgeRaw = awayWinProb - impliedAwayProb;
  const homeMlEdge = clampEdge(homeMlEdgeRaw * calMult);
  const awayMlEdge = clampEdge(awayMlEdgeRaw * calMult);

  let edge, edgeSide;
  if (Math.abs(homeMlEdge) >= Math.abs(awayMlEdge)) {
    edge = homeMlEdge;
    edgeSide = homeMlEdge >= 0 ? 'home' : 'away';
  } else {
    edge = awayMlEdge;
    edgeSide = awayMlEdge >= 0 ? 'away' : 'home';
  }

  // ------------------------------------------------------------------
  // Confidence and data quality
  // ------------------------------------------------------------------
  const hasElo = eloProb != null;
  const dataQuality = {
    booksUsed: consensus.booksUsed,
    hasConsensus: consensus.booksUsed >= 2,
    hasRatings: hasElo,
    hasSurfaceRatings:
      hasElo &&
      Number.isFinite(homeRating && homeRating.surfaceElo) &&
      Number.isFinite(awayRating && awayRating.surfaceElo),
    betBookmaker: betBook.bookmaker,
  };
  const confidence =
    consensus.booksUsed >= 3 && hasElo ? 'high'
      : consensus.booksUsed >= 2 || hasElo ? 'medium'
      : 'low';

  return {
    model: 'tennis-v1',
    homeWinProb: round4(homeWinProb),
    awayWinProb: round4(awayWinProb),
    impliedHomeProb: round4(impliedHomeProb),
    impliedAwayProb: round4(impliedAwayProb),
    edge: round4(edge),
    edgeSide,
    edgePercent: round2(Math.abs(edge) * 100),
    edges: {
      home_ml: round4(homeMlEdge),
      away_ml: round4(awayMlEdge),
      home_spread: null,
      away_spread: null,
      over: null,
      under: null,
    },
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
      consensus: {
        homeProb: round4(consensus.homeProb),
        booksUsed: consensus.booksUsed,
        devigMethod,
        perBook: consensus.perBook.map((p) => ({
          bookmaker: p.bookmaker,
          homeFair: round4(p.homeFair),
        })),
      },
      elo: eloDetail,
      surface: context.surface || null,
      tour: context.tour || null,
      bestOf,
      calibrationMultiplier: calMult,
    },
    adjustments,
    confidence,
    dataQuality,
  };
}

module.exports = {
  calculateTennisEdge,
  booksFromOddsRows,
  // Pure math exported for tests and for reuse by other player-sport models.
  americanToProb,
  devigMultiplicative,
  devigPower,
  devigPair,
  median,
  consensusFromBooks,
  eloWinProb,
  effectiveElo,
  setProbFromBo3,
  bo5FromSetProb,
  bestOfAdjust,
  fatiguePenalty,
  MAX_EDGE,
  DEFAULT_ELO_WEIGHT,
};
