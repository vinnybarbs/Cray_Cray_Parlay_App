import React from 'react'
import { useTracked } from '../lib/trackedStore'

// The little "Track bet" button on a play or a prop (owner 2026-10-16).
// One tap adds the bet to the Tracked tab, a second takes it off. It
// stops the click so a card that opens on tap does not open too.

export default function TrackButton({ item, className = '' }) {
  const { isTracked, toggle } = useTracked()
  const on = isTracked(item.key)
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={(e) => { e.stopPropagation(); toggle(item) }}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-pos ${on ? 'bg-signal-pos/15 text-signal-pos' : 'bg-ink-800 text-ink-300 hover:text-ink-100 active:bg-ink-700'} ${className}`}
    >
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z" />
      </svg>
      {on ? 'Tracked' : 'Track bet'}
    </button>
  )
}
