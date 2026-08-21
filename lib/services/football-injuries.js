/**
 * Position-aware football injury impact (NFL first).
 *
 * The generic injury factor counts status words in cached news text and
 * cannot tell a starting quarterback from a long snapper. Football is the
 * sport where that distinction IS the market: a starting QB ruled out
 * moves a fair line 4 to 7 points, a rotational lineman moves it almost
 * nothing. This service reads ESPN's league-wide injury feed (athlete
 * position + status per team), caches it 30 minutes, and converts a
 * team's report into a single win-probability impact.
 *
 * Fail-soft contract: any fetch or shape problem returns null and the
 * caller falls back to the generic capped word-count factor, so this can
 * never make coverage worse than before it existed. Weights are
 * deliberately conservative seeds; the preseason shadow window exists to
 * measure and refit them before anything publishes.
 */

'use strict';

const LEAGUE_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries';
const CACHE_TTL_MS = 30 * 60 * 1000;

let _cache = { at: 0, byTeam: null };

// Win-probability cost (fractions) of a player OUT, by position group.
// QB dominates by design. Depth-chart rank is not available from this
// feed, so skill and line positions carry averaged starter/backup weight.
const POSITION_OUT_COST = {
  QB: 0.06,
  RB: 0.015, WR: 0.015, TE: 0.012,
  LT: 0.012, RT: 0.010, OT: 0.010, G: 0.008, C: 0.008, OL: 0.008,
  DE: 0.010, DT: 0.008, EDGE: 0.010, LB: 0.008, OLB: 0.008, MLB: 0.008,
  CB: 0.010, S: 0.008, FS: 0.008, SS: 0.008, DB: 0.008,
  K: 0.004, P: 0.002,
};
const DEFAULT_OUT_COST = 0.006;

// Status multiplier against the OUT cost.
const STATUS_WEIGHT = {
  'out': 1.0,
  'injured reserve': 1.0,
  'ir': 1.0,
  'doubtful': 0.5,
  'questionable': 0.25,
};

// A team's total injury burden is capped: rosters absorb attrition and
// the market prices pile-ups better than naive addition does.
const TEAM_CAP = 0.08;

/**
 * Pure math: impact of one report line. Returns a NEGATIVE fraction
 * (cost to the injured player's team) or 0 for day-to-day noise.
 */
function positionImpact(position, status) {
  const pos = String(position || '').toUpperCase().trim();
  const st = String(status || '').toLowerCase().trim();
  const weight = STATUS_WEIGHT[st] ?? 0;
  if (weight === 0) return 0;
  const cost = POSITION_OUT_COST[pos] ?? DEFAULT_OUT_COST;
  return -(cost * weight);
}

/** Pure math: sum a team's report lines, capped at TEAM_CAP. */
function teamImpact(reportLines) {
  if (!Array.isArray(reportLines) || reportLines.length === 0) return 0;
  const total = reportLines.reduce((s, r) => s + positionImpact(r.position, r.status), 0);
  return Math.max(-TEAM_CAP, total);
}

async function loadLeague() {
  if (_cache.byTeam && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.byTeam;
  try {
    const res = await fetch(LEAGUE_URL);
    if (!res.ok) return _cache.byTeam;
    const data = await res.json();
    // ESPN shape: { injuries: [{ displayName|team.displayName, injuries: [
    //   { status, athlete: { displayName, position: { abbreviation } } }, ...] }] }
    // Parsed defensively; unknown shapes yield an empty map, not a throw.
    const teams = Array.isArray(data?.injuries) ? data.injuries : [];
    const byTeam = new Map();
    for (const t of teams) {
      const teamName = t?.displayName || t?.team?.displayName;
      const list = Array.isArray(t?.injuries) ? t.injuries : [];
      if (!teamName) continue;
      const lines = [];
      for (const inj of list) {
        const status = inj?.status || inj?.type?.description;
        const position = inj?.athlete?.position?.abbreviation || inj?.athlete?.position?.name;
        const player = inj?.athlete?.displayName;
        if (!status || !player) continue;
        lines.push({ player, position: position || '?', status });
      }
      byTeam.set(String(teamName).toLowerCase(), lines);
    }
    if (byTeam.size > 0) _cache = { at: Date.now(), byTeam };
    return _cache.byTeam;
  } catch {
    return _cache.byTeam;
  }
}

/**
 * Win-probability impact for one team, or null when the feed is
 * unavailable (caller falls back to the generic factor). Returns
 * { impact, out, doubtful, questionable, keyLoss } where impact <= 0.
 */
async function getFootballInjuryImpact(teamName) {
  const byTeam = await loadLeague();
  if (!byTeam) return null;
  const key = String(teamName || '').toLowerCase();
  let lines = byTeam.get(key);
  if (!lines) {
    for (const [k, v] of byTeam) {
      if (k.includes(key) || key.includes(k)) { lines = v; break; }
    }
  }
  if (!lines) return { impact: 0, out: 0, doubtful: 0, questionable: 0, keyLoss: null };

  const impact = teamImpact(lines);
  const count = (st) => lines.filter(l => (STATUS_WEIGHT[String(l.status).toLowerCase()] ?? 0) ===
    (st === 'out' ? 1.0 : st === 'doubtful' ? 0.5 : 0.25)).length;
  // The single most costly absence, for the factor detail line.
  let keyLoss = null, keyCost = 0;
  for (const l of lines) {
    const c = positionImpact(l.position, l.status);
    if (c < keyCost) { keyCost = c; keyLoss = `${l.player} (${l.position}, ${String(l.status).toLowerCase()})`; }
  }
  return { impact, out: count('out'), doubtful: count('doubtful'), questionable: count('questionable'), keyLoss };
}

function _resetCache() { _cache = { at: 0, byTeam: null }; }
function _setTeams(byTeam) { _cache = { at: Date.now(), byTeam }; }

module.exports = { getFootballInjuryImpact, positionImpact, teamImpact, _resetCache, _setTeams };
