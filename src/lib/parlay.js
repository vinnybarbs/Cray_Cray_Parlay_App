import { bookProb, finalPpFor, SIDE_PRICES } from './tiers'

// The Pick builder's parlay math (owner 2026-10-18: "click multiple to
// calculate parlay odds/payout", nothing locked). Pure, so the server
// tests cover it. A parlay's book chance is the product of each leg's
// no-vig chance and ours is the product of each leg's model chance, the
// same Book says / we say pair every card uses. Legs are treated as
// independent, which is why one game can only give one leg.

export const MAX_LEGS = 10

/** American odds to decimal, or null. */
export function decimalOdds(american) {
  const n = parseInt(american, 10)
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) < 100) return null
  return n > 0 ? 1 + n / 100 : 1 + 100 / -n
}

/** Decimal odds back to American, rounded to the dollar. */
export function americanOdds(decimal) {
  if (!(decimal > 1)) return null
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : -Math.round(100 / (decimal - 1))
}

/**
 * A Board game as a parlay leg, or null when it cannot be one: no
 * published pick, no usable price, already started, locked, or graded.
 */
export function legFromGame(game, sport = null) {
  const pub = game?.published_pick
  if (!pub?.pick || game.locked || game.in_progress) return null
  if (pub.outcome && pub.outcome !== 'pending') return null
  const odds = parseInt(pub.odds, 10)
  if (decimalOdds(odds) == null) return null
  const keys = SIDE_PRICES[game.recommended_side]
  const book = bookProb(odds, keys ? game[keys[1]] : null)
  const pp = finalPpFor(game)
  const ours = book != null && pp != null ? Math.min(0.99, Math.max(0.01, book + pp / 100)) : null
  return {
    id: `${game.game_key || `${game.home_team}|${game.away_team}`}`,
    sport: sport || game.sport || null,
    pick: pub.pick,
    odds,
    book,
    ours,
    game,
  }
}

/**
 * The parlay a set of legs makes. Chances are null when any leg is
 * missing one, so a partial number never reads as the whole.
 */
export function parlayMath(legs, stake = 10) {
  const list = (legs || []).filter(Boolean)
  if (list.length === 0) return null
  let dec = 1
  let book = 1
  let ours = 1
  for (const l of list) {
    const d = decimalOdds(l.odds)
    if (d == null) return null
    dec *= d
    book = book == null || l.book == null ? null : book * l.book
    ours = ours == null || l.ours == null ? null : ours * l.ours
  }
  const s = Number(stake)
  const amt = Number.isFinite(s) && s > 0 ? s : 0
  return {
    legs: list.length,
    decimal: dec,
    odds: americanOdds(dec),
    payout: Math.round(amt * dec * 100) / 100,
    profit: Math.round(amt * (dec - 1) * 100) / 100,
    bookPct: book == null ? null : book * 100,
    ourPct: ours == null ? null : ours * 100,
    breakEvenPct: 100 / dec,
  }
}

/** A chance as a whole percent, or one decimal under 10 so long shots don't read 0%. */
export function fmtChance(pct) {
  if (pct == null || !Number.isFinite(pct)) return null
  if (pct < 10) return `${Math.max(0.1, Math.round(pct * 10) / 10)}%`
  return `${Math.round(pct)}%`
}
