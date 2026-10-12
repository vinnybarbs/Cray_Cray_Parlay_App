import React from 'react'

// The live strip at the top of Today (owner 2026-10-12, design review:
// the landing ticker, calmer, in plain words, and every item taps to its
// card). Items are built by the page from what it already loaded, so the
// strip never shows a play the page does not.
//
// items: [{ key, label, price, tone: 'pos' | 'neg', targetId }]
export default function LiveStrip({ items }) {
  if (!items || items.length === 0) return null
  const go = (id) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const row = (dup) => items.map(it => (
    <button
      key={`${dup}-${it.key}`}
      type="button"
      tabIndex={dup ? -1 : 0}
      aria-hidden={dup ? 'true' : undefined}
      onClick={() => go(it.targetId)}
      className="flex-shrink-0 inline-flex items-baseline gap-1.5 px-3 text-sm text-ink-200 hover:text-white"
    >
      <span className={it.tone === 'neg' ? 'text-signal-neg' : 'text-ink-100 font-medium'}>{it.label}</span>
      {it.price && <span className="font-mono tabular-nums text-signal-pos">{it.price}</span>}
      <span className="text-ink-600 pl-1.5" aria-hidden="true">·</span>
    </button>
  ))
  return (
    <div className="live-strip relative overflow-hidden border-b border-ink-800 bg-ink-950 -mx-4" aria-label="Today's plays at a glance">
      <div className="absolute inset-y-0 left-0 z-10 flex items-center gap-1.5 pl-4 pr-2 bg-ink-950 shadow-[12px_0_12px_var(--color-ink-950)]">
        <span className="w-1.5 h-1.5 rounded-full bg-signal-pos motion-safe:animate-pulse" aria-hidden="true" />
        <span className="text-xs font-semibold text-signal-pos">Live</span>
      </div>
      <div className="live-strip-track flex w-max py-2.5 pl-20">
        {row(false)}
        {row(true)}
      </div>
    </div>
  )
}
