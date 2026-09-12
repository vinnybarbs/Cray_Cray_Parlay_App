/**
 * Tile records: the season record shown next to each team on a game tile.
 *
 * Two sources, and the tile takes whichever has seen more games:
 *
 *   current_standings   ESPN's standings table (sync-standings cron).
 *                       Complete for the league, but the college feed
 *                       reported conference records as the season record
 *                       (2026-09-12: 123 of 124 FBS teams read 0-0 two
 *                       weeks in) and its names come from ESPN, which
 *                       disagree with the odds feed for some clubs
 *                       (Red Bull New York, LAFC, CF Montréal).
 *   team_latest_record  ESPN's scoreboard record stored on game_results
 *                       at settlement. Only covers games we tracked, but
 *                       the record itself is the team's full season record
 *                       after that game, and the names are the odds feed's
 *                       own, so they match the tile.
 *
 * A record only grows, so "more games" is the freshness test that needs
 * no clock. Ties go to the standings row (it carries the streak). Names
 * match through the shared team matcher (aliases, accents, club
 * suffixes) with the old bidirectional substring as a fallback.
 * Fail-soft: any query error yields empty records, never a throw.
 */

'use strict';

const { teamsMatch } = require('../utils/team-matcher.js');

// A scoreboard record is only this season's if it is dated on or after
// the sport's regular season floor: NFL preseason results in August
// carry records like 3-0 that would beat a true 0-0 standings row on a
// week one tile, and NBA rows from June would feed an October tile.
// Month and day of the earliest regular season game, by sport; the year
// is the current one unless the season straddles New Year and today is
// before the floor month, in which case it is last year's.
const SEASON_FLOOR_MONTH_DAY = {
  NFL: [9, 1], NCAAF: [8, 20], MLB: [3, 15], MLS: [2, 15],
  NBA: [10, 15], NHL: [10, 1], NCAAB: [11, 1], EPL: [8, 1],
};
const SCOREBOARD_MAX_AGE_DAYS = 45;

/** ISO date of the season floor for a sport as of `today` (a Date). */
function seasonRecordFloor(sport, today = new Date()) {
  const md = SEASON_FLOOR_MONTH_DAY[sport];
  const y = today.getFullYear();
  if (!md) {
    const d = new Date(today.getTime() - SCOREBOARD_MAX_AGE_DAYS * 86400 * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const [m, d] = md;
  const thisYear = new Date(y, m - 1, d);
  const year = today < thisYear ? y - 1 : y;
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Games played implied by a record string: "12-4-8" is 24, "0-0 (12-5 last yr)" is 0. */
function recordGames(record) {
  if (record == null) return null;
  const m = String(record).trim().match(/^(\d+)-(\d+)(?:-(\d+))?/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) + (m[3] != null ? Number(m[3]) : 0);
}

/** The record with more games wins; ties and nulls fall to the standings row. */
function chooseRecord(standingsRecord, scoreboardRecord) {
  const a = recordGames(standingsRecord);
  const b = recordGames(scoreboardRecord);
  if (b == null) return { record: standingsRecord ?? null, source: standingsRecord != null ? 'standings' : null };
  if (a == null) return { record: scoreboardRecord, source: 'scoreboard' };
  return b > a ? { record: scoreboardRecord, source: 'scoreboard' } : { record: standingsRecord, source: 'standings' };
}

function clean(name) {
  return String(name || '').replace(/[(),]/g, '').trim();
}

/** First row whose name is the team: matcher first, then the substring fallback. */
function findTeam(rows, teamName, key = 'team_name') {
  const q = clean(teamName);
  if (!q || !Array.isArray(rows)) return null;
  const exact = rows.find(r => teamsMatch(r[key], q));
  if (exact) return exact;
  const ql = q.toLowerCase();
  return rows.find(r => {
    const n = String(r[key] || '').toLowerCase();
    return n && (n.includes(ql) || ql.includes(n));
  }) || null;
}

function formatStandingsRecord(sport, s) {
  if (s == null || s.wins == null) return null;
  const ties = Number(s.ties) || 0;
  if (sport === 'EPL' || sport === 'MLS') return `${s.wins}-${ties}-${s.losses}`;
  return ties > 0 ? `${s.wins}-${s.losses}-${ties}` : `${s.wins}-${s.losses}`;
}

/**
 * { home_record, away_record, home_streak, away_streak, sources }.
 * Reads the sport's whole standings and scoreboard tables (30 to 200
 * rows) so matching happens in code, not in an ilike that cannot see
 * "Red Bull New York" for "New York Red Bulls".
 */
async function tileRecords(supabase, { sport, homeTeam, awayTeam }) {
  const out = { home_record: null, away_record: null, home_streak: null, away_streak: null, sources: {} };
  if (!sport || !homeTeam || !awayTeam) return out;
  let standings = [];
  let scoreboard = [];
  try {
    const since = seasonRecordFloor(sport);
    const [s, b] = await Promise.all([
      supabase.from('current_standings').select('team_name, wins, losses, ties, streak').eq('sport', sport),
      supabase.from('team_latest_record').select('team_name, record_str, as_of_date').eq('sport', sport).gte('as_of_date', since),
    ]);
    standings = Array.isArray(s?.data) ? s.data : [];
    scoreboard = Array.isArray(b?.data) ? b.data : [];
  } catch { /* fail soft */ }

  for (const side of ['home', 'away']) {
    const name = side === 'home' ? homeTeam : awayTeam;
    const s = findTeam(standings, name);
    const b = findTeam(scoreboard, name);
    const chosen = chooseRecord(formatStandingsRecord(sport, s), b ? b.record_str : null);
    out[`${side}_record`] = chosen.record;
    out[`${side}_streak`] = s?.streak || null;
    out.sources[side] = chosen.source;
  }
  return out;
}

module.exports = { tileRecords, recordGames, chooseRecord, findTeam, formatStandingsRecord, seasonRecordFloor, SCOREBOARD_MAX_AGE_DAYS };
