// Live prop tracking (owner 2026-10-16: "props tracker and show
// progress, and hit or miss"). For every started prop read, the player's
// stat so far from the ESPN live box score, and where it stands against
// the line.
//
// Why ESPN and not the Odds API: the Odds API sells prices and final
// game scores, not player box scores, so more Odds API credits buy no
// stats. ESPN's summary endpoint (already used for inactives and the box
// score sync) carries the live box score, refreshed every play. The
// official grade still comes from nflverse the next day and is never
// written here. This is display only.

const { findEspnEventId, ESPN_SITE } = require('./nfl-inactives');

const TD_MARKET = 'player_anytime_td';

// The stat a market tracks, from one parsed box score line. Anytime TD
// counts rushing plus receiving scores, the same as the grader.
const STAT_FOR = {
  player_receptions: s => s.receptions,
  player_reception_yds: s => s.receiving_yards,
  player_rush_yds: s => s.rushing_yards,
  player_pass_yds: s => s.passing_yards,
  player_pass_tds: s => s.passing_tds,
  [TD_MARKET]: s => s.rushing_tds + s.receiving_tds,
};

// ESPN stat keys per group, with the label as a fallback when a payload
// carries labels only.
const GROUP_FIELDS = {
  passing: [['passingYards', 'YDS', 'passing_yards'], ['passingTouchdowns', 'TD', 'passing_tds']],
  rushing: [['rushingYards', 'YDS', 'rushing_yards'], ['rushingTouchdowns', 'TD', 'rushing_tds']],
  receiving: [['receptions', 'REC', 'receptions'], ['receivingYards', 'YDS', 'receiving_yards'], ['receivingTouchdowns', 'TD', 'receiving_tds']],
};

const emptyLine = () => ({ receptions: 0, receiving_yards: 0, rushing_yards: 0, passing_yards: 0, passing_tds: 0, rushing_tds: 0, receiving_tds: 0 });

/** "A.J. Brown Jr." and "AJ Brown" key the same. Pure. */
function playerKey(name) {
  return String(name || '').toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const num = (v) => {
  const n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * One ESPN summary payload to the game state and every player's line so
 * far. Players with no stat yet are simply absent. Pure.
 */
function parseSummary(summary) {
  const comp = summary?.header?.competitions?.[0];
  const st = comp?.status?.type || {};
  const comps = Array.isArray(comp?.competitors) ? comp.competitors : [];
  const side = (ha) => comps.find(c => c.homeAway === ha) || {};
  const game = {
    state: st.state || null, // pre, in, post
    final: st.completed === true || st.state === 'post',
    detail: st.shortDetail || st.detail || null,
    homeAbbr: side('home').team?.abbreviation || null,
    awayAbbr: side('away').team?.abbreviation || null,
    homeScore: side('home').score != null ? num(side('home').score) : null,
    awayScore: side('away').score != null ? num(side('away').score) : null,
  };
  const players = new Map();
  for (const team of (summary?.boxscore?.players || [])) {
    for (const group of (team.statistics || [])) {
      const fields = GROUP_FIELDS[String(group.name || '').toLowerCase()];
      if (!fields) continue;
      const keys = group.keys || [];
      const labels = group.labels || [];
      for (const a of (group.athletes || [])) {
        const k = playerKey(a.athlete?.displayName || a.athlete?.fullName);
        if (!k) continue;
        if (!players.has(k)) players.set(k, { name: a.athlete?.displayName || null, ...emptyLine() });
        const line = players.get(k);
        for (const [key, label, out] of fields) {
          let i = keys.indexOf(key);
          if (i < 0) i = labels.indexOf(label);
          if (i >= 0) line[out] += num(a.stats?.[i]);
        }
      }
    }
  }
  return { game, players };
}

/**
 * The box score line for a prop's player: an exact key, else a unique
 * first initial plus last name match ("Ken Walker" vs "Kenneth Walker").
 * Pure.
 */
function findPlayer(players, name) {
  const k = playerKey(name);
  if (players.has(k)) return players.get(k);
  const parts = k.split(' ');
  if (parts.length < 2) return null;
  const first = parts[0][0], last = parts[parts.length - 1];
  const hits = [...players.entries()].filter(([pk]) => {
    const p = pk.split(' ');
    return p.length >= 2 && p[p.length - 1] === last && p[0][0] === first;
  });
  return hits.length === 1 ? hits[0][1] : null;
}

/**
 * Where one read stands. status is one of
 *   live   still open, the game is on
 *   hit    already won (an over cleared, or final on our side)
 *   miss   already lost (an under went over, or final short)
 *   push   final, exactly on the line
 *   no_stats  final and the player never recorded a stat (likely void)
 * An over that clears the line is a hit the moment it clears, and an
 * under that goes over is a miss the moment it does: neither can come
 * back. Pure.
 */
function progressFor(read, game, players) {
  const stat = STAT_FOR[read.market];
  if (!stat || !game) return null;
  const line = Number(read.line);
  const isTd = read.market === TD_MARKET;
  const found = findPlayer(players, read.player);
  const current = found ? stat(found) : 0;
  const over = read.side === 'over';
  let status = 'live';
  if (isTd) {
    if (current >= 1) status = over ? 'hit' : 'miss';
    else if (game.final) status = found ? (over ? 'miss' : 'hit') : 'no_stats';
  } else if (Number.isFinite(line)) {
    if (current > line) status = over ? 'hit' : 'miss';
    else if (game.final) {
      if (!found) status = 'no_stats';
      else if (current === line) status = 'push';
      else status = over ? 'miss' : 'hit';
    }
  }
  return { current, status, final: game.final };
}

const keyFor = (r) => `${r.playerKey || r.player}|${r.market}|${r.side}|${r.line}`;
const gameKey = (r) => `${r.away_team}|${r.home_team}|${r.commence_time}`;

// Small in-process caches: ESPN event ids never change, a summary is
// good for SUMMARY_TTL_MS. One fetch per started game per window no
// matter how many visitors poll.
const SUMMARY_TTL_MS = 30 * 1000;
const eventIds = new Map();
const summaries = new Map();

async function getJson(url, fetchFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetchFn(url, { headers: { 'User-Agent': 'TrapHawk/1.0' }, signal: controller.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function summaryFor(r, fetchFn, now) {
  const gk = gameKey(r);
  let id = eventIds.get(gk);
  if (!id) {
    id = await findEspnEventId(r.home_team, r.away_team, r.commence_time, fetchFn);
    if (!id) return null;
    eventIds.set(gk, id);
  }
  const hit = summaries.get(id);
  // A final box score is kept: the props page asks for finished games
  // until the official grade lands, and those numbers no longer move.
  if (hit && (hit.parsed.game.final || now - hit.at < SUMMARY_TTL_MS)) return hit.parsed;
  const json = await getJson(`${ESPN_SITE}/summary?event=${encodeURIComponent(id)}`, fetchFn);
  if (!json) return hit ? hit.parsed : null;
  const parsed = parseSummary(json);
  summaries.set(id, { at: now, parsed });
  return parsed;
}

/**
 * Live progress for a list of started reads (the /api/props live shape).
 * Returns { games: { [gameKey]: game }, reads: { [readKey]: progress } }.
 * A game ESPN cannot find or answer simply has no entry.
 */
async function liveProgress(reads, { fetchFn = fetch, now = Date.now() } = {}) {
  const byGame = new Map();
  for (const r of reads || []) {
    if (!byGame.has(gameKey(r))) byGame.set(gameKey(r), []);
    byGame.get(gameKey(r)).push(r);
  }
  const games = {};
  const out = {};
  await Promise.all([...byGame.entries()].map(async ([gk, list]) => {
    const parsed = await summaryFor(list[0], fetchFn, now);
    if (!parsed || !parsed.game.state || parsed.game.state === 'pre') return;
    games[gk] = parsed.game;
    for (const r of list) {
      const p = progressFor(r, parsed.game, parsed.players);
      if (p) out[keyFor(r)] = p;
    }
  }));
  return { games, reads: out };
}

function clearCaches() {
  eventIds.clear();
  summaries.clear();
}

/**
 * The parsed box score for one game ({ game, players }) from any read
 * of it, or null when ESPN cannot find or answer it. The settlement
 * grader uses it once the game is final.
 */
async function boxScoreFor(read, { fetchFn = fetch, now = Date.now() } = {}) {
  return summaryFor(read, fetchFn, now);
}

module.exports = { parseSummary, findPlayer, progressFor, liveProgress, boxScoreFor, playerKey, keyFor, gameKey, clearCaches, STAT_FOR };
