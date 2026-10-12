import React from 'react'
import { fmtGameDateTime } from '../lib/gameTime'

// One shadow prop read in plain words (owner 2026-10-12: show props as
// shadow so the site can be envisioned before they publish). Always
// carries the SHADOW badge, never a tier name, so it never reads as a pick.

export function fmtOdds(odds) {
  if (odds == null) return ''
  const n = parseInt(odds, 10)
  if (Number.isNaN(n)) return String(odds)
  return n > 0 ? `+${n}` : String(n)
}

export function fmtUnits(u) {
  if (u == null) return '-'
  return `${u > 0 ? '+' : ''}${Number(u).toFixed(1)}u`
}

export function ShadowBadge() {
  return (
    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-ink-400 border border-ink-700 rounded-sharp px-1.5 py-0.5">
      Shadow
    </span>
  )
}

const OUTCOME = {
  won: { label: 'HIT', cls: 'text-signal-pos' },
  lost: { label: 'MISSED', cls: 'text-signal-neg' },
  push: { label: 'PUSH', cls: 'text-ink-400' },
}

export default function PropCard({ p, showOutcome = false }) {
  const o = showOutcome ? OUTCOME[p.outcome] : null
  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline px-4 py-3 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">NFL · {p.marketLabel}</span>
        {o ? <span className={`font-mono text-[10px] font-bold tracking-[0.14em] ${o.cls}`}>{o.label}{p.actual != null ? ` · ${p.actual}` : ''}</span> : <ShadowBadge />}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-ink-100 leading-snug min-w-0">{p.text}</span>
        <span className="font-mono text-sm tabular-nums text-ink-300 flex-shrink-0">{fmtOdds(p.price)}</span>
      </div>
      <div className="text-xs text-ink-400">
        {p.away_team} at {p.home_team} · {fmtGameDateTime(p.commence_time)}
      </div>
      {!showOutcome && (
        <div className="text-sm text-ink-300">
          We make this <span className="font-semibold tabular-nums text-ink-100">{Number(p.edgePp).toFixed(1)} points</span> more likely than the price says.
        </div>
      )}
    </div>
  )
}
