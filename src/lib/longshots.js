// Longshots (owner 2026-10-18): the anytime TD yes reads, published with
// their % and why but never counted as Plays. They pay plus money, so
// the question is never how many hit, it is whether the ones that hit
// paid for the ones that did not. These helpers put that in words.
// All pure.

// Profit on one unit at an American price: +700 pays 7, -150 pays 0.67.
export function profitFor(price) {
  const n = Number(price)
  if (!Number.isFinite(n) || Math.abs(n) < 100) return null
  return n > 0 ? n / 100 : 100 / -n
}

// Units from one settled read at its price, one unit each. A push, a
// void or an ungraded read is zero.
export function unitsFor(p) {
  if (p.outcome === 'lost') return -1
  if (p.outcome !== 'won') return 0
  const u = profitFor(p.price)
  return u == null ? 0.909 : u
}

export function sumUnits(list) {
  const total = (list || []).reduce((s, p) => s + unitsFor(p), 0)
  return Math.round(total * 10) / 10
}

// How many of a set of longshots need to score for the set to break
// even at their own prices: n out of n times one plus the average
// profit, rounded up. Eight at +700 need one; eight at +300 need two.
export function breakEvenHits(list) {
  const profits = (list || []).map(p => profitFor(p.price)).filter(x => x != null)
  if (profits.length === 0) return 0
  const avg = profits.reduce((s, x) => s + x, 0) / profits.length
  return Math.max(1, Math.ceil(profits.length / (1 + avg)))
}

// "one in eight" for an average price, the odds a bettor hears.
export function oneIn(avgPrice) {
  const profit = profitFor(avgPrice)
  if (profit == null) return null
  return Math.max(1, Math.round(1 + profit))
}
