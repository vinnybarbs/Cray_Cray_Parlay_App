/**
 * NFL availability data the line prices EARLIER and LATER than the
 * Friday designation list the injury factor reads (build_queue 11,
 * owner 2026-09-14: "make winning picks with data and math").
 *
 * Earlier: the official practice report (nflverse injuries release,
 * Wednesday through Friday participation per player) and the depth
 * chart (nflverse depth_charts release, who steps in). Both land in
 * tables so the replay harness can judge a practice participation
 * factor through the three test counterfactual after the freeze;
 * nothing here changes a published edge.
 *
 * Later: the game day inactives. ESPN's game summary carries a per game
 * injuries block that flips a player to Out when the inactives post.
 * watch-nfl-inactives diffs it against the report the analysis was
 * priced on and, on a new Out, marks the analysis stale so the existing
 * formula re-reads the game. No new rail, no weight, no label swap
 * (directive 16): fresher input through the same math.
 *
 * Everything that touches the network is fail soft and returns null;
 * the pure helpers are exported for tests.
 */

'use strict';

const { sportDayCompact } = require('./sport-day.js');

// Odds API and ESPN full names to the nflverse club code.
const NFL_ABBR = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL',
  'Buffalo Bills': 'BUF', 'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE', 'Dallas Cowboys': 'DAL',
  'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX',
  'Kansas City Chiefs': 'KC', 'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LA', 'Miami Dolphins': 'MIA', 'Minnesota Vikings': 'MIN',
  'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT',
  'San Francisco 49ers': 'SF', 'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
};
// nflverse has used both spellings for these clubs across seasons.
const ABBR_ALIASES = { LAR: 'LA', OAK: 'LV', SD: 'LAC', STL: 'LA', WSH: 'WAS', JAC: 'JAX' };

function teamAbbr(teamName) {
  const name = String(teamName || '').trim();
  if (NFL_ABBR[name]) return NFL_ABBR[name];
  const lower = name.toLowerCase();
  for (const [full, abbr] of Object.entries(NFL_ABBR)) {
    const f = full.toLowerCase();
    if (f === lower || f.includes(lower) || lower.includes(f)) return abbr;
  }
  return null;
}

function normalizeAbbr(code) {
  const c = String(code || '').toUpperCase().trim();
  return ABBR_ALIASES[c] || c || null;
}

const clean = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s === '' || s === 'NA' ? null : s;
};
const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * One nflverse injuries CSV row (object keyed by header) to an
 * nfl_injury_reports row, or null when it cannot key a player.
 */
function mapInjuryRow(d) {
  const season = toInt(d.season);
  const week = toInt(d.week);
  const team = normalizeAbbr(d.team);
  const fullName = clean(d.full_name) || [clean(d.first_name), clean(d.last_name)].filter(Boolean).join(' ') || null;
  if (season == null || week == null || !team || !fullName) return null;
  const gsis = clean(d.gsis_id);
  const reportInjury = [clean(d.report_primary_injury), clean(d.report_secondary_injury)].filter(Boolean).join(', ') || null;
  const practiceInjury = [clean(d.practice_primary_injury), clean(d.practice_secondary_injury)].filter(Boolean).join(', ') || null;
  return {
    season,
    week,
    season_type: clean(d.season_type) || 'REG',
    team,
    gsis_id: gsis,
    player_key: gsis || `${team}:${nameKey(fullName)}`,
    full_name: fullName,
    position: clean(d.position),
    report_status: clean(d.report_status),
    report_injury: reportInjury,
    practice_status: clean(d.practice_status),
    practice_injury: practiceInjury,
    updated_at: new Date().toISOString(),
  };
}

/**
 * nflverse depth_charts is a snapshot history (one dt per team per
 * fetch). Keep every snapshot at or after sinceIso (the depth gate reads
 * a player's best rank over the window, because clubs demote an injured
 * starter the day he is hurt), deduped on the slot key plus the
 * snapshot so a single upsert never touches a row twice. Without
 * sinceIso only each team's newest snapshot is kept (the pre 2026-09-15
 * behavior).
 */
function depthChartRows(rows, sinceIso = null) {
  const newest = new Map();
  for (const d of rows) {
    const team = normalizeAbbr(d.team);
    const dt = clean(d.dt);
    if (!team || !dt) continue;
    const prev = newest.get(team);
    if (!prev || dt > prev) newest.set(team, dt);
  }
  const out = new Map();
  for (const d of rows) {
    const team = normalizeAbbr(d.team);
    const dt = clean(d.dt);
    if (!team || !dt) continue;
    if (sinceIso ? dt < sinceIso : newest.get(team) !== dt) continue;
    const posGrp = clean(d.pos_grp) || '?';
    const posAbb = clean(d.pos_abb) || '?';
    const slot = toInt(d.pos_slot) ?? 0;
    const rank = toInt(d.pos_rank) ?? 0;
    const snapshotAt = new Date(dt).toISOString();
    const key = `${team}|${snapshotAt}|${posGrp}|${posAbb}|${slot}|${rank}`;
    out.set(key, {
      team,
      pos_grp: posGrp,
      pos_name: clean(d.pos_name),
      pos_abb: posAbb,
      pos_slot: slot,
      pos_rank: rank,
      player_name: clean(d.player_name),
      espn_id: clean(d.espn_id),
      gsis_id: clean(d.gsis_id),
      snapshot_at: snapshotAt,
    });
  }
  return [...out.values()];
}
const latestDepthChartRows = (rows) => depthChartRows(rows);

/**
 * ESPN game summary injuries block to { teamName: [{player, position,
 * status}] }. Same line shape football-injuries.js stores at analysis
 * time, so the two diff directly.
 */
function parseSummaryInjuries(summary) {
  const byTeam = {};
  const blocks = Array.isArray(summary?.injuries) ? summary.injuries : [];
  for (const b of blocks) {
    const teamName = b?.team?.displayName || b?.displayName;
    if (!teamName) continue;
    const lines = [];
    for (const inj of (Array.isArray(b.injuries) ? b.injuries : [])) {
      const player = inj?.athlete?.displayName;
      const status = inj?.status || inj?.type?.description;
      if (!player || !status) continue;
      lines.push({
        player,
        position: inj?.athlete?.position?.abbreviation || inj?.athlete?.position?.name || '?',
        status: String(status).toLowerCase().trim(),
      });
    }
    byTeam[teamName] = lines;
  }
  return byTeam;
}

/**
 * Players who are Out now and were not Out when the analysis priced the
 * game. A missing prior list means the analysis predates the stored
 * report: return null so the caller can say so instead of treating every
 * listed player as new.
 */
function diffScratches(priorLines, currentLines) {
  if (!Array.isArray(priorLines)) return null;
  const priorStatus = new Map();
  for (const l of priorLines) {
    if (l?.player) priorStatus.set(nameKey(l.player), String(l.status || '').toLowerCase().trim());
  }
  const scratches = [];
  for (const l of (currentLines || [])) {
    if (!l?.player) continue;
    const now = String(l.status || '').toLowerCase().trim();
    if (now !== 'out') continue;
    const before = priorStatus.get(nameKey(l.player));
    if (before === 'out') continue;
    scratches.push({ player: l.player, position: l.position || '?', from: before || 'not listed', to: 'out' });
  }
  return scratches;
}

const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

async function espnJson(url, fetchFn = fetch, timeoutMs = 10000) {
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

/** Pick the scoreboard event whose two clubs match ours nearest the kickoff. */
function matchEvent(scoreboard, homeTeam, awayTeam, gameDate) {
  const home = nameKey(homeTeam), away = nameKey(awayTeam);
  const target = new Date(gameDate).getTime();
  let best = null, bestGap = Infinity;
  for (const ev of (Array.isArray(scoreboard?.events) ? scoreboard.events : [])) {
    const comp = ev?.competitions?.[0];
    const comps = Array.isArray(comp?.competitors) ? comp.competitors : [];
    const h = comps.find(c => c.homeAway === 'home')?.team?.displayName;
    const a = comps.find(c => c.homeAway === 'away')?.team?.displayName;
    if (!h || !a) continue;
    const hk = nameKey(h), ak = nameKey(a);
    const homeOk = hk === home || hk.includes(home) || home.includes(hk);
    const awayOk = ak === away || ak.includes(away) || away.includes(ak);
    if (!homeOk || !awayOk) continue;
    const gap = Math.abs(new Date(ev.date).getTime() - target);
    if (gap < bestGap) { best = ev; bestGap = gap; }
  }
  return best && bestGap <= 12 * 3600 * 1000 ? String(best.id) : null;
}

async function findEspnEventId(homeTeam, awayTeam, gameDate, fetchFn = fetch) {
  const t = new Date(gameDate);
  if (Number.isNaN(t.getTime())) return null;
  // The site day (America/Denver, the only calendar day the pipeline
  // derives) and its neighbours, since ESPN buckets the scoreboard on
  // Eastern time and a late kickoff can sit on the next day there.
  const DAY = 24 * 3600 * 1000;
  const days = [...new Set([sportDayCompact(t), sportDayCompact(t.getTime() - DAY), sportDayCompact(t.getTime() + DAY)])];
  for (const day of days) {
    const sb = await espnJson(`${ESPN_SITE}/scoreboard?dates=${day}`, fetchFn);
    const id = matchEvent(sb, homeTeam, awayTeam, gameDate);
    if (id) return id;
  }
  return null;
}

async function fetchGameInjuries(eventId, fetchFn = fetch) {
  const summary = await espnJson(`${ESPN_SITE}/summary?event=${encodeURIComponent(eventId)}`, fetchFn);
  if (!summary) return null;
  return parseSummaryInjuries(summary);
}

/** Lines for one of our team names out of the summary map. */
function linesForTeam(byTeam, teamName) {
  if (!byTeam) return null;
  const key = nameKey(teamName);
  for (const [name, lines] of Object.entries(byTeam)) {
    const k = nameKey(name);
    if (k === key || k.includes(key) || key.includes(k)) return lines;
  }
  return null;
}

/**
 * Narration context only: the official practice report for both clubs
 * in the game's week, from nfl_injury_reports. Returns null when the
 * week's report is not in yet (Monday and Tuesday) so the caller falls
 * back to the ESPN status list. Never touches the edge.
 */
async function practiceReportText(supabase, homeTeam, awayTeam, gameDate, weekFor) {
  try {
    const wk = weekFor(gameDate);
    if (!wk) return null;
    const home = teamAbbr(homeTeam), away = teamAbbr(awayTeam);
    if (!home || !away) return null;
    const { data } = await supabase
      .from('nfl_injury_reports')
      .select('team, full_name, position, report_status, report_injury, practice_status, practice_injury')
      .eq('season', wk.season)
      .eq('week', wk.week)
      .in('team', [home, away])
      .order('team', { ascending: true })
      .limit(120);
    if (!data || data.length === 0) return null;
    const label = (abbr) => (abbr === home ? homeTeam : awayTeam);
    const short = (p) => {
      const s = String(p || '').toLowerCase();
      if (s.startsWith('did not')) return 'DNP';
      if (s.startsWith('limited')) return 'limited';
      if (s.startsWith('full')) return 'full';
      return p || 'no practice note';
    };
    const lines = [];
    for (const r of data) {
      // Full participation with no designation is the healthy case, skip it.
      if (!r.report_status && short(r.practice_status) === 'full') continue;
      const inj = r.report_injury || r.practice_injury;
      lines.push(`${label(r.team)}: ${r.full_name} (${r.position || '?'}) ${r.report_status || 'no designation'}${inj ? ', ' + inj : ''}, practice ${short(r.practice_status)}`);
      if (lines.length >= 24) break;
    }
    return lines.length ? `Official practice report, week ${wk.week}:\n${lines.join('\n')}` : null;
  } catch {
    return null;
  }
}

module.exports = {
  NFL_ABBR, ABBR_ALIASES, teamAbbr, normalizeAbbr, nameKey,
  mapInjuryRow, latestDepthChartRows, depthChartRows, parseSummaryInjuries, diffScratches,
  matchEvent, findEspnEventId, fetchGameInjuries, linesForTeam, practiceReportText,
  ESPN_SITE,
};
