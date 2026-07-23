// lib/services/edge-models/soccer-1x2.js
//
// Three-way 1X2 soccer edge model, first working cut.
//
// Soccer h2h is a three-outcome market: home win, draw, away win. The old
// two-way edge calculator normalized home and away and never priced the
// draw, which is why soccer sits in PREVIEW_ONLY_SPORTS. This module prices
// all three outcomes.
//
// What it does today:
//   1. Accepts three-way prices per bookmaker (American odds).
//   2. Removes the overround per book with proportional, power, or Shin
//      devig, then takes the component-wise median across books.
//   3. Blends the market consensus with an optional goal model. When team
//      strength data is absent the goal model layer returns null and the
//      output is market-only. That is the graceful degradation path.
//   4. Returns per-outcome signed edges shaped like edge-calculator output,
//      extended for three outcomes. Positive edge means model value on that
//      outcome. Negative edge is a Trap read, same convention as the rest
//      of the pipeline.
//
// The goal model interface expects expected goals for each side, or attack
// and defense multipliers it can turn into expected goals. The Dixon-Coles
// tau correction is applied to the four low-score cells so draw frequency
// is not underpriced by the independent Poisson assumption. See
// docs/models/soccer-1x2-model.md for sources and the full design.
//
// This module is pure math. It never touches the database. Calibration
// multipliers come in through options so the caller owns the DB read.

'use strict';

const OUTCOMES = ['home', 'draw', 'away'];

// Default weight on the goal model when blending with market consensus.
// Market stays the anchor until the goal model earns trust in backtests.
const DEFAULT_MODEL_WEIGHT = 0.35;

// Same defensive cap as edge-calculator. Real edges beyond 15pp in a mature
// market almost always mean model error, not mispricing.
const DEFAULT_MAX_EDGE = 0.15;

// Truncation for the Poisson score grid. P(goals > 10) is negligible at
// soccer scoring rates and the grid is renormalized anyway.
const MAX_GOALS = 10;

// ---------------------------------------------------------------------------
// Price conversion
// ---------------------------------------------------------------------------

/**
 * American odds to raw implied probability (vig included).
 * -180 gives 0.643 and +150 gives 0.400. Returns null on bad input.
 */
function americanToProb(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n === 0 || (n > -100 && n < 100)) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

/**
 * Raw implied probabilities and overround for one book's three-way prices.
 * Returns null unless all three prices convert cleanly.
 */
function rawImplied(book) {
  const home = americanToProb(book.home);
  const draw = americanToProb(book.draw);
  const away = americanToProb(book.away);
  if (home == null || draw == null || away == null) return null;
  const booksum = home + draw + away;
  return { raw: { home, draw, away }, booksum, overround: booksum - 1 };
}

// ---------------------------------------------------------------------------
// Devig methods. Each takes {home, draw, away} raw implied probabilities and
// returns fair probabilities summing to 1, or null on bad input.
// ---------------------------------------------------------------------------

/**
 * Proportional (multiplicative) devig. Divide each raw probability by the
 * booksum. Simple and standard, but it spreads the margin evenly, which
 * overstates longshots when the book shades them (favorite-longshot bias).
 */
function devigProportional(raw) {
  if (!raw) return null;
  const total = raw.home + raw.draw + raw.away;
  if (!(total > 0)) return null;
  return { home: raw.home / total, draw: raw.draw / total, away: raw.away / total };
}

/**
 * Power devig. Find k so that sum(p_i^k) = 1 and use p_i^k as the fair
 * probabilities. For an overround book k > 1, which shrinks small
 * probabilities more than large ones. Solved by bisection.
 */
function devigPower(raw) {
  if (!raw) return null;
  const probs = [raw.home, raw.draw, raw.away];
  if (probs.some((p) => !(p > 0 && p < 1))) return devigProportional(raw);
  const sumAt = (k) => probs.reduce((s, p) => s + Math.pow(p, k), 0);
  let lo = 0.2;
  let hi = 8;
  if (sumAt(lo) < 1 || sumAt(hi) > 1) return devigProportional(raw);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (sumAt(mid) > 1) lo = mid; else hi = mid;
  }
  const k = (lo + hi) / 2;
  return {
    home: Math.pow(raw.home, k),
    draw: Math.pow(raw.draw, k),
    away: Math.pow(raw.away, k),
  };
}

/**
 * Shin devig. Models the book as pricing against a fraction z of insider
 * money (Shin 1992, 1993). Empirically the strongest simple correction for
 * favorite-longshot bias in markets with a longshot outcome, which a soccer
 * draw or big underdog usually is.
 *
 * Fair probability for outcome i at insider fraction z:
 *   p_i = (sqrt(z^2 + 4 (1 - z) pi_i^2 / B) - z) / (2 (1 - z))
 * where pi_i are raw implied probabilities and B is their sum. z is solved
 * by bisection so the fair probabilities sum to 1. At z = 0 the sum is
 * sqrt(B) which exceeds 1 for any overround book, and the sum decreases in
 * z, so the root is bracketed.
 *
 * Returns { probs, z } or null on bad input.
 */
function devigShin(raw) {
  if (!raw) return null;
  const pis = [raw.home, raw.draw, raw.away];
  if (pis.some((p) => !(p > 0 && p < 1))) return null;
  const B = pis.reduce((s, p) => s + p, 0);
  if (B <= 1.000001) {
    // No margin to remove. Return the near-fair probabilities normalized.
    const probs = devigProportional(raw);
    return probs ? { probs, z: 0 } : null;
  }
  const shinProb = (pi, z) =>
    (Math.sqrt(z * z + 4 * (1 - z) * (pi * pi) / B) - z) / (2 * (1 - z));
  const sumAt = (z) => pis.reduce((s, pi) => s + shinProb(pi, z), 0);
  let lo = 0;
  let hi = 0.5;
  if (sumAt(hi) > 1) hi = 0.95;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (sumAt(mid) > 1) lo = mid; else hi = mid;
  }
  const z = (lo + hi) / 2;
  let probs = {
    home: shinProb(raw.home, z),
    draw: shinProb(raw.draw, z),
    away: shinProb(raw.away, z),
  };
  // Bisection residual is tiny. Normalize away the remainder.
  probs = devigProportional(probs);
  return probs ? { probs, z } : null;
}

// ---------------------------------------------------------------------------
// Consensus across books
// ---------------------------------------------------------------------------

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Devig each book with the given method, then take the component-wise
 * median across books and renormalize. Median resists one stale or outlier
 * book better than a mean.
 *
 * method is 'proportional', 'power', or 'shin'.
 * Returns { probs, booksUsed, overroundAvg, shinZAvg } or null when no book
 * has a complete three-way price set.
 */
function consensusProbs(books, method = 'shin') {
  if (!Array.isArray(books)) return null;
  const perBook = [];
  const overrounds = [];
  const zs = [];
  for (const book of books) {
    const raw = rawImplied(book || {});
    if (!raw) continue;
    let probs = null;
    if (method === 'shin') {
      const shin = devigShin(raw.raw);
      if (shin) { probs = shin.probs; zs.push(shin.z); }
    } else if (method === 'power') {
      probs = devigPower(raw.raw);
    } else {
      probs = devigProportional(raw.raw);
    }
    if (probs) {
      perBook.push(probs);
      overrounds.push(raw.overround);
    }
  }
  if (!perBook.length) return null;
  const merged = {
    home: median(perBook.map((p) => p.home)),
    draw: median(perBook.map((p) => p.draw)),
    away: median(perBook.map((p) => p.away)),
  };
  const probs = devigProportional(merged);
  if (!probs) return null;
  return {
    probs,
    booksUsed: perBook.length,
    overroundAvg: overrounds.reduce((s, v) => s + v, 0) / overrounds.length,
    shinZAvg: zs.length ? zs.reduce((s, v) => s + v, 0) / zs.length : null,
  };
}

// ---------------------------------------------------------------------------
// Goal model layer (Poisson grid with Dixon-Coles tau correction)
// ---------------------------------------------------------------------------

function poissonPmf(lambda, k) {
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Dixon-Coles tau correction factor for the low-score cells. rho below zero
 * moves probability into 0-0 and 1-1, which raises the draw. rho of zero is
 * plain independent Poisson.
 */
function dixonColesTau(x, y, lambdaHome, lambdaAway, rho) {
  if (x === 0 && y === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (x === 0 && y === 1) return 1 + lambdaHome * rho;
  if (x === 1 && y === 0) return 1 + lambdaAway * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/**
 * Turn attack and defense multipliers into expected goals. Multiplicative
 * form from Dixon-Coles: home expected goals are home attack times away
 * defense times the league home baseline. Returns null when inputs are
 * missing so callers can fall through to market-only mode.
 */
function expectedGoalsFromStrengths(strengths) {
  if (!strengths) return null;
  const {
    homeAttack, homeDefense, awayAttack, awayDefense,
    leagueHomeGoals, leagueAwayGoals,
  } = strengths;
  const inputs = [homeAttack, homeDefense, awayAttack, awayDefense, leagueHomeGoals, leagueAwayGoals];
  if (inputs.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  return {
    homeExpectedGoals: homeAttack * awayDefense * leagueHomeGoals,
    awayExpectedGoals: awayAttack * homeDefense * leagueAwayGoals,
  };
}

/**
 * 1X2 probabilities from a goal model.
 *
 * strengths accepts either of:
 *   { homeExpectedGoals, awayExpectedGoals, rho }        direct form
 *   { homeAttack, homeDefense, awayAttack, awayDefense,
 *     leagueHomeGoals, leagueAwayGoals, rho }            rating form
 *
 * Returns { home, draw, away } summing to 1, or null when the data is not
 * there. Null is the contract for "no team strength data yet", so the
 * caller silently stays market-only.
 */
function goalModelProbabilities(strengths) {
  if (!strengths) return null;
  let lambdaHome = strengths.homeExpectedGoals;
  let lambdaAway = strengths.awayExpectedGoals;
  if (!Number.isFinite(lambdaHome) || !Number.isFinite(lambdaAway)) {
    const eg = expectedGoalsFromStrengths(strengths);
    if (!eg) return null;
    lambdaHome = eg.homeExpectedGoals;
    lambdaAway = eg.awayExpectedGoals;
  }
  if (!(lambdaHome > 0) || !(lambdaAway > 0)) return null;
  const rho = Number.isFinite(strengths.rho) ? strengths.rho : 0;

  let home = 0, draw = 0, away = 0;
  for (let x = 0; x <= MAX_GOALS; x++) {
    const px = poissonPmf(lambdaHome, x);
    for (let y = 0; y <= MAX_GOALS; y++) {
      const cell = px * poissonPmf(lambdaAway, y) * dixonColesTau(x, y, lambdaHome, lambdaAway, rho);
      if (cell <= 0) continue;
      if (x > y) home += cell;
      else if (x === y) draw += cell;
      else away += cell;
    }
  }
  const total = home + draw + away;
  if (!(total > 0)) return null;
  return { home: home / total, draw: draw / total, away: away / total };
}

/**
 * Weighted blend of market and model probabilities, renormalized. When
 * modelProbs is null the market probabilities pass through untouched.
 */
function blendProbabilities(marketProbs, modelProbs, modelWeight = DEFAULT_MODEL_WEIGHT) {
  if (!marketProbs) return null;
  if (!modelProbs) return { ...marketProbs };
  const w = Math.max(0, Math.min(1, modelWeight));
  const mixed = {
    home: (1 - w) * marketProbs.home + w * modelProbs.home,
    draw: (1 - w) * marketProbs.draw + w * modelProbs.draw,
    away: (1 - w) * marketProbs.away + w * modelProbs.away,
  };
  return devigProportional(mixed);
}

// ---------------------------------------------------------------------------
// Input adapters
// ---------------------------------------------------------------------------

/**
 * Map odds_cache h2h rows for one game into the books array this module
 * consumes. Rows carry bookmaker, market_type and an outcomes jsonb array
 * of { name, price } where name is the team name or the literal 'Draw'.
 */
function fromOddsCacheRows(rows, homeTeam, awayTeam) {
  if (!Array.isArray(rows)) return [];
  const books = [];
  for (const row of rows) {
    if (!row || (row.market_type && row.market_type !== 'h2h')) continue;
    const outcomes = row.outcomes;
    if (!Array.isArray(outcomes)) continue;
    const find = (name) => {
      const hit = outcomes.find((o) => o && o.name === name);
      return hit ? hit.price : null;
    };
    const book = {
      bookmaker: row.bookmaker || 'unknown',
      home: find(homeTeam),
      draw: find('Draw'),
      away: find(awayTeam),
    };
    if (book.home != null && book.draw != null && book.away != null) {
      books.push(book);
    }
  }
  return books;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Compute three-way edges for one soccer match.
 *
 * input:
 *   homeTeam, awayTeam   display names, used only for labeling
 *   books                [{ bookmaker, home, draw, away }] American prices
 *   strengths            optional goal model input, see goalModelProbabilities
 *   options:
 *     modelWeight            weight on the goal model in the blend
 *     calibrationMultiplier  edge_calibration multiplier, caller supplies it
 *     maxEdge                cap on published edge magnitude, default 0.15
 *
 * Output extends the edge-calculator shape to three outcomes. Side keys in
 * `edges` are home_ml, draw, away_ml so home and away flow through the
 * existing Moneyline plumbing and draw is a new first-class side.
 *
 * Returns null when no book has a complete three-way price set.
 */
function calculateSoccer1x2Edges(input) {
  const { homeTeam = null, awayTeam = null, books, strengths = null } = input || {};
  const options = (input && input.options) || {};
  const modelWeight = options.modelWeight != null ? options.modelWeight : DEFAULT_MODEL_WEIGHT;
  const calMult = options.calibrationMultiplier != null ? Number(options.calibrationMultiplier) : 1;
  const maxEdge = options.maxEdge != null ? options.maxEdge : DEFAULT_MAX_EDGE;

  // Baseline implied probabilities: proportional consensus. This is the
  // number the pipeline already understands as "what the market says", and
  // the edge is measured against it.
  const implied = consensusProbs(books, 'proportional');
  if (!implied) return null;

  // Fair probabilities: Shin consensus. This is the market-only model view.
  const fair = consensusProbs(books, 'shin') || implied;

  // Goal model, null when strength data is absent.
  const goalProbs = goalModelProbabilities(strengths);

  const modelProbs = blendProbabilities(fair.probs, goalProbs, modelWeight);
  const modelSource = goalProbs ? 'shin_goal_blend' : 'shin_market_only';

  const clamp = (e) => Math.max(-maxEdge, Math.min(maxEdge, e));
  const round4 = (x) => (x == null ? null : parseFloat(x.toFixed(4)));

  const edgesRaw = {};
  const edges = {};
  const sideKey = { home: 'home_ml', draw: 'draw', away: 'away_ml' };
  for (const outcome of OUTCOMES) {
    const rawEdge = modelProbs[outcome] - implied.probs[outcome];
    edgesRaw[sideKey[outcome]] = round4(rawEdge);
    edges[sideKey[outcome]] = round4(clamp(rawEdge * calMult));
  }

  // Legacy scalars mirror edge-calculator: the highest magnitude edge wins,
  // and edgeSide names the outcome that edge belongs to.
  let edge = null;
  let edgeSide = null;
  for (const outcome of OUTCOMES) {
    const e = edges[sideKey[outcome]];
    if (edge == null || Math.abs(e) > Math.abs(edge)) {
      edge = e;
      edgeSide = outcome;
    }
  }

  const booksUsed = implied.booksUsed;
  const confidence = goalProbs && booksUsed >= 3 ? 'high'
    : booksUsed >= 2 ? 'medium' : 'low';

  return {
    homeTeam,
    awayTeam,
    modelSource,
    // Model probabilities, three outcomes, sum to 1.
    homeWinProb: round4(modelProbs.home),
    drawProb: round4(modelProbs.draw),
    awayWinProb: round4(modelProbs.away),
    // Market implied probabilities after proportional devig, sum to 1.
    impliedHomeProb: round4(implied.probs.home),
    impliedDrawProb: round4(implied.probs.draw),
    impliedAwayProb: round4(implied.probs.away),
    // Legacy scalars.
    edge,
    edgeSide,
    edgePercent: edge == null ? null : parseFloat((Math.abs(edge) * 100).toFixed(2)),
    // Per-side signed edges, decimals. Positive means model value.
    edges,
    edgesRaw,
    confidence,
    dataQuality: {
      booksUsed,
      overroundAvg: round4(implied.overroundAvg),
      shinZAvg: fair.shinZAvg != null ? round4(fair.shinZAvg) : null,
      hasGoalModel: !!goalProbs,
    },
    factors: {
      devig: {
        impliedMethod: 'proportional',
        modelMethod: 'shin',
        shinZAvg: fair.shinZAvg != null ? round4(fair.shinZAvg) : null,
        overroundAvg: round4(implied.overroundAvg),
      },
      goalModel: goalProbs ? {
        home: round4(goalProbs.home),
        draw: round4(goalProbs.draw),
        away: round4(goalProbs.away),
        blendWeight: modelWeight,
      } : null,
      calibrationMultiplier: calMult,
    },
  };
}

/**
 * Pick the best side from a calculateSoccer1x2Edges result. Mirrors
 * EdgeCalculator.pickBestSide: returns { side, signedEdge } or null when
 * nothing clears the minimum. Pass a very low minEdgePp to always get the
 * best side for display, the way pre-analyze does for Trap and Skip reads.
 */
function pickBest1x2Side(result, { minEdgePp = 2 } = {}) {
  if (!result || !result.edges) return null;
  let best = null;
  for (const [side, signedEdge] of Object.entries(result.edges)) {
    if (signedEdge == null) continue;
    if (!best || signedEdge > best.signedEdge) best = { side, signedEdge };
  }
  if (!best) return null;
  if (best.signedEdge * 100 < minEdgePp) return null;
  return best;
}

module.exports = {
  OUTCOMES,
  americanToProb,
  rawImplied,
  devigProportional,
  devigPower,
  devigShin,
  consensusProbs,
  poissonPmf,
  dixonColesTau,
  expectedGoalsFromStrengths,
  goalModelProbabilities,
  blendProbabilities,
  fromOddsCacheRows,
  calculateSoccer1x2Edges,
  pickBest1x2Side,
};
