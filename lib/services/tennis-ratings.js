/**
 * Tennis Elo ratings provider, the missing half of the tennis edge model.
 *
 * The tennis model shipped with a two-signal design: market consensus plus
 * a surface Elo blend behind a ratings interface. Production only ever
 * wired the market half, so every published tennis edge was pure
 * inter-book disagreement, structurally capped around 4pp, and tennis
 * could never produce a Play or better on real conviction. This module
 * implements the ratings interface from the two tables the sync cron
 * already fills:
 *
 *   tennis_rankings       official ATP/WTA rank + points per player
 *   tennis_match_results  singles results since 2026-07-06, ESPN
 *
 * Method: seed each ranked player's Elo from official ranking points on a
 * log scale (points are roughly log-distributed across the rankings), then
 * replay all stored match results in date order with a standard Elo
 * update. Ranking points carry the career-strength signal the short
 * results window cannot, and the replay adds current form on top.
 *
 * No surface data exists in either table, so surfaceElo is always null
 * and the model's surface blend degrades to overall Elo, exactly the
 * fallback path calculateTennisEdge was built with. matchesLast14 feeds
 * the model's fatigue term.
 */

'use strict';

const { playerKey } = require('./tennis-data.js');
const { siteDayOffset } = require('../../shared/site-day.js');

// Log-linear seed from official ranking points. Chosen so the top of the
// tour lands near 2270 (about 12000 points) and the back of the stored
// rankings near 1830 (about 400 points), which puts the implied win
// probability of number 1 over number 150 in the low 90s, in line with
// how books price those matches. The replay refines from there.
const SEED_BASE = 1050;
const SEED_SCALE = 130;

// A player in the results table but outside the stored rankings (mostly
// qualifiers) seeds below the ranked field. Roughly a rank-200
// extrapolation of the seed curve.
const UNRANKED_SEED = 1800;

// A player with no ranking row needs at least this many replayed matches
// before the table will vouch for a rating at all. Below it, getRating
// returns null and the model stays market-only for that matchup, which is
// the honest default for a near-unknown.
const MIN_MATCHES_UNRANKED = 3;

// Standard Elo K. The window is short (weeks, not seasons), so a fast K
// lets current form move ratings meaningfully off their point seeds.
const K_FACTOR = 32;

const WORKLOAD_WINDOW_DAYS = 14;

function seedEloFromPoints(points) {
  const p = Number(points);
  if (!Number.isFinite(p) || p <= 0) return null;
  return SEED_BASE + SEED_SCALE * Math.log(p);
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Build the ratings table from raw rows. Pure so tests need no client.
 *
 * rankings: [{ tour, player_key, points }]
 * matches:  [{ tour, match_date (YYYY-MM-DD), winner_key, loser_key,
 *              finish_type }] in any order; replayed by date then id.
 * now: Date, anchor for the 14-day workload window.
 *
 * Returns Map keyed `${tour}|${player_key}` ->
 *   { elo, ranked, matches, matchesLast14, lastMatchDate }
 */
function buildRatingTable({ rankings, matches, now = new Date() }) {
  const table = new Map();
  const keyOf = (tour, pk) => `${String(tour || '').toLowerCase()}|${pk}`;

  for (const r of rankings || []) {
    if (!r || !r.player_key) continue;
    const seed = seedEloFromPoints(r.points);
    table.set(keyOf(r.tour, r.player_key), {
      elo: seed != null ? seed : UNRANKED_SEED,
      ranked: true,
      matches: 0,
      matchesLast14: 0,
      lastMatchDate: null,
    });
  }

  // Site-canonical day for the workload floor. match_date is an ESPN
  // calendar date; a day of slack at the boundary is fine for a fatigue
  // count, deriving days in UTC is not (timezone tripwire).
  const workloadFloor = siteDayOffset(-WORKLOAD_WINDOW_DAYS, now);

  const ordered = [...(matches || [])].sort((a, b) =>
    a.match_date < b.match_date ? -1 : a.match_date > b.match_date ? 1
      : (a.id || 0) - (b.id || 0));

  for (const m of ordered) {
    if (!m || !m.winner_key || !m.loser_key) continue;
    // A walkover carries no play signal, only scheduling news. It counts
    // for nothing: no rating move, no workload (nobody played).
    if (m.finish_type === 'walkover') continue;
    const wKey = keyOf(m.tour, m.winner_key);
    const lKey = keyOf(m.tour, m.loser_key);
    let w = table.get(wKey);
    let l = table.get(lKey);
    if (!w) { w = { elo: UNRANKED_SEED, ranked: false, matches: 0, matchesLast14: 0, lastMatchDate: null }; table.set(wKey, w); }
    if (!l) { l = { elo: UNRANKED_SEED, ranked: false, matches: 0, matchesLast14: 0, lastMatchDate: null }; table.set(lKey, l); }

    const exp = expectedScore(w.elo, l.elo);
    const delta = K_FACTOR * (1 - exp);
    w.elo += delta;
    l.elo -= delta;
    w.matches++; l.matches++;
    if (m.match_date >= workloadFloor) { w.matchesLast14++; l.matchesLast14++; }
    if (!w.lastMatchDate || m.match_date > w.lastMatchDate) w.lastMatchDate = m.match_date;
    if (!l.lastMatchDate || m.match_date > l.lastMatchDate) l.lastMatchDate = m.match_date;
  }

  return table;
}

/**
 * Rating lookup against a built table. Returns the calculateTennisEdge
 * ratings contract or null when the table cannot vouch for the player:
 * unknown key, or unranked with fewer than MIN_MATCHES_UNRANKED results.
 */
function ratingFromTable(table, { name, tour }) {
  const pk = playerKey(name);
  if (!pk || !table) return null;
  const entry = table.get(`${String(tour || '').toLowerCase()}|${pk}`);
  if (!entry) return null;
  if (!entry.ranked && entry.matches < MIN_MATCHES_UNRANKED) return null;
  return {
    elo: entry.elo,
    surfaceElo: null,
    matchesLast14: entry.matchesLast14,
    lastMatchDate: entry.lastMatchDate,
  };
}

// ---------------------------------------------------------------------------
// Production provider: loads both tables once per sweep, cached 10 minutes,
// same TTL pattern as the edge-calculator calibration cache. Fails open to
// "no ratings" so a query outage degrades the model to market-only instead
// of stopping the sweep.
// ---------------------------------------------------------------------------

const TTL_MS = 10 * 60 * 1000;
let _cache = null;

async function loadRatingTable(supabase) {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.table;
  let table = new Map();
  try {
    const [rankRes, matchRes] = await Promise.all([
      supabase.from('tennis_rankings').select('tour, player_key, points'),
      supabase.from('tennis_match_results')
        .select('id, tour, match_date, winner_key, loser_key, finish_type'),
    ]);
    if (!rankRes.error && !matchRes.error) {
      table = buildRatingTable({
        rankings: rankRes.data || [],
        matches: matchRes.data || [],
      });
    }
  } catch { /* fail open, empty table means market-only */ }
  _cache = { at: Date.now(), table };
  return table;
}

/**
 * The ratings provider handed to calculateTennisEdge. One provider per
 * process; the table load is cached across calls.
 */
function createRatingsProvider(supabase) {
  return {
    async getRating({ name, tour }) {
      const table = await loadRatingTable(supabase);
      return ratingFromTable(table, { name, tour });
    },
  };
}

// ---------------------------------------------------------------------------
// Calibration multiplier for the tennis model. Chain: Tennis:ml, then
// Tennis, then 1. Deliberately NOT __global__: that k is fit on team-sport
// picks and says nothing about the tennis model. Cached on the same clock
// as the rating table.
// ---------------------------------------------------------------------------

let _calCache = null;

async function getTennisCalibrationMultiplier(supabase) {
  if (_calCache && Date.now() - _calCache.at < TTL_MS) return _calCache.value;
  let value = 1;
  try {
    const { data, error } = await supabase
      .from('edge_calibration')
      .select('key, multiplier')
      .in('key', ['Tennis:ml', 'Tennis']);
    if (!error && Array.isArray(data)) {
      const byKey = Object.fromEntries(data.map((r) => [r.key, Number(r.multiplier)]));
      const found = byKey['Tennis:ml'] ?? byKey['Tennis'];
      if (Number.isFinite(found)) value = found;
    }
  } catch { /* fail open to 1, uncalibrated beats no edge at all */ }
  _calCache = { at: Date.now(), value };
  return value;
}

/** Test hook. */
function _resetCache() { _cache = null; _calCache = null; }

module.exports = {
  buildRatingTable,
  ratingFromTable,
  seedEloFromPoints,
  expectedScore,
  createRatingsProvider,
  getTennisCalibrationMultiplier,
  _resetCache,
  K_FACTOR,
  UNRANKED_SEED,
  MIN_MATCHES_UNRANKED,
};
