// Props grouped by game (owner 2026-10-16: "consolidate these props by
// game expandable, in order, so the in progress should be at the top").
// One section per game: games in progress first, then upcoming by kickoff,
// then finished games, most recent first.

// A started game counts as in progress for this long after kickoff, the
// same window the card's "Game in progress" chip uses.
export const IN_PROGRESS_HOURS = 4

// A read is settled once it is graded, or the final box score shows the
// player never recorded a stat (no_stats, likely void).
const SETTLED = ['won', 'lost', 'push', 'void', 'no_stats']
const isSettled = (p) => SETTLED.includes(p.outcome)

export function gameKey(p) {
  return `${p.away_team}|${p.home_team}|${p.commence_time}`
}

// 'live', 'upcoming' or 'final' for one game's reads.
export function gameState(props, now = Date.now()) {
  const kick = new Date(props[0].commence_time).getTime()
  if (!(kick <= now)) return 'upcoming'
  // Skips are never graded, so only the reads decide a finished game.
  const reads = props.filter(p => !p.skip)
  if (reads.length > 0 && reads.every(isSettled)) return 'final'
  return (now - kick) / 3600e3 <= IN_PROGRESS_HOURS ? 'live' : 'final'
}

const RANK = { live: 0, upcoming: 1, final: 2 }

// Groups reads into games and orders them: live by kickoff, upcoming by
// kickoff, finished newest first. Inside a game, reads keep the order
// they came in (the server sorts by edge, biggest first). sortProps
// reorders them on the page.
export function groupByGame(props, now = Date.now()) {
  const byKey = new Map()
  for (const p of props || []) {
    const k = gameKey(p)
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(p)
  }
  const games = [...byKey.entries()].map(([key, list]) => {
    const first = list[0]
    return {
      key,
      state: gameState(list, now),
      commence_time: first.commence_time,
      away: first.awayAbbr || first.away_team,
      home: first.homeAbbr || first.home_team,
      awayAbbr: first.awayAbbr || null,
      homeAbbr: first.homeAbbr || null,
      props: list,
    }
  })
  const t = (g) => new Date(g.commence_time).getTime()
  return games.sort((a, b) =>
    RANK[a.state] - RANK[b.state] ||
    (a.state === 'final' ? t(b) - t(a) : t(a) - t(b)) ||
    a.key.localeCompare(b.key))
}

// Reads under each game sort by our own %, most likely to hit first
// (owner 2026-10-18: "it should end up being the most likely to hit
// list to lowest %"). Reads with no number go last. Pure.
export function sortProps(props) {
  const num = (p) => (p.ourProb == null || !Number.isFinite(Number(p.ourProb)) ? -Infinity : Number(p.ourProb))
  return [...(props || [])].sort((a, b) => num(b) - num(a))
}
