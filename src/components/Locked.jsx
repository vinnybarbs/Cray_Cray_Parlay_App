import React from 'react'
import { useNavigate } from 'react-router-dom'
import { edgeTier, TIERS } from '../lib/tiers'
import { fmtGameDateTime } from '../lib/gameTime'

// A Play and above for a visitor without Pro (the paywall, owner
// 2026-10-14). The server already removed the side, so this card only
// knows the game, the market and the tier.

function tierColor(label) {
  const t = TIERS.find(x => x.label === label)
  return t ? edgeTier(t.min + 0.01).color : 'text-ink-200'
}

export function LockIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

export function UnlockButton({ className = '' }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={(e) => { e.stopPropagation(); navigate('/account') }}
      className={`px-4 py-2 rounded-xl bg-signal-pos text-ink-950 text-sm font-semibold hover:bg-signal-pos/90 active:scale-[0.98] transition ${className}`}
    >
      Unlock with Pro
    </button>
  )
}

export default function LockedCard({ title, tier, sub, when, id }) {
  return (
    <div id={id} className="w-full bg-ink-900 rounded-2xl border border-ink-700 px-4 py-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        {tier && <span className={`text-xs font-semibold px-2.5 py-1 rounded-full bg-ink-800 ${tierColor(tier)}`}>{tier}</span>}
        <span className="text-xs text-ink-500 flex items-center gap-1"><LockIcon className="w-3.5 h-3.5" /> Pro</span>
      </div>
      <div className="text-lg font-semibold text-ink-100 leading-snug">{title}</div>
      <div className="text-xs text-ink-400">{sub}{when ? <> · {fmtGameDateTime(when)}</> : null}</div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-ink-300">The side, the price and the why are for Pro members.</span>
        <UnlockButton />
      </div>
    </div>
  )
}
