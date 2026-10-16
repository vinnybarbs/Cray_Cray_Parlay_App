// Live game tracker for the Board (owner 2026-10-16: "a game tracker
// somewhere, maybe for the standard board"). For every started game that
// carries a published play or a trap call, the score, clock and
// situation from ESPN's scoreboard, and where the pick stands against it
// in plain words.
//
// Why ESPN: its site scoreboard is free, needs no key, and carries the
// clock, period, possession and down and distance. The Odds API scores
// endpoint carries team scores only. Display only: nothing here grades a
// pick, the grader still does that from final results, and the official
// outcome replaces this status once it lands.

const { sportDayCompact } = require('./sport-day.js');

const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports';

// Sports with an ESPN scoreboard the tracker reads. Soccer, UFC, tennis
// and golf stay off the tracker: their ESPN shapes differ and none of
// them publishes a play today.
const ESPN_PATHS = {
  NFL: 'football/nfl',
  NCAAF: 'football/college-football',
  NBA: 'basketball/nba',
  NCAAB: 'basketball/mens-college-basketball',
  MLB: 'baseball/mlb',
  NHL: 'hockey/nhl',
};

// Regulation length per sport for the pace estimate: periods and minutes
// per period. MLB counts innings with no clock.
const REGULATION = {
  NFL: { periods: 4, minutes: 15 },
  NCAAF: { periods: 4, minutes: 15 },
  NBA: { periods: 4, minutes: 12 },
  NCAAB: { periods: 2, minutes: 20 },
  NHL: { periods: 3, minutes: 20 },
  MLB: { periods: 9, minutes: null },
};

const CACHE_TTL_MS = 30 * 1000;
const scoreboardCache = new Map(); // url -> { at, payload }

const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

/** Two club names refer to the same club when one contains the other. Pure. */
function sameClub(a, b) {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** "8:42" to seconds. Pure. */
function clockSeconds(displayClock) {
  const m = String(displayClock || '').match(/^(\d+):(\d{2})(?:\.\d+)?$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const s = String(displayClock || '').match(/^:?(\d{1,2})(?:\.\d+)?$/);
  return s ? parseInt(s[1], 10) : null;
}

/**
 * One ESPN scoreboard event to the tracker's game shape. Pure.
 *   state: pre | in | post
 */
function parseEvent(ev, sport) {
  const comp = ev?.competitions?.[0];
  const comps = Array.isArray(comp?.competitors) ? comp.competitors : [];
  const side = (ha) => comps.find(c => c.homeAway === ha) || null;
  const h = side('home'), a = side('away');
  if (!h || !a) return null;
  const st = ev?.status || comp?.status || {};
  const type = st.type || {};
  const team = (c) => ({
    id: c.id != null ? String(c.id) : (c.team?.id != null ? String(c.team.id) : null),
    name: c.team?.displayName || c.team?.name || null,
    short: c.team?.shortDisplayName || c.team?.name || c.team?.displayName || null,
    abbr: c.team?.abbreviation || null,
    score: num(c.score),
  });
  const situation = comp?.situation || {};
  const period = num(st.period);
  return {
    espnId: ev.id != null ? String(ev.id) : null,
    sport,
    date: ev.date || comp?.date || null,
    state: type.state || null,
    final: type.completed === true || type.state === 'post',
    detail: type.shortDetail || type.detail || null,
    period,
    clock: st.displayClock || null,
    home: team(h),
    away: team(a),
    possession: situation.possession != null ? String(situation.possession) : null,
    downDistance: situation.shortDownDistanceText || situation.downDistanceText || null,
    outs: num(situation.outs),
    inningHalf: typeof type.detail === 'string' && /^(top|bot|mid|end)/i.test(type.detail) ? type.detail.split(' ')[0] : null,
  };
}

/** Every event in a scoreboard payload. Pure. */
function parseScoreboard(payload, sport) {
  return (Array.isArray(payload?.events) ? payload.events : []).map(ev => parseEvent(ev, sport)).filter(Boolean);
}

/** The event for our matchup nearest its kickoff, within 12 hours. Pure. */
function matchEvent(events, homeTeam, awayTeam, gameDate) {
  const target = new Date(gameDate).getTime();
  let best = null, bestGap = Infinity;
  for (const ev of events || []) {
    if (!sameClub(ev.home?.name, homeTeam) || !sameClub(ev.away?.name, awayTeam)) continue;
    const gap = Math.abs(new Date(ev.date).getTime() - target);
    if (gap < bestGap) { best = ev; bestGap = gap; }
  }
  return best && bestGap <= 12 * 3600 * 1000 ? best : null;
}

/**
 * How much of regulation has been played, 0 to 1, or null when the
 * payload does not say. Overtime counts as 1. Pure.
 */
function elapsedFraction(ev) {
  const reg = REGULATION[ev?.sport];
  if (!reg || ev.period == null) return null;
  if (ev.state === 'post') return 1;
  if (ev.period > reg.periods) return 1;
  if (reg.minutes == null) {
    // Innings: the top of the 5th is four full innings plus a half.
    const half = /^(bot|end|mid)/i.test(ev.inningHalf || '') ? 0.5 : 0;
    return Math.min(1, Math.max(0, (ev.period - 1 + half) / reg.periods));
  }
  const total = reg.periods * reg.minutes * 60;
  const left = clockSeconds(ev.clock);
  const done = (ev.period - 1) * reg.minutes * 60 + (left == null ? 0 : reg.minutes * 60 - left);
  return Math.min(1, Math.max(0, done / total));
}

/**
 * The pick string to a side. Pure.
 *   { kind: 'total', side: 'over' | 'under', line }
 *   { kind: 'ml', team }
 *   { kind: 'spread', team, line }
 */
function parsePick(pick, betType) {
  const text = String(pick || '').trim();
  if (!text) return null;
  const t = text.match(/^(over|under)\s+([\d.]+)/i);
  if (t) return { kind: 'total', side: t[1].toLowerCase(), line: parseFloat(t[2]) };
  const ml = text.match(/^(.+?)\s+ML\b/i);
  if (ml) return { kind: 'ml', team: ml[1].trim() };
  const sp = text.match(/^(.+?)\s+([+-]\d+(?:\.\d+)?)(?:\s*\(.*\))?$/);
  if (sp) return { kind: 'spread', team: sp[1].trim(), line: parseFloat(sp[2]) };
  if (/moneyline/i.test(betType || '')) return { kind: 'ml', team: text.replace(/\s+[+-]\d+$/, '').trim() };
  return null;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Where a pick stands against the score. Pure.
 *   status: ahead | behind | even | won | lost | push | unknown
 *   label:  the pill ("Covering by 3")
 *   note:   the sentence under it ("Needs to win by 4 or more")
 * An over that clears the number is won the moment it clears and an
 * under that goes over is lost the moment it does. Spreads and
 * moneylines settle at the final.
 */
function standing(pick, betType, ev, teams) {
  const p = parsePick(pick, betType);
  if (!p || !ev || ev.home?.score == null || ev.away?.score == null) return null;
  const hs = ev.home.score, as = ev.away.score;
  const final = !!ev.final;
  const unit = ev.sport === 'MLB' ? 'run' : ev.sport === 'NHL' ? 'goal' : 'point';

  if (p.kind === 'total') {
    const sum = hs + as;
    const diff = sum - p.line;
    const frac = elapsedFraction(ev);
    const pace = frac != null && frac >= 0.2 ? Math.round(sum / frac) : null;
    // Whole numbers push: under 47 at 23 has room for 23 more, over 47
    // needs 25. A half number has no push.
    const whole = Number.isInteger(p.line);
    const overNeeds = Math.ceil(p.line - sum) + (whole ? 1 : 0);
    const underRoom = Math.max(0, Math.ceil(p.line - sum) - 1);
    if (p.side === 'over') {
      if (diff > 0) return { status: 'won', label: final ? 'Final, over hit' : 'Over cleared', note: `${sum} ${unit}s so far, over ${p.line}`, sum, pace };
      if (final) return { status: diff === 0 ? 'push' : 'lost', label: diff === 0 ? 'Final, push' : 'Final, over missed', note: `${sum} ${unit}s, needed ${p.line}`, sum, pace };
      return { status: 'ahead', label: 'Over needs ' + plural(overNeeds, unit), note: pace != null ? `${sum} so far, on pace for ${pace}` : `${sum} ${unit}s so far`, sum, pace };
    }
    if (diff > 0) return { status: 'lost', label: final ? 'Final, under missed' : 'Under went over', note: `${sum} ${unit}s, the number was ${p.line}`, sum, pace };
    if (final) return { status: diff === 0 ? 'push' : 'won', label: diff === 0 ? 'Final, push' : 'Final, under hit', note: `${sum} ${unit}s, under ${p.line}`, sum, pace };
    return { status: 'ahead', label: 'Under is live', note: `Room for ${plural(underRoom, 'more ' + unit)}${pace != null ? `, on pace for ${pace}` : ''}`, sum, pace };
  }

  const isHome = sameClub(p.team, teams.home_team) || sameClub(p.team, ev.home.name);
  const isAway = !isHome && (sameClub(p.team, teams.away_team) || sameClub(p.team, ev.away.name));
  if (!isHome && !isAway) return null;
  const mine = isHome ? hs : as, theirs = isHome ? as : hs;
  const margin = mine - theirs;

  if (p.kind === 'ml') {
    if (final) {
      if (margin > 0) return { status: 'won', label: 'Final, won', note: `Won by ${margin}` };
      if (margin < 0) return { status: 'lost', label: 'Final, lost', note: `Lost by ${-margin}` };
      return { status: 'push', label: 'Final, tie', note: 'Graded a push' };
    }
    if (margin > 0) return { status: 'ahead', label: `Ahead by ${margin}`, note: 'Wins if it holds on' };
    if (margin < 0) return { status: 'behind', label: `Behind by ${-margin}`, note: 'Needs to come back to win' };
    return { status: 'even', label: 'Tied', note: 'Needs to pull ahead' };
  }

  // Spread: cover is the margin plus the number.
  const cover = margin + p.line;
  const need = p.line < 0
    ? `Needs to win by ${Number.isInteger(p.line) ? -p.line + 1 : Math.ceil(-p.line)} or more`
    : p.line > 0
      ? `Covers if it loses by ${Number.isInteger(p.line) ? p.line - 1 : Math.floor(p.line)} or less, or wins`
      : 'Needs to win';
  if (final) {
    if (cover > 0) return { status: 'won', label: 'Final, covered', note: `Covered by ${cover}` };
    if (cover < 0) return { status: 'lost', label: 'Final, missed', note: `Missed by ${-cover}` };
    return { status: 'push', label: 'Final, push', note: 'Landed on the number' };
  }
  if (cover > 0) return { status: 'ahead', label: `Covering by ${cover}`, note: need };
  if (cover < 0) return { status: 'behind', label: `Not covering, ${-cover} short`, note: need };
  return { status: 'even', label: 'On the number', note: need };
}

/** The pick text for a trap side from the game row, the board's wording. Pure. */
function sideText(game, side) {
  const sp = game.spread != null ? Number(game.spread) : null;
  const fmt = (n) => `${n > 0 ? '+' : ''}${n}`;
  switch (side) {
    case 'home_ml': return `${game.home_team} ML`;
    case 'away_ml': return `${game.away_team} ML`;
    case 'home_spread': return sp != null ? `${game.home_team} ${fmt(sp)}` : null;
    case 'away_spread': return sp != null ? `${game.away_team} ${fmt(-sp)}` : null;
    case 'over': return game.total != null ? `Over ${game.total}` : null;
    case 'under': return game.total != null ? `Under ${game.total}` : null;
    default: return null;
  }
}

async function espnJson(url, fetchFn, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { headers: { 'User-Agent': 'TrapHawk/1.0' }, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One scoreboard fetch per sport per day per 30 seconds, whoever asks. */
async function cachedScoreboard(sport, dayCompact, fetchFn, now = Date.now()) {
  const url = `${ESPN_SITE}/${ESPN_PATHS[sport]}/scoreboard?dates=${dayCompact}`;
  const hit = scoreboardCache.get(url);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.payload;
  const payload = await espnJson(url, fetchFn);
  if (payload) scoreboardCache.set(url, { at: now, payload });
  return payload || hit?.payload || null;
}

/**
 * Live state for every started game row that has a published pick or a
 * trap call. Rows are game_analysis rows with published_pick attached
 * (api/digest attachPublishedPicks, started mode).
 * Returns { games: { [game_key]: { ...event, pick, traps } }, asOf }.
 */
async function liveGames(rows, { fetchFn = fetch, now = Date.now() } = {}) {
  const out = {};
  // A game counts as ours when it carries the headline pick, a spotlight
  // (alt market) pick, or a trap call. The 2026-10-15 Seahawks at
  // Broncos spread was a spotlight only and missed the first cut.
  const hasRead = (g) => g.published_pick?.pick
    || (Array.isArray(g.published_alts) && g.published_alts.length > 0)
    || (Array.isArray(g.trap_calls) && g.trap_calls.length > 0);
  const tracked = (rows || []).filter(g => g && ESPN_PATHS[g.sport] && hasRead(g));
  const bySportDay = new Map();
  for (const g of tracked) {
    const t = new Date(g.game_date);
    if (Number.isNaN(t.getTime())) continue;
    const DAY = 24 * 3600 * 1000;
    // ESPN buckets on Eastern time, so a late kickoff sits on the next day.
    for (const d of new Set([sportDayCompact(t), sportDayCompact(t.getTime() + DAY)])) {
      const k = `${g.sport}|${d}`;
      if (!bySportDay.has(k)) bySportDay.set(k, { sport: g.sport, day: d });
    }
  }
  const eventsBySport = new Map();
  await Promise.all([...bySportDay.values()].map(async ({ sport, day }) => {
    const payload = await cachedScoreboard(sport, day, fetchFn, now);
    if (!payload) return;
    const list = eventsBySport.get(sport) || [];
    for (const ev of parseScoreboard(payload, sport)) if (!list.some(e => e.espnId === ev.espnId)) list.push(ev);
    eventsBySport.set(sport, list);
  }));
  for (const g of tracked) {
    const ev = matchEvent(eventsBySport.get(g.sport), g.home_team, g.away_team, g.game_date);
    if (!ev || ev.state === 'pre') continue;
    const teams = { home_team: g.home_team, away_team: g.away_team };
    const pub = g.published_pick;
    const traps = {};
    for (const t of (Array.isArray(g.trap_calls) ? g.trap_calls : [])) {
      const text = sideText(g, t.side);
      const s = text ? standing(text, null, ev, teams) : null;
      if (s) traps[t.side] = s;
    }
    const alts = {};
    for (const alt of (Array.isArray(g.published_alts) ? g.published_alts : [])) {
      const s = standing(alt.pick, alt.bet_type, ev, teams);
      if (s) alts[alt.pick] = s;
    }
    out[g.game_key] = {
      state: ev.state,
      final: ev.final,
      detail: ev.detail,
      period: ev.period,
      clock: ev.clock,
      home: { name: ev.home.name, short: ev.home.short, abbr: ev.home.abbr, score: ev.home.score, possession: ev.possession != null && ev.possession === ev.home.id },
      away: { name: ev.away.name, short: ev.away.short, abbr: ev.away.abbr, score: ev.away.score, possession: ev.possession != null && ev.possession === ev.away.id },
      downDistance: ev.downDistance,
      pick: pub?.pick ? standing(pub.pick, pub.bet_type, ev, teams) : null,
      alts,
      traps,
    };
  }
  return { games: out, asOf: new Date(now).toISOString() };
}

function _resetCache() { scoreboardCache.clear(); }

module.exports = {
  ESPN_PATHS, REGULATION, CACHE_TTL_MS,
  parseEvent, parseScoreboard, matchEvent, elapsedFraction, clockSeconds,
  parsePick, standing, sideText, sameClub, liveGames, _resetCache,
};
