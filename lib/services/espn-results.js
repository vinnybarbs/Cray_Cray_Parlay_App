/**
 * ESPN game-result resolvers.
 *
 * Two sport families need non-trivial parsers:
 *
 *   - Tennis: site.api returns matches under `event.groupings[].competitions[].competitors[]`.
 *             A "groupings" entry is a draw category (Men's Singles, Women's Doubles, etc).
 *             A "competitions" entry inside it is one match.
 *
 *   - UFC:    site.api returns the headline fight only inside an event. To get every fight
 *             on a card we drill into the core API at sports.core.api.espn.com which lists
 *             all competitions for an event (typically 12-13 fights per UFC Fight Night).
 *
 * All standard team sports use the existing `event.competitions[0].competitors[]` shape and
 * are handled by the generic resolver.
 *
 * Result shape (matches ai-suggestion-outcome-checker / parlay-outcome-checker contract):
 *   { homeScore, awayScore, status:'completed', source:'espn'|'espn_core' }
 *
 * For Tennis + UFC where there's no "score" in the team-sport sense we encode the winner
 * as 1-0 / 0-1 — the upstream moneyline grader uses sign(homeScore - awayScore).
 */

'use strict';

const { logger } = require('../../shared/logger');
const { teamsMatch } = require('../utils/team-matcher');

const SITE_SPORT_PATHS = {
  NFL: 'football/nfl',
  NCAAF: 'football/college-football',
  NBA: 'basketball/nba',
  NCAAB: 'basketball/mens-college-basketball',
  MLB: 'baseball/mlb',
  NHL: 'hockey/nhl',
  EPL: 'soccer/eng.1',
  MLS: 'soccer/usa.1',
  Soccer: 'soccer/eng.1',
};

const TENNIS_TOUR_PATHS = ['tennis/atp', 'tennis/wta'];
const UFC_PATH = 'mma/ufc';

const SITE_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE_BASE = 'http://sports.core.api.espn.com/v2/sports';

// Module-level cache so 30+ pending UFC suggestions for the same Fight Night
// don't each refetch the 13 fights × 2 athletes. Each entry maps an event ID
// to an array of fights already enriched with athlete names. 30-minute TTL
// is plenty — the cron only runs every 2 hours.
const UFC_EVENT_CACHE = new Map();
const UFC_CACHE_TTL_MS = 30 * 60 * 1000;

function isoDateBack(d) {
  return new Date(d).toISOString().split('T')[0].replace(/-/g, '');
}

/**
 * Standard team-sport resolver. Same logic as the legacy method on
 * ai-suggestion-outcome-checker, extracted so both checkers can share.
 */
async function resolveTeamSport(suggestion) {
  const sportPath = SITE_SPORT_PATHS[suggestion.sport];
  if (!sportPath) return null;

  const gameDate = new Date(suggestion.game_date);
  const dateStr = isoDateBack(gameDate);
  const dayBeforeStr = isoDateBack(gameDate.getTime() - 86400000);

  let data;
  for (const d of [dateStr, dayBeforeStr]) {
    const url = `${SITE_BASE}/${sportPath}/scoreboard?dates=${d}&groups=50&limit=200`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const result = await res.json();
    if (result.events?.length > 0) {
      data = result;
      break;
    }
  }
  if (!data) return null;

  const game = (data.events || []).find(event => {
    const home = event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home');
    const away = event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away');
    const ok = teamsMatch(home?.team?.displayName, suggestion.home_team)
            && teamsMatch(away?.team?.displayName, suggestion.away_team);
    const reversed = teamsMatch(home?.team?.displayName, suggestion.away_team)
                  && teamsMatch(away?.team?.displayName, suggestion.home_team);
    return ok || reversed;
  });
  if (!game || game.status?.type?.state !== 'post') return null;

  const homeComp = game.competitions[0].competitors.find(c => c.homeAway === 'home');
  const awayComp = game.competitions[0].competitors.find(c => c.homeAway === 'away');
  return {
    homeScore: parseInt(homeComp.score) || 0,
    awayScore: parseInt(awayComp.score) || 0,
    status: 'completed',
    source: 'espn',
  };
}

/**
 * Tennis resolver. Walks event.groupings[].competitions[].competitors[] to
 * find a match where the two athletes match suggestion.home_team / away_team.
 * Returns winner as 1-0 / 0-1 (no per-set scores yet — moneyline only).
 */
async function resolveTennis(suggestion) {
  const gameDate = new Date(suggestion.game_date);
  const dateStr = isoDateBack(gameDate);
  const dayBeforeStr = isoDateBack(gameDate.getTime() - 86400000);
  const dayAfterStr = isoDateBack(gameDate.getTime() + 86400000);

  // Try both tours and three dates (UTC edge cases around late-night matches).
  for (const tourPath of TENNIS_TOUR_PATHS) {
    for (const d of [dateStr, dayBeforeStr, dayAfterStr]) {
      const url = `${SITE_BASE}/${tourPath}/scoreboard?dates=${d}`;
      let data;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        data = await res.json();
      } catch { continue; }

      for (const event of data.events || []) {
        // Tennis events are tournaments; each has multiple groupings (draws).
        for (const grouping of event.groupings || []) {
          for (const comp of grouping.competitions || []) {
            const competitors = comp.competitors || [];
            if (competitors.length !== 2) continue;
            if (comp.status?.type?.state !== 'post') continue;

            // Athlete names live at competitor.athlete.displayName.
            const namesMatch = (a, b) => {
              const an = a?.athlete?.displayName;
              const bn = b?.athlete?.displayName;
              return teamsMatch(an, suggestion.home_team) && teamsMatch(bn, suggestion.away_team);
            };
            const direct = namesMatch(competitors[0], competitors[1]);
            const swapped = teamsMatch(competitors[0]?.athlete?.displayName, suggestion.away_team)
                         && teamsMatch(competitors[1]?.athlete?.displayName, suggestion.home_team);
            if (!direct && !swapped) continue;

            const winner = competitors.find(c => c.winner === true);
            if (!winner) continue;
            const winnerIsHome = direct
              ? (winner.id === competitors[0].id)
              : (winner.id === competitors[1].id);

            return {
              homeScore: winnerIsHome ? 1 : 0,
              awayScore: winnerIsHome ? 0 : 1,
              status: 'completed',
              source: 'espn',
            };
          }
        }
      }
    }
  }
  return null;
}

/**
 * UFC resolver. Two-step:
 *   1. site.api scoreboard for the date -> find the event ID
 *   2. core API competitions list for that event -> all fights
 *      For each fight, fetch the competitor refs to read athlete names + winner.
 *
 * Network footprint: 1 + (N fights × 2 competitors) requests for the matched event.
 * In practice we short-circuit as soon as we find the right fight.
 */
async function resolveUfc(suggestion) {
  const gameDate = new Date(suggestion.game_date);
  // UFC events span late-night local; check 3 dates around the suggestion.
  const dateCandidates = [
    isoDateBack(gameDate),
    isoDateBack(gameDate.getTime() - 86400000),
    isoDateBack(gameDate.getTime() + 86400000),
  ];

  let eventId = null;
  for (const d of dateCandidates) {
    try {
      const res = await fetch(`${SITE_BASE}/${UFC_PATH}/scoreboard?dates=${d}`);
      if (!res.ok) continue;
      const data = await res.json();
      const event = (data.events || [])[0];
      if (event?.id) { eventId = event.id; break; }
    } catch { /* try next date */ }
  }
  if (!eventId) return null;

  const fights = await getUfcFightsForEvent(eventId);
  if (!fights) return null;

  for (const fight of fights) {
    const direct = teamsMatch(fight.aName, suggestion.home_team) && teamsMatch(fight.bName, suggestion.away_team);
    const swapped = teamsMatch(fight.aName, suggestion.away_team) && teamsMatch(fight.bName, suggestion.home_team);
    if (!direct && !swapped) continue;

    if (fight.winner == null) continue;

    // fight.winner is 'a' or 'b'. Map to home/away based on direct vs swapped.
    const winnerIsHome = direct
      ? (fight.winner === 'a')
      : (fight.winner === 'b');

    return {
      homeScore: winnerIsHome ? 1 : 0,
      awayScore: winnerIsHome ? 0 : 1,
      status: 'completed',
      source: 'espn_core',
    };
  }
  return null;
}

/**
 * Fetch every fight on a UFC event with both fighter names resolved + winner.
 * Cached in-process for UFC_CACHE_TTL_MS so a sweep of 30+ pending suggestions
 * for the same Fight Night reuses one set of fetches instead of repeating them.
 */
async function getUfcFightsForEvent(eventId) {
  const cached = UFC_EVENT_CACHE.get(eventId);
  if (cached && Date.now() - cached.at < UFC_CACHE_TTL_MS) return cached.fights;

  let competitions;
  try {
    const res = await fetch(`${CORE_BASE}/mma/leagues/ufc/events/${eventId}/competitions?limit=50`);
    if (!res.ok) return null;
    const data = await res.json();
    competitions = data.items || [];
  } catch {
    return null;
  }

  const fights = [];
  for (const comp of competitions) {
    const competitors = comp.competitors || [];
    if (competitors.length !== 2) continue;

    const athletePairs = await Promise.all(competitors.map(async (c) => {
      const refUrl = c.athlete?.$ref;
      if (!refUrl) return null;
      try {
        const r = await fetch(refUrl);
        if (!r.ok) return null;
        const d = await r.json();
        return d.displayName || d.fullName || null;
      } catch { return null; }
    }));
    if (!athletePairs[0] || !athletePairs[1]) continue;

    const winner = competitors[0].winner === true ? 'a'
                 : competitors[1].winner === true ? 'b'
                 : null;

    fights.push({
      aName: athletePairs[0],
      bName: athletePairs[1],
      winner,
    });
  }

  UFC_EVENT_CACHE.set(eventId, { at: Date.now(), fights });
  return fights;
}

/**
 * Top-level resolver. Dispatches by sport.
 */
async function resolveResult(suggestion) {
  if (!suggestion?.sport) return null;
  try {
    if (suggestion.sport === 'Tennis') return await resolveTennis(suggestion);
    if (suggestion.sport === 'UFC' || suggestion.sport === 'MMA') return await resolveUfc(suggestion);
    return await resolveTeamSport(suggestion);
  } catch (err) {
    logger.warn('ESPN resolver threw', { sport: suggestion.sport, error: err.message });
    return null;
  }
}

module.exports = { resolveResult, resolveTeamSport, resolveTennis, resolveUfc };
