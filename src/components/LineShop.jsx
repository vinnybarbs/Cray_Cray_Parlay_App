import React from 'react'

// Line shopping (build_queue 105, owner 2026-10-13: "pick your book" means
// line shopping). Every book we store that quotes this exact side and
// line, the best price lit, and what the whole market says. Book names
// only, never links (directive 27).

const fmtOdds = (n) => (n > 0 ? `+${n}` : String(n))

function joinNames(names) {
  if (names.length <= 1) return names[0] || ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export function shopHeadline(shop) {
  if (!shop?.books?.length) return null
  const n = shop.books.length
  if (shop.best.names.length === n) return `Same price at all ${n} books`
  return `Best price ${fmtOdds(shop.best.price)} at ${joinNames(shop.best.names)}`
}

export default function LineShop({ shop, bookPct = null, compact = false }) {
  if (!shop?.books?.length) return null
  const best = new Set(shop.best.keys)
  const n = shop.books.length
  // The whole market next to the one price the card was measured on, only
  // when the two differ enough to matter.
  const showMarket = shop.marketPct != null && (bookPct == null || Math.abs(Math.round(shop.marketPct) - bookPct) >= 1)
  return (
    <div className={`flex flex-col gap-1.5 ${compact ? '' : 'mt-1'}`} aria-label="Prices by book">
      <div className="text-xs text-ink-300 tabular-nums">
        <span className="font-semibold text-ink-100">{shopHeadline(shop)}</span>
        {showMarket && <span className="text-ink-400">. All {n} books together say {Math.round(shop.marketPct)}%</span>}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {shop.books.map(b => (
          <li
            key={b.key}
            className={`text-[11px] tabular-nums px-2 py-0.5 rounded-full whitespace-nowrap ${best.has(b.key) ? 'bg-signal-pos/15 text-signal-pos font-semibold' : 'bg-ink-800 text-ink-400'}`}
          >
            {b.name} {fmtOdds(b.price)}
          </li>
        ))}
      </ul>
    </div>
  )
}
