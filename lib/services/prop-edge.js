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
  // A line posted by a single book is dispersion, not consensus (the
  // tennis +251 lesson): fewer books than this and the prop is skipped.
  prop_min_books: 2,
  // v2 shadow read (2026-09-14, owner: yards markets can become
  // reliable with the right data). Multiplicative adjustments to the
  // player's baseline mean, stored next to the v1 read and graded
  // alongside it, never published. Each weight is the share of the
  // measured ratio the mean takes on: 0.5 means a defense allowing 20
  // percent more than league average lifts the mean 10 percent.
  prop_opp_weight: 0.5,   // opponent allowance per game against league average
  prop_env_weight: 0.5,   // the team's implied points against the slate average
  prop_wind_weight: 0.1,  // passing and receiving yards drag at 30 mph outdoors
};

// Which allowance column judges each market. Receiving yards allowed
// equal passing yards allowed and receptions allowed equal completions
// allowed, so the aggregate carries five columns for five markets.
const ALLOWANCE_COLUMN = {
  player_pass_yds: 'passing_yards',
  player_pass_tds: 'passing_tds',
  player_rush_yds: 'rushing_yards',
  player_reception_yds: 'receiving_yards',
  player_receptions: 'receptions',
};
const WIND_MARKETS = new Set(['player_pass_yds', 'player_reception_yds', 'player_pass_tds']);
const WIND_FLOOR_MPH = 15;
const WIND_FULL_MPH = 30;
// A designation that means the player will not play. The v2 read skips
// these instead of pricing a line the book will void.
const UNAVAILABLE = new Set(['out', 'doubtful', 'ir', 'injured reserve', 'pup', 'sus', 'suspended', 'nfi', 'dnr']);

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

/**
 * Per opponent allowance per game from stat lines: rows are player game
 * lines with team, opponent, game_id and the five stat columns. Returns
 * { byOpponent: { ABBR: { games, passing_yards, ... } }, league: {...} }
 * where every value is per game. Pure.
 */
function allowanceTable(rows) {
  const cols = Object.values(ALLOWANCE_COLUMN);
  const acc = new Map();
  const leagueGames = new Set();
  const league = Object.fromEntries(cols.map(c => [c, 0]));
  for (const r of rows || []) {
    const opp = String(r?.opponent || '').toUpperCase().trim();
    if (!opp || !r.game_id) continue;
    if (!acc.has(opp)) acc.set(opp, { games: new Set(), ...Object.fromEntries(cols.map(c => [c, 0])) });
    const a = acc.get(opp);
    a.games.add(r.game_id);
    leagueGames.add(`${opp}|${r.game_id}`);
    for (const c of cols) {
      const v = Number(r[c]);
      if (Number.isFinite(v)) { a[c] += v; league[c] += v; }
    }
  }
  const byOpponent = {};
  for (const [opp, a] of acc) {
    const g = a.games.size;
    if (g === 0) continue;
    byOpponent[opp] = { games: g, ...Object.fromEntries(cols.map(c => [c, a[c] / g])) };
  }
  const lg = leagueGames.size;
  const leaguePerGame = lg > 0 ? Object.fromEntries(cols.map(c => [c, league[c] / lg])) : null;
  return { byOpponent, league: leaguePerGame, leagueGames: lg };
}

/** Opponent allowance ratio for a market, 1 when unknown. Pure. */
function allowanceRatio(table, opponentAbbr, market) {
  const col = ALLOWANCE_COLUMN[market];
  const opp = table?.byOpponent?.[String(opponentAbbr || '').toUpperCase()];
  const lg = table?.league?.[col];
  if (!col || !opp || !(lg > 0) || !(opp.games >= 3)) return { ratio: 1, games: opp?.games || 0 };
  return { ratio: opp[col] / lg, games: opp.games };
}

/**
 * The team's implied points from the game line: half the total plus
 * half its edge on the spread (a -2.5 favorite at a 43.5 total is
 * implied 23.0, the dog 20.5). Pure.
 */
function impliedTeamPoints(total, teamSpread) {
  if (total == null || teamSpread == null) return null;
  const t = Number(total), s = Number(teamSpread);
  if (!Number.isFinite(t) || !Number.isFinite(s)) return null;
  return t / 2 - s / 2;
}

/** Wind drag factor on a passing market, 1 indoors or under 15 mph. Pure. */
function windFactor(market, windMph, roof, weight) {
  if (!WIND_MARKETS.has(market)) return 1;
  if (roof === 'dome') return 1;
  const w = Number(windMph);
  if (!Number.isFinite(w) || w < WIND_FLOOR_MPH) return 1;
  const share = Math.min(1, (w - WIND_FLOOR_MPH) / (WIND_FULL_MPH - WIND_FLOOR_MPH));
  return 1 - Math.max(0, Number(weight) || 0) * share;
}

function isUnavailable(status) {
  return UNAVAILABLE.has(String(status || '').toLowerCase().trim());
}

/**
 * The v2 read: the v1 baseline mean scaled by the opponent allowance,
 * the game environment and the wind, then the same anchor, damp and
 * band as v1. Returns null when the player is unavailable or the
 * inputs do not price. Pure.
 */
function propReadV2({ market, line, anchorOverProb, mean, sigma, games, oppRatio, envRatio, windMph, roof, status }, dials = {}) {
  if (isUnavailable(status)) return { skipped: 'unavailable', status: String(status) };
  const d = { ...DIAL_DEFAULTS, ...dials };
  const opp = Number.isFinite(Number(oppRatio)) ? Number(oppRatio) : 1;
  const env = Number.isFinite(Number(envRatio)) ? Number(envRatio) : 1;
  const oppF = 1 + Math.max(0, Number(d.prop_opp_weight)) * (opp - 1);
  const envF = 1 + Math.max(0, Number(d.prop_env_weight)) * (env - 1);
  const windF = windFactor(market, windMph, roof, d.prop_wind_weight);
  const meanV2 = Number(mean) * oppF * envF * windF;
  const read = propRead({ line, anchorOverProb, mean: meanV2, sigma, games }, d);
  if (!read) return null;
  return {
    ...read,
    meanV2,
    factors: {
      opp_ratio: Math.round(opp * 1000) / 1000,
      env_ratio: Math.round(env * 1000) / 1000,
      opp_factor: Math.round(oppF * 1000) / 1000,
      env_factor: Math.round(envF * 1000) / 1000,
      wind_factor: Math.round(windF * 1000) / 1000,
      wind_mph: Number.isFinite(Number(windMph)) ? Number(windMph) : null,
      status: status || null,
    },
  };
}

module.exports = {
  STAT_COLUMN, SIGMA_FLOOR, DIAL_DEFAULTS, NFL_WEEK1_TUESDAY, ALLOWANCE_COLUMN,
  normCdf, impliedProb, median, consensusFromBooks, playerBaseline, propRead, nflWeekFor, gradeRead,
  allowanceTable, allowanceRatio, impliedTeamPoints, windFactor, isUnavailable, propReadV2,
};
