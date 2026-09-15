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

const LEAGUE_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/injuries';
const CACHE_TTL_MS = 30 * 60 * 1000;

let _cache = { at: 0, byTeam: null };

// Win-probability cost (fractions) of a STARTER out, by position group.
// QB dominates by design. Since 2026-09-15 (owner "yes", the Chargers
// week 2 read) the cost is gated by the player's depth chart rank, see
// depthWeight below, so a third string quarterback no longer costs the
// starter's 6pp.
const POSITION_OUT_COST = {
  QB: 0.06,
  RB: 0.015, WR: 0.015, TE: 0.012,
  LT: 0.012, RT: 0.010, OT: 0.010, G: 0.008, C: 0.008, OL: 0.008,
  DE: 0.010, DT: 0.008, EDGE: 0.010, LB: 0.008, OLB: 0.008, MLB: 0.008,
  CB: 0.010, S: 0.008, FS: 0.008, SS: 0.008, DB: 0.008,
  K: 0.004, P: 0.002,
};
const DEFAULT_OUT_COST = 0.006;

// Status multiplier against the OUT cost. Injured reserve is ZERO: it is
// a season-long absence the line priced weeks ago, and against a market
// anchored base the injury factor can only mean information newer than
// the line. Counting IR at full weight put every NFL team at the 8pp cap
// in week one (six to nine IR players each) and made the net swing noise
// (2026-09-12, owner: "all records and data showing in nfl is trash").
const STATUS_WEIGHT = {
  'out': 1.0,
  'injured reserve': 0,
  'ir': 0,
  'doubtful': 0.5,
  'questionable': 0.25,
};

// A team's total injury burden is capped: rosters absorb attrition and
// the market prices pile-ups better than naive addition does.
const TEAM_CAP = 0.08;

// The depth chart gate (2026-09-15, owner: "the depth chart gate only
// works if it is a starter, backup QB injured means nothing, WR3 means
// less than WR1"). Week 1 charged Garrett Nussmeier (KC, third
// quarterback) and Sam Ehlinger (DEN, third) the full 6pp, and
// Arizona's four outs led by a second tight end 4.2pp against the
// Chargers' 2.2pp, which moved the Cardinals at Chargers read 2pp
// toward the loser. The gate weights a report line by the player's BEST
// rank on his club's depth chart over the last 28 days of nflverse
// snapshots (nfl_depth_rank_floor view): clubs demote an injured
// starter (Josh Jacobs went from rank 1 to rank 4 the day he was hurt),
// so the newest chart alone would zero the very absence that matters.
// The rank is the club's order at that position across the formation
// (WR1 through WR7, RB1 through RB4, one starter and his backups per
// line slot), and the ladder below says what share of the position cost
// each rank carries. A player the chart does not list carries the
// injury_depth_unknown_weight dial (NFL 0.5, a name mismatch must not
// erase a starter).
const DEPTH_WINDOW_DAYS = 28;
const DEPTH_TTL_MS = 30 * 60 * 1000;
let _depth = { at: 0, byTeam: null };

// Share of the position cost by depth rank (index 0 is rank 1). Ranks
// past the end of a ladder cost nothing.
const DEPTH_LADDER = {
  QB: [1],                       // only the starter matters
  RB: [1, 0.5],                  // the second back carries
  WR: [1, 0.8, 0.6, 0.2],        // three receivers start, the fourth rotates
  TE: [1, 0.5],
  OL: [1],                       // one starter per line slot, his backup is nothing
  DL: [1, 0.5],                  // the line rotates
  LB: [1, 0.3],
  CB: [1, 0.5],                  // the nickel plays
  S:  [1, 0.3],
  ST: [1],                       // kicker, punter, long snapper
};
const POSITION_GROUP = [
  [/^QB$/, 'QB'], [/^(RB|HB|FB)$/, 'RB'], [/^WR$/, 'WR'], [/^TE$/, 'TE'],
  [/^(LT|RT|OT|T|LG|RG|G|C|OL|OG)$/, 'OL'],
  [/^(DE|DT|NT|DL|EDGE|LDE|RDE|LDT|RDT)$/, 'DL'],
  [/^(LB|OLB|ILB|MLB|LILB|RILB|SLB|WLB|LOLB|ROLB)$/, 'LB'],
  [/^(CB|NB|NCB|LCB|RCB|DB)$/, 'CB'], [/^(S|FS|SS)$/, 'S'], [/^(K|P|LS|PK)$/, 'ST'],
];
function positionGroup(position) {
  const pos = String(position || '').toUpperCase().trim();
  for (const [re, g] of POSITION_GROUP) if (re.test(pos)) return g;
  return null;
}

function nameKey(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/** Pure math: the gate multiplier for a depth rank at a position. */
function depthWeight(rank, position, { unknown = 0.5 } = {}) {
  if (rank == null || !Number.isFinite(Number(rank))) return unknown;
  const r = Math.max(1, Math.floor(Number(rank)));
  const ladder = DEPTH_LADDER[positionGroup(position)] || [1, 0.5];
  return ladder[r - 1] ?? 0;
}

/**
 * The rank floor per club from nfl_depth_rank_floor: for each player
 * the best (lowest) pos_rank over the window, by ESPN id and by name.
 * Cached 30 minutes. Null when the table is unavailable (the gate then
 * treats every line as unknown rank, half weight).
 */
async function loadDepthRanks(supabase) {
  if (_depth.byTeam && Date.now() - _depth.at < DEPTH_TTL_MS) return _depth.byTeam;
  if (!supabase) return _depth.byTeam;
  try {
    const { data, error } = await supabase.from('nfl_depth_rank_floor')
      .select('team, espn_id, player_key, pos_abb, best_rank').limit(6000);
    if (error || !Array.isArray(data)) return _depth.byTeam;
    const byTeam = new Map();
    for (const r of data) {
      if (!byTeam.has(r.team)) byTeam.set(r.team, new Map());
      const m = byTeam.get(r.team);
      const keep = (k) => { if (k && (!m.has(k) || m.get(k) > r.best_rank)) m.set(k, r.best_rank); };
      if (r.espn_id) keep(`id:${r.espn_id}`);
      keep(`name:${r.player_key}|${String(r.pos_abb || '').toUpperCase()}`);
      keep(`name:${r.player_key}`);
    }
    _depth = { at: Date.now(), byTeam };
    return byTeam;
  } catch {
    return _depth.byTeam;
  }
}

/** The best rank the window shows for one report line, or null. */
function lookupRank(ranks, teamAbbr, line) {
  const m = ranks && ranks.get(teamAbbr);
  if (!m) return null;
  if (line.espnId && m.has(`id:${line.espnId}`)) return m.get(`id:${line.espnId}`);
  const k = nameKey(line.player);
  const pos = String(line.position || '').toUpperCase();
  if (m.has(`name:${k}|${pos}`)) return m.get(`name:${k}|${pos}`);
  if (m.has(`name:${k}`)) return m.get(`name:${k}`);
  return null;
}

/**
 * Pure math: impact of one report line. Returns a NEGATIVE fraction
 * (cost to the injured player's team) or 0 for day-to-day noise.
 */
function positionImpact(position, status, depth = 1) {
  const pos = String(position || '').toUpperCase().trim();
  const st = String(status || '').toLowerCase().trim();
  const weight = STATUS_WEIGHT[st] ?? 0;
  if (weight === 0) return 0;
  const cost = POSITION_OUT_COST[pos] ?? DEFAULT_OUT_COST;
  const d = Number.isFinite(Number(depth)) ? Number(depth) : 1;
  if (d === 0) return 0;
  return -(cost * weight * d);
}

/** Pure math: sum a team's report lines, capped at TEAM_CAP. */
function teamImpact(reportLines) {
  if (!Array.isArray(reportLines) || reportLines.length === 0) return 0;
  const total = reportLines.reduce((s, r) => s + positionImpact(r.position, r.status, r.depth_weight ?? 1), 0);
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
        const href = Array.isArray(inj?.athlete?.links) ? inj.athlete.links[0]?.href : null;
        const idm = href ? String(href).match(/\/id\/(\d+)/) : null;
        lines.push({ player, position: position || '?', status, espnId: idm ? idm[1] : (inj?.athlete?.id ? String(inj.athlete.id) : null) });
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
async function getFootballInjuryImpact(teamName, opts = {}) {
  const byTeam = await loadLeague();
  if (!byTeam) return null;
  const key = String(teamName || '').toLowerCase();
  let raw = byTeam.get(key);
  if (!raw) {
    for (const [k, v] of byTeam) {
      if (k.includes(key) || key.includes(k)) { raw = v; break; }
    }
  }
  if (!raw) return { impact: 0, out: 0, doubtful: 0, questionable: 0, keyLoss: null, lines: [] };

  // The depth chart gate: each line carries the rank the window shows
  // and the weight the gate gives it. opts.depthRanks comes from
  // loadDepthRanks. Without it every line is unknown rank.
  const { teamAbbr } = require('./nfl-inactives.js');
  const abbr = teamAbbr(teamName);
  const gate = { unknown: opts.unknownWeight ?? 0.5 };
  const lines = raw.map(l => {
    const rank = lookupRank(opts.depthRanks, abbr, l);
    return { ...l, depth_rank: rank, depth_weight: depthWeight(rank, l.position, gate) };
  });

  const impact = teamImpact(lines);
  // The report the read was priced on, weighted statuses only (out,
  // doubtful, questionable). Stored on the analysis so the inactives
  // watch can diff the game day list against it, with the rank and the
  // gate weight so the dial board shows what each line cost.
  const report = lines
    .filter(l => (STATUS_WEIGHT[String(l.status).toLowerCase()] ?? 0) > 0)
    .map(l => ({ player: l.player, position: l.position, status: String(l.status).toLowerCase(), depth_rank: l.depth_rank, depth_weight: l.depth_weight }));
  const count = (st) => lines.filter(l => (STATUS_WEIGHT[String(l.status).toLowerCase()] ?? 0) ===
    (st === 'out' ? 1.0 : st === 'doubtful' ? 0.5 : 0.25)).length;
  // The single most costly absence, for the factor detail line.
  let keyLoss = null, keyCost = 0;
  for (const l of lines) {
    const c = positionImpact(l.position, l.status, l.depth_weight);
    if (c < keyCost) {
      keyCost = c;
      const rank = l.depth_rank == null ? 'rank unknown' : `rank ${l.depth_rank}`;
      keyLoss = `${l.player} (${l.position}, ${String(l.status).toLowerCase()}, ${rank})`;
    }
  }
  return { impact, out: count('out'), doubtful: count('doubtful'), questionable: count('questionable'), keyLoss, lines: report };
}

function _resetCache() { _cache = { at: 0, byTeam: null }; _depth = { at: 0, byTeam: null }; }
function _setDepthRanks(byTeam) { _depth = { at: Date.now(), byTeam }; }
function _setTeams(byTeam) { _cache = { at: Date.now(), byTeam }; }

/**
 * Overlay fresher per team lines (ESPN's game summary block, read by
 * watch-nfl-inactives at kickoff minus 90 minutes) onto the cached
 * league map, so a re-analysis fired for a late scratch prices the Out
 * even when the league feed or this cache lags it. Same line shape.
 */
async function overrideTeams(overrides) {
  const league = (await loadLeague()) || new Map();
  const byTeam = new Map(league);
  for (const [teamName, lines] of Object.entries(overrides || {})) {
    if (!teamName || !Array.isArray(lines)) continue;
    byTeam.set(String(teamName).toLowerCase(), lines.map(l => ({
      player: l.player, position: l.position || '?', status: l.status, espnId: l.espnId || null,
    })));
  }
  _cache = { at: Date.now(), byTeam };
  return byTeam;
}

module.exports = {
  getFootballInjuryImpact, positionImpact, teamImpact, depthWeight, positionGroup, DEPTH_LADDER, loadDepthRanks, lookupRank, nameKey,
  overrideTeams, _resetCache, _setTeams, _setDepthRanks, DEPTH_WINDOW_DAYS,
};
