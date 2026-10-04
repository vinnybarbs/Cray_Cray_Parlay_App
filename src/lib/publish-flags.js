// Publication flags per sport and market, fed by /api/digest
// (publishMarkets) and read at render time. Mirror of
// lib/services/publish-markets.js. Before the digest loads, or when the
// API omits the block, the code shadow list (SHADOW_SPORTS) decides, so
// a shadow sport is never dressed in bet-tier language by accident.
import { SHADOW_SPORTS } from './tiers'

let _flags = {}

// A response that carries no block leaves the flags alone (2026-10-04:
// the Research modal's deep research fetch passed undefined, wiped the
// flags, and the code shadow list then dressed NCAAF totals as Shadow
// while the digest tile next to it showed the published pick).
export function setPublishFlags(flags) {
  if (!flags || typeof flags !== 'object') return
  _flags = flags
}

export function publishFlagsFor(sport) {
  const f = _flags[sport]
  if (f && typeof f === 'object') {
    return { ml: f.ml === 1 ? 1 : 0, spread: f.spread === 1 ? 1 : 0, total: f.total === 1 ? 1 : 0 }
  }
  const v = SHADOW_SPORTS.has(sport) ? 0 : 1
  return { ml: v, spread: v, total: v }
}

// A sport is shadow on the board when none of its markets publishes.
export function isShadowSport(sport) {
  const f = publishFlagsFor(sport)
  return f.ml === 0 && f.spread === 0 && f.total === 0
}

// A single market of a live sport can still be shadow (NCAAF moneylines
// live, NCAAF spreads withheld). market is 'ml' | 'spread' | 'total'.
export function isShadowMarket(sport, market) {
  const f = publishFlagsFor(sport)
  return f[market] === 0
}
