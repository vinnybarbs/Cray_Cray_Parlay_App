// Tracked bets (owner 2026-10-16): the pure pieces behind the Tracked tab.
// What a tracked item is, how it is keyed, how two copies of the list
// merge, and which section of the page it sits in. No React, no network,
// so the server tests cover it.

// Finished games stay on the page this long after kickoff.
export const KEEP_DAYS = 7
// Without a live feed, a game is treated as in progress this long after
// kickoff. The feed's final flag or the official grade ends it sooner.
const ASSUME_DONE_HOURS = 5

/** Key for a Board play: the game plus the exact pick text. */
export function gameItemKey(gameKey, pick) {
  return `game:${gameKey}:${pick}`
}

/** Key for a prop read: the same key the live props feed uses, plus kickoff. */
export function propItemKey(p) {
  return `prop:${p.playerKey || p.player}|${p.market}|${p.side}|${p.line}|${p.commence_time}`
}

/**
 * A Board play as a tracked item. `pub` is the published pick object
 * (headline or spotlight alt). `pct` is the Book says / we say pair when
 * the card has one.
 */
export function gameItem(game, gameKey, pub, pct = null) {
  return {
    kind: 'game',
    key: gameItemKey(gameKey, pub.pick),
    game_key: gameKey,
    sport: game.sport || null,
    home_team: game.home_team,
    away_team: game.away_team,
    game_date: game.game_date,
    pick: pub.pick,
    bet_type: pub.bet_type || null,
    odds: pub.odds ?? null,
    tier: pub.tier || null,
    edge_pp: pub.edge_pp ?? null,
    book_pct: pct?.book ?? null,
    our_pct: pct?.ours ?? null,
  }
}

/** A prop read as a tracked item, the fields the prop card renders from. */
export function propItem(p) {
  return {
    kind: 'prop',
    key: propItemKey(p),
    sport: 'NFL',
    player: p.player || null,
    team: p.team || null,
    playerKey: p.playerKey || null,
    market: p.market,
    marketLabel: p.marketLabel || null,
    side: p.side,
    line: p.line ?? null,
    price: p.price ?? null,
    text: p.text || null,
    commence_time: p.commence_time,
    home_team: p.home_team,
    away_team: p.away_team,
    homeAbbr: p.homeAbbr || null,
    awayAbbr: p.awayAbbr || null,
    ourProb: p.ourProb ?? null,
    bookProb: p.bookProb ?? null,
    edgePp: p.edgePp ?? null,
  }
}

/** Kickoff instant for either kind, as a number. */
export function itemTime(item) {
  const t = item?.kind === 'prop' ? item.commence_time : item?.game_date
  const ms = t ? new Date(t).getTime() : NaN
  return Number.isFinite(ms) ? ms : null
}

/**
 * Union of two copies of the list (device and account). The newer
 * tracked_at wins a tie on key, and the result is sorted newest kickoff
 * first.
 */
export function mergeTracked(a, b) {
  const byKey = new Map()
  for (const it of [...(a || []), ...(b || [])]) {
    if (!it || !it.key) continue
    const prev = byKey.get(it.key)
    if (!prev || (it.tracked_at || '') > (prev.tracked_at || '')) byKey.set(it.key, it)
  }
  return [...byKey.values()].sort((x, y) => (itemTime(y) || 0) - (itemTime(x) || 0))
}

/** Items whose game is older than KEEP_DAYS are dropped from the list. */
export function pruneTracked(items, now = Date.now()) {
  const floor = now - KEEP_DAYS * 86400e3
  return (items || []).filter(it => {
    const t = itemTime(it)
    return t == null || t >= floor
  })
}

const GRADED = new Set(['won', 'lost', 'push'])

/**
 * Which section an item sits in. `state` is what the page knows beyond
 * the item itself: { outcome, final } from the grade and the live feed.
 */
export function itemSection(item, state = {}, now = Date.now()) {
  if (GRADED.has(state.outcome) || state.final) return 'finished'
  const t = itemTime(item)
  if (t == null) return 'upcoming'
  if (t > now) return 'upcoming'
  if (now - t > ASSUME_DONE_HOURS * 3600e3) return 'finished'
  return 'live'
}

/** Split the list into the three page sections, each in display order. */
export function splitTracked(items, stateFor = () => ({}), now = Date.now()) {
  const out = { live: [], upcoming: [], finished: [] }
  for (const it of items || []) out[itemSection(it, stateFor(it), now)].push(it)
  // Soonest kickoff first for what is ahead, latest first for what is done.
  out.upcoming.sort((a, b) => (itemTime(a) || 0) - (itemTime(b) || 0))
  out.live.sort((a, b) => (itemTime(a) || 0) - (itemTime(b) || 0))
  out.finished.sort((a, b) => (itemTime(b) || 0) - (itemTime(a) || 0))
  return out
}
