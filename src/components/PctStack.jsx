import React from 'react'
import { bookOurPct, formatPp } from '../lib/tiers'

// Narrow edge column, owner 2026-10-12: our win chance on top, the book's
// underneath. Falls back to the gap when the price is unknown.
export default function PctStack({ edgePp, odds, otherOdds, impliedProb, className = '' }) {
  if (edgePp == null) return <span className={className}>-</span>
  const p = bookOurPct(edgePp, odds, otherOdds, impliedProb)
  if (!p) return <span className={className}>{formatPp(edgePp)}</span>
  return (
    <span className={`${className} leading-tight`} title={`Book says ${p.book}%, we say ${p.ours}%`}>
      <span className="block">{p.ours}%</span>
      <span className="block text-[11px] font-normal text-ink-500">book {p.book}%</span>
    </span>
  )
}
