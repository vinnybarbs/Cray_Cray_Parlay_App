/**
 * The site's calendar day (2026-08-08 incident, "Africa time").
 *
 * Every evening game after 6 PM Denver was filing under TOMORROW: game
 * keys, auto_digest session ids, and the board-history day were all
 * derived from the UTC clock, so yesterday's results wore today's date
 * and tonight's games wore tomorrow's. A sports day is a local concept.
 * One rule: whenever the system needs a CALENDAR DAY for bucketing or
 * display, compute it in the site's home timezone, America/Denver.
 * Storage stays timestamptz, this only governs day derivation.
 */

'use strict';

const SITE_TZ = 'America/Denver';

// 'YYYY-MM-DD' for the given instant, in the site's timezone.
function siteDay(d = new Date()) {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: SITE_TZ });
}

// siteDay shifted by N whole days (negative for past).
function siteDayOffset(days, from = new Date()) {
  return siteDay(new Date(new Date(from).getTime() + days * 24 * 60 * 60 * 1000));
}

module.exports = { siteDay, siteDayOffset, SITE_TZ };
