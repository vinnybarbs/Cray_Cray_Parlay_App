// The sport day — now the SITE day.
//
// One company, one clock: TrapHawk keys every calendar day in
// America/Denver (see shared/site-day.js). This module used to bucket by
// US Eastern, which left game_results.date written in one zone while
// settlement matched in another — a seam that made same-pair series games
// hard to tell apart (regrade dispute, 2026-08-09). Now every writer and
// every matcher derive days the same way, so a stamped date and a
// settlement key can never disagree by construction.
//
// Eastern and Denver days only ever differ for starts between 10 PM and
// midnight Denver (00:00–01:59 ET). ESPN's ?dates=YYYYMMDD buckets are
// Eastern-shaped, which is fine: request buckets only choose which slate
// gets FETCHED, the sweeps walk multiple days, and same-game identity is
// decided by kickoff instants, never by bucket membership.

const { siteDay } = require('../../shared/site-day.js');

const SPORT_DAY_TZ = 'America/Denver';

// 'YYYY-MM-DD' site-day (America/Denver) for a Date or ISO timestamp.
function sportDayISO(dateLike = new Date()) {
  return siteDay(dateLike);
}

// 'YYYYMMDD', the shape ESPN scoreboard date params want.
function sportDayCompact(dateLike = new Date()) {
  return sportDayISO(dateLike).replace(/-/g, '');
}

// { year, month, day } of the site day, for season derivation.
function sportDayParts(dateLike = new Date()) {
  const [year, month, day] = sportDayISO(dateLike).split('-').map(Number);
  return { year, month, day };
}

// The instant N whole days before `from`. Feed the result back into the
// formatters above, whole-day arithmetic is timezone safe.
function daysAgo(n, from = new Date()) {
  const d = from instanceof Date ? new Date(from.getTime()) : new Date(from);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

module.exports = { SPORT_DAY_TZ, sportDayISO, sportDayCompact, sportDayParts, daysAgo };
