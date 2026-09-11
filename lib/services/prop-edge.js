/**
 * NFL player prop edges, shadow first.
 *
 * The same formula shape as every team market, in the same order:
 *
 *   1. Market anchor. The devigged consensus over price at the consensus
 *      line IS the base probability (directive 1, odds are a likelihood).
 *   2. Model. The player's own game log: a recent window mean blended with
 *      the longer history mean, with the player's own game to game spread
 *      (floored per market) as sigma, gives P(over line).
 *   3. Damp. The disagreement moves the anchor by prop_claim_damp times a
 *      sample confidence that ramps from 0 at no games to 1 at
 *      prop_min_games, the exact treatment totals and spreads get.
 *   4. Edge. Damped minus anchor, on the side it favors, in pp. The tier
 *      is the plain pp band. Nothing publishes: prop_reads is a shadow
 *      record that the weekly review judges, like every shadow sport.
 *
 * Every weight is a dial on the NFL_props board (directive 7: the props
 * pipeline reads its formula from sport_dials from day one). Anytime TD
 * is a yes price with no line and no per-game count history that maps
 * cleanly, so v1 records it as not modeled.
 */

'use strict';

const STAT_COLUMN = {
  player_pass_yds: 'passing_yards',
  player_pass_tds: 'passing_tds',
  player_rush_yds: 'rushing_yards',
  player_reception_yds: 'receiving_yards',
  player_receptions: 'receptions',
};

// Floors on the game to game standard deviation, so a player with a
// tiny or unusually steady sample cannot print a certainty. Yards
// markets in NFL routinely swing this much week to week.
const SIGMA_FLOOR = {
  player_pass_yds: 45,
  player_pass_tds: 0.8,
  player_rush_yds: 22,
  player_reception_yds: 20,
  player_receptions: 1.5,
};

const DIAL_DEFAULTS = {
  prop_claim_damp: 0.5,
  prop_recent_window: 5,
  prop_recent_weight: 0.5,
  prop_min_games: 5,
  prop_history_games: 17,
};

// NFL weeks run Tuesday to Monday. Week 1 of a season is keyed by its
// Tuesday so a commence_time maps to the nflverse week number.
const NFL_WEEK1_TUESDAY = { 2025: '2025-09-02', 2026: '2026-09-08', 2027: '2027-09-07' };

function normCdf(z) {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function impliedProb(american) {
  const o = Number(american);
  if (!Number.isFinite(o) || o === 0) return null;
  return o > 0 ? 100 / (o + 100) : -o / (-o + 100);
}

function median(values) {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Consensus for one (event, market, player) across books.
 * rows: [{ bookmaker, line, over_price, under_price }]
 * Returns { line, overProb, books, atLine, overPrice, underPrice, best }
 * where overProb is the devigged over probability at the consensus line
 * (books posting exactly that line; all books when none do), and best
 * is the best available price per side for the record.
 */
function consensusFromBooks(rows) {
  const usable = (rows || []).filter(r => r && r.line != null && Number.isFinite(Number(r.line))
    && impliedProb(r.over_price) != null && impliedProb(r.under_price) != null);
  if (usable.length === 0) return null;
  const line = median(usable.map(r => Number(r.line)));
  let atLine = usable.filter(r => Number(r.line) === line);
  if (atLine.length === 0) atLine = usable;
  let sum = 0;
  for (const r of atLine) {
    const o = impliedProb(r.over_price), u = impliedProb(r.under_price);
    sum += o / (o + u);
  }
  const overProb = sum / atLine.length;
  const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  const bestOver = usable.reduce((b, r) => (b == null || Number(r.over_price) > Number(b.over_price)) ? r : b, null);
  const bestUnder = usable.reduce((b, r) => (b == null || Number(r.under_price) > Number(b.under_price)) ? r : b, null);
  return {
    line,
    overProb,
    books: usable.length,
    atLine: atLine.length,
    overPrice: avg(atLine.map(r => Number(r.over_price))),
    underPrice: avg(atLine.map(r => Number(r.under_price))),
    best: {
      over: { book: bestOver.bookmaker, line: Number(bestOver.line), price: Number(bestOver.over_price) },
      under: { book: bestUnder.bookmaker, line: Number(bestUnder.line), price: Number(bestUnder.under_price) },
    },
  };
}

/**
 * The player's baseline for a market from their game log, most recent
 * game first. Returns null when there is no history at all.
 */
function playerBaseline(history, market, dials = {}) {
  const col = STAT_COLUMN[market];
  if (!col) return null;
  const d = { ...DIAL_DEFAULTS, ...dials };
  const vals = (history || [])
    .map(g => Number(g?.[col]))
    .filter(v => Number.isFinite(v))
    .slice(0, Math.max(1, Math.round(d.prop_history_games)));
  if (vals.length === 0) return null;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const recent = vals.slice(0, Math.max(1, Math.round(d.prop_recent_window)));
  const recentMean = mean(recent);
  const longMean = mean(vals);
  const w = Math.max(0, Math.min(1, Number(d.prop_recent_weight)));
  const blended = w * recentMean + (1 - w) * longMean;
  const variance = vals.length > 1
    ? vals.reduce((s, v) => s + (v - longMean) ** 2, 0) / (vals.length - 1)
    : 0;
  const sigma = Math.max(SIGMA_FLOOR[market] || 1, Math.sqrt(variance));
  return { mean: blended, recentMean, longMean, sigma, games: vals.length };
}

/**
 * Step one through four for a single prop.
 * Returns { anchorProb, modelProb, dampedProb, confidence, edgeOver, side, edgePp }.
 */
function propRead({ line, anchorOverProb, mean, sigma, games }, dials = {}) {
  const d = { ...DIAL_DEFAULTS, ...dials };
  if (![line, anchorOverProb, mean, sigma].every(v => Number.isFinite(Number(v))) || !(sigma > 0)) return null;
  const modelProb = 1 - normCdf((Number(line) - Number(mean)) / Number(sigma));
  const minGames = Math.max(1, Number(d.prop_min_games));
  const confidence = Math.min(1, Math.max(0, Number(games) || 0) / minGames);
  const damp = Math.max(0, Number(d.prop_claim_damp));
  const anchor = Number(anchorOverProb);
  const dampedProb = anchor + damp * confidence * (modelProb - anchor);
  const edgeOver = dampedProb - anchor;
  const side = edgeOver >= 0 ? 'over' : 'under';
  return {
    anchorProb: anchor,
    modelProb,
    dampedProb,
    confidence,
    edgeOver,
    side,
    edgePp: Math.round(Math.abs(edgeOver) * 1000) / 10,
  };
}

/** nflverse week number for a kickoff instant, and the season it belongs to. */
function nflWeekFor(dateLike) {
  const t = new Date(dateLike);
  if (Number.isNaN(t.getTime())) return null;
  const year = t.getUTCMonth() >= 7 ? t.getUTCFullYear() : t.getUTCFullYear() - 1;
  const start = NFL_WEEK1_TUESDAY[year];
  if (!start) return null;
  // Tuesday 00:00 America/Denver is 06:00 UTC.
  const startMs = new Date(`${start}T06:00:00Z`).getTime();
  const week = Math.floor((t.getTime() - startMs) / (7 * 24 * 3600 * 1000)) + 1;
  if (week < 1 || week > 22) return null;
  return { season: year, week };
}

/** Grade a read against the actual stat. */
function gradeRead(side, line, actual) {
  if (actual == null || line == null) return null;
  const a = Number(actual), l = Number(line);
  if (!Number.isFinite(a) || !Number.isFinite(l)) return null;
  if (a === l) return 'push';
  if (side === 'over') return a > l ? 'won' : 'lost';
  return a < l ? 'won' : 'lost';
}

module.exports = {
  STAT_COLUMN, SIGMA_FLOOR, DIAL_DEFAULTS, NFL_WEEK1_TUESDAY,
  normCdf, impliedProb, median, consensusFromBooks, playerBaseline, propRead, nflWeekFor, gradeRead,
};
