/**
 * Regular season floors for sports whose results feed includes games
 * that must never inform the model.
 *
 * NFL preseason is the case (2026-09-12, owner: "all records and data
 * showing in nfl is trash"): game_results held 49 August exhibition games
 * and two week-one games, so every team record, recent form, point
 * differential, schedule strength, and trend line on a week-one tile came
 * from the preseason (Texans 0-3, Bills 3-0) while the standings row said
 * 0-0. Any query that reads a football team's results applies this floor:
 * before the opener a team has no games and the market anchor carries the
 * read alone, which is the honest week-one model.
 *
 * Season year: August onward is the new season. Dates are the opening
 * Thursday; a missing year falls back to September 1.
 */

'use strict';

const NFL_OPENERS = { 2024: '2024-09-05', 2025: '2025-09-04', 2026: '2026-09-10', 2027: '2027-09-09' };

function seasonYear(at) {
  const d = at instanceof Date ? at : new Date(at || Date.now());
  return d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

/** 'YYYY-MM-DD' floor for the sport's results, or null when none applies. */
function regularSeasonFloor(sport, at = new Date()) {
  if (sport !== 'NFL') return null;
  const y = seasonYear(at);
  return NFL_OPENERS[y] || `${y}-09-01`;
}

/** Apply the floor to a supabase filter builder on game_results. */
function withSeasonFloor(query, sport, at = new Date()) {
  const floor = regularSeasonFloor(sport, at);
  return floor ? query.gte('date', floor) : query;
}

module.exports = { regularSeasonFloor, withSeasonFloor, seasonYear, NFL_OPENERS };
