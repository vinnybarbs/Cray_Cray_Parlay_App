// The Live now strip (owner 2026-10-18: "just the score and real time
// game"). One chip per game, score and clock only, never our read:
// tracking a bet is the user's call, on Track bet. The Board, Props and
// Tracked pages each pick their games from the one /api/digest/live
// feed. Pure.

const MATCH_WINDOW_MS = 12 * 3600 * 1000

const norm = (s) => String(s || '').trim().toLowerCase()

/**
 * The feed game for a matchup by team names and kickoff, within 12
 * hours, as [game_key, game], or null. Props and tracked props carry
 * team names, not our game_key.
 */
export function findByMatchup(feedGames, { home_team, away_team, at }) {
  const target = at ? new Date(at).getTime() : NaN
  let best = null, bestGap = Infinity
  for (const [key, lg] of Object.entries(feedGames || {})) {
    if (norm(lg.home_team) !== norm(home_team) || norm(lg.away_team) !== norm(away_team)) continue
    const gap = Number.isFinite(target) && lg.game_date ? Math.abs(new Date(lg.game_date).getTime() - target) : 0
    if (gap <= MATCH_WINDOW_MS && gap < bestGap) { best = [key, lg]; bestGap = gap }
  }
  return best
}

/**
 * Strip items for the given game keys, one per game: games still on
 * first, finals after, each by kickoff. Unknown keys drop out.
 *   [{ key, live, sport }]
 */
export function liveNowItems(feedGames, keys) {
  const games = feedGames || {}
  const t = (lg) => (lg.game_date ? new Date(lg.game_date).getTime() : 0)
  return [...new Set(keys || [])]
    .filter(k => games[k] && games[k].home && games[k].away)
    .map(k => ({ key: k, live: games[k], sport: games[k].sport }))
    .sort((a, b) => Number(!!a.live.final) - Number(!!b.live.final) || t(a.live) - t(b.live) || a.key.localeCompare(b.key))
}
