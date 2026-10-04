/**
 * NHL starting goalies: who starts, how good he is, and the win
 * probability move the gap is worth. The hockey twin of the MLB probable
 * starters factor (probable-pitchers.js), built the night NHL went live
 * (owner 2026-10-03: "the starting goalie is to hockey what the probable
 * starter is to baseball").
 *
 * Who starts: DailyFaceoff's starting goalies page (one JSON blob in the
 * page, per game: both goalies, a news strength of Confirmed, Likely,
 * Projected or Unconfirmed, the source and the time), with ESPN's NHL
 * scoreboard probables (probableStartingGoalie per club) as the fallback
 * when the page is unreachable or does not list the game.
 *
 * How good: the NHL API. The player search maps a name to a player id,
 * the player landing gives regular season totals per season (shots
 * against, save percentage). The quality number is a shots weighted
 * blend of the current season, the prior season and a league prior of
 * 600 shots at .905, so two October starts cannot make a .789 goalie
 * and a rookie with no NHL season reads as league average.
 *
 * The move: four points of home win probability per .010 of blended
 * save percentage gap, capped at six, times goalie_anchor_damp (NHL 0.5)
 * when the read is market anchored. Same shape as the ERA factor.
 *
 * Fail soft at every step: no page, no search hit, no landing, no
 * factor. The read then carries no Starting goalies row, the shadow
 * gate goalie_required logs it, and the no_goalie_penalty_pp rail (NHL,
 * seeded 0) can deduct once the evidence says it should.
 */

'use strict';

const DFO_URL = 'https://www.dailyfaceoff.com/starting-goalies/';
const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard';
const NHL_SEARCH = 'https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=8&q=';
const NHL_PLAYER = 'https://api-web.nhle.com/v1/player/';

const STARTERS_TTL_MS = 15 * 60 * 1000;
const STATS_TTL_MS = 12 * 60 * 60 * 1000;
const LEAGUE_SAVE_PCT = 0.905;
const PRIOR_SHOTS = 600;
const PP_PER_010 = 0.04;
const CAP = 0.06;
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; TrapHawk/1.0)' };

let _starters = { at: 0, byTeam: null, source: null };
const _stats = new Map();

function nameKey(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

async function fetchText(url, fetchFn = fetch, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { headers: UA, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, fetchFn = fetch, timeoutMs = 10000) {
  const text = await fetchText(url, fetchFn, timeoutMs);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Pure: the DailyFaceoff page to a map of team name key to starter. */
function parseDailyFaceoff(html) {
  const m = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s.exec(String(html || ''));
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }
  const games = data?.props?.pageProps?.data;
  if (!Array.isArray(games)) return null;
  const byTeam = new Map();
  for (const g of games) {
    for (const side of ['home', 'away']) {
      const team = g[`${side}TeamName`];
      const name = g[`${side}GoalieName`];
      if (!team || !name) continue;
      byTeam.set(nameKey(team), {
        team,
        name,
        status: g[`${side}NewsStrengthName`] || 'Unconfirmed',
        news: g[`${side}NewsDetails`] || null,
        season_sv: Number(g[`${side}GoalieSavePercentage`]) || null,
        season_gaa: Number(g[`${side}GoalieGoalsAgainstAvg`]) || null,
        date: g.date || null,
        source: 'dailyfaceoff',
      });
    }
  }
  return byTeam;
}

/** Pure: the ESPN scoreboard to the same map, status Probable. */
function parseEspnProbables(scoreboard) {
  const byTeam = new Map();
  for (const e of scoreboard?.events || []) {
    for (const c of e?.competitions?.[0]?.competitors || []) {
      const team = c?.team?.displayName;
      const p = (c?.probables || []).find(x => x?.name === 'probableStartingGoalie') || (c?.probables || [])[0];
      const name = p?.athlete?.displayName || p?.athlete?.fullName;
      if (!team || !name) continue;
      byTeam.set(nameKey(team), { team, name, status: 'Probable', news: null, season_sv: null, season_gaa: null, date: e?.date || null, source: 'espn' });
    }
  }
  return byTeam;
}

function lookupTeam(byTeam, teamName) {
  if (!byTeam) return null;
  const k = nameKey(teamName);
  if (byTeam.has(k)) return byTeam.get(k);
  for (const [key, v] of byTeam) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  const mascot = k.split(' ').slice(-1)[0];
  for (const [key, v] of byTeam) {
    if (mascot && key.endsWith(mascot)) return v;
  }
  return null;
}

/** The starters map, DailyFaceoff first, ESPN when the page is dark. */
async function loadStarters(fetchFn = fetch) {
  if (_starters.byTeam && Date.now() - _starters.at < STARTERS_TTL_MS) return _starters;
  const html = await fetchText(DFO_URL, fetchFn);
  const dfo = html ? parseDailyFaceoff(html) : null;
  if (dfo && dfo.size > 0) {
    _starters = { at: Date.now(), byTeam: dfo, source: 'dailyfaceoff' };
    return _starters;
  }
  const sb = await fetchJson(ESPN_SCOREBOARD, fetchFn);
  const espn = sb ? parseEspnProbables(sb) : null;
  if (espn && espn.size > 0) {
    _starters = { at: Date.now(), byTeam: espn, source: 'espn' };
    return _starters;
  }
  return _starters.byTeam ? _starters : { at: 0, byTeam: null, source: null };
}

/** Pure: shots weighted blend of current, prior and the league prior. */
function blendedSavePct(seasons) {
  let num = LEAGUE_SAVE_PCT * PRIOR_SHOTS;
  let den = PRIOR_SHOTS;
  let shots = 0;
  for (const s of seasons || []) {
    const sa = Number(s?.shotsAgainst);
    const sv = Number(s?.savePctg);
    if (!Number.isFinite(sa) || sa <= 0 || !Number.isFinite(sv) || sv <= 0 || sv > 1) continue;
    num += sv * sa;
    den += sa;
    shots += sa;
  }
  return { sv: Math.round((num / den) * 10000) / 10000, shots };
}

/** The two most recent NHL regular seasons for a goalie, by name. */
async function goalieStats(name, fetchFn = fetch) {
  const key = nameKey(name);
  if (!key) return null;
  const cached = _stats.get(key);
  if (cached && Date.now() - cached.at < STATS_TTL_MS) return cached.value;
  let value = null;
  try {
    const hits = await fetchJson(NHL_SEARCH + encodeURIComponent(name), fetchFn);
    const hit = (Array.isArray(hits) ? hits : [])
      .filter(h => h && h.positionCode === 'G')
      .sort((a, b) => (nameKey(b.name) === key) - (nameKey(a.name) === key) || (b.active === true) - (a.active === true))[0];
    if (hit?.playerId) {
      const landing = await fetchJson(`${NHL_PLAYER}${hit.playerId}/landing`, fetchFn);
      const seasons = (landing?.seasonTotals || [])
        .filter(s => s && s.gameTypeId === 2 && s.leagueAbbrev === 'NHL')
        .sort((a, b) => Number(b.season) - Number(a.season))
        .slice(0, 2);
      const blend = blendedSavePct(seasons);
      value = { playerId: String(hit.playerId), name: hit.name || name, sv: blend.sv, shots: blend.shots, seasons: seasons.map(s => ({ season: s.season, shotsAgainst: s.shotsAgainst, savePctg: s.savePctg })) };
    }
  } catch { value = null; }
  _stats.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Both starters with their blended save percentage, or null when either
 * club has no named goalie. A named goalie with no NHL history reads
 * league average with zero shots.
 */
async function getStartingGoalies(homeTeam, awayTeam, fetchFn = fetch) {
  const { byTeam, source } = await loadStarters(fetchFn);
  if (!byTeam) return null;
  const home = lookupTeam(byTeam, homeTeam);
  const away = lookupTeam(byTeam, awayTeam);
  if (!home || !away) return null;
  const [hs, as] = await Promise.all([goalieStats(home.name, fetchFn), goalieStats(away.name, fetchFn)]);
  const pack = (s, st) => ({
    name: s.name, status: s.status, news: s.news, source,
    sv: st?.sv ?? LEAGUE_SAVE_PCT, shots: st?.shots ?? 0, playerId: st?.playerId || null,
  });
  return { home: pack(home, hs), away: pack(away, as), source };
}

/** Pure math: home win probability move from the blended save pct gap. */
function goalieSvAdjustment(homeSv, awaySv) {
  if (homeSv == null || awaySv == null) return 0;
  const h = Number(homeSv), a = Number(awaySv);
  if (!Number.isFinite(h) || !Number.isFinite(a) || h <= 0 || a <= 0 || h > 1 || a > 1) return 0;
  const adj = (h - a) * (PP_PER_010 / 0.010);
  return Math.max(-CAP, Math.min(CAP, Math.round(adj * 10000) / 10000));
}

function fmtSv(sv) {
  return Number.isFinite(Number(sv)) ? Number(sv).toFixed(3).replace(/^0/, '') : '?';
}

/** Narration line. Names outside the parentheses so the change gate keys on them. */
async function getStartingGoaliesText(homeTeam, awayTeam, fetchFn = fetch) {
  const g = await getStartingGoalies(homeTeam, awayTeam, fetchFn);
  if (!g) return null;
  return `${g.away.name} (${g.away.status}, ${fmtSv(g.away.sv)} blended save pct) at ${g.home.name} (${g.home.status}, ${fmtSv(g.home.sv)} blended save pct)`;
}

function _resetCache() { _starters = { at: 0, byTeam: null, source: null }; _stats.clear(); }

module.exports = {
  parseDailyFaceoff, parseEspnProbables, lookupTeam, loadStarters, blendedSavePct, goalieStats,
  getStartingGoalies, goalieSvAdjustment, getStartingGoaliesText, fmtSv, nameKey, _resetCache,
  LEAGUE_SAVE_PCT, PRIOR_SHOTS, CAP,
};
