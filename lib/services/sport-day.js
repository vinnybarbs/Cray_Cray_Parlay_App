// The sport day.
//
// US sports define a game's "day" by the US Eastern calendar date of first
// pitch or tipoff. Not UTC, not server-local time. A 10:05 PM ET start on
// July 23 is a July 23 game even though its timestamp reads 02:05 UTC July
// 24, and ESPN's ?dates=YYYYMMDD buckets agree with Eastern, not UTC.
//
// Every pipeline writer that stamps a date column, and every "today" used
// to build an ESPN date param, must go through these helpers. Ad hoc
// `toISOString().slice(0, 10)` or local Date getters attribute every
// evening game to the wrong day on a UTC server (audit 2026-07-24: the
// Royals record was fine, but game_results dates were skewing last-N form
// windows and ATS cutoffs).

const SPORT_DAY_TZ = 'America/New_York';

// 'YYYY-MM-DD' Eastern calendar date for a Date or ISO timestamp.
// en-CA is the locale whose short date format is already ISO shaped.
function sportDayISO(dateLike = new Date()) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return d.toLocaleDateString('en-CA', { timeZone: SPORT_DAY_TZ });
}

// 'YYYYMMDD', the shape ESPN scoreboard date params want.
function sportDayCompact(dateLike = new Date()) {
  return sportDayISO(dateLike).replace(/-/g, '');
}

// { year, month } of the Eastern game day, for season derivation.
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
