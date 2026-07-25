/**
 * US Eastern game-day helper.
 *
 * Every "what day is this game" question in the pipeline is really asking for
 * the US Eastern calendar date: ESPN's `dates=` scoreboard param buckets by
 * Eastern, and a US evening game (8pm ET or later) already carries the NEXT
 * day's UTC date, so `toISOString().split('T')[0]` and server-local
 * getFullYear/getMonth/getDate both misattribute late games. Route all
 * day-boundary math through here instead.
 */

const EASTERN_TZ = 'America/New_York';

// en-CA gives YYYY-MM-DD directly; Intl handles EST/EDT transitions.
const easternDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: EASTERN_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Eastern calendar parts of an instant.
 * @param {Date|string|number} [date] - defaults to now
 * @returns {{year: number, month: number, day: number}} month is 1-12
 */
function sportDayParts(date = new Date()) {
  const [year, month, day] = easternDateFmt.format(toDate(date)).split('-').map(Number);
  return { year, month, day };
}

/**
 * Eastern game-day as YYYY-MM-DD.
 * @param {Date|string|number} [date] - defaults to now
 */
function sportDayISO(date = new Date()) {
  return easternDateFmt.format(toDate(date));
}

/**
 * Eastern game-day as YYYYMMDD (ESPN `dates=` param format).
 * @param {Date|string|number} [date] - defaults to now
 */
function sportDayCompact(date = new Date()) {
  return sportDayISO(date).replace(/-/g, '');
}

/**
 * The instant n*24h before `from`. Feed the result to sportDayISO/Compact to
 * get the Eastern game-day n days back.
 * @param {number} n
 * @param {Date|string|number} [from] - defaults to now
 */
function daysAgo(n, from = new Date()) {
  return new Date(toDate(from).getTime() - n * 24 * 60 * 60 * 1000);
}

module.exports = { EASTERN_TZ, sportDayParts, sportDayISO, sportDayCompact, daysAgo };
