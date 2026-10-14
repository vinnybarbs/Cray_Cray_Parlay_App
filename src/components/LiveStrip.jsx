import React from 'react'

// The landing ticker (rebuilt 2026-10-14, owner: "ticker is broke and crap
// looking", and it is a first visitor hook). Each item is a card sized
// chip: the side, the game, and "Book says X%, we say Y%", or a trap as
// "Don't bet" the bait. Items come from /api/public-ticker, which serves
// only published picks and traps for games not yet started.
//
// The loop is seamless: the row is rendered twice with every gap inside
// the chips, so shifting the track by exactly half lands on the copy.
// Speed scales with the number of chips so a short day does not race.
//
// items:   [{ key, kind: 'play' | 'trap', sport, label, matchup, book_pct, our_pct }]
// loading: reserve the bar's height while the first fetch is out
export default function LiveStrip({ items, loading, onSelect }) {
  if (!loading && (!items || items.length === 0)) return null
  // A short day is padded by repeating, so one copy is wider than a phone
  // and the loop never shows a gap.
  const base = []
  if (items && items.length) while (base.length < 6) base.push(...items)
  const seconds = Math.max(24, base.length * 6)

  const row = (dup) => base.map((it, i) => (
    <li key={`${dup}-${i}-${it.key}`} className="flex-shrink-0 pr-3" aria-hidden={dup || i >= items.length ? 'true' : undefined}>
      <button
        type="button"
        tabIndex={dup || i >= items.length ? -1 : 0}
        onClick={onSelect}
        className={`group flex items-center gap-3 rounded-xl px-3.5 py-2 text-left transition-colors ${it.kind === 'trap'
          ? 'bg-signal-neg/[0.07] shadow-hairline-neg hover:bg-signal-neg/[0.12]'
          : 'bg-ink-850 shadow-hairline hover:shadow-hairline-bright'}`}
      >
        <span className="flex flex-col leading-tight">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-50 whitespace-nowrap">
            {it.kind === 'trap' && <span className="rounded-md bg-signal-neg/15 px-1.5 py-px text-[11px] font-semibold text-signal-neg">Don't bet</span>}
            {it.label}
          </span>
          <span className="text-xs text-ink-400 whitespace-nowrap">{it.sport}{it.matchup ? `, ${it.matchup}` : ''}</span>
        </span>
        {it.book_pct != null && it.our_pct != null && (
          <span className="flex flex-col items-end leading-tight tabular-nums whitespace-nowrap border-l border-ink-700 pl-3">
            <span className="text-xs text-ink-400">Book says {it.book_pct}%</span>
            <span className={`text-sm font-semibold ${it.kind === 'trap' ? 'text-signal-neg' : 'text-signal-pos'}`}>we say {it.our_pct}%</span>
          </span>
        )}
      </button>
    </li>
  ))

  return (
    <section className="live-strip border-b border-ink-800 bg-ink-900/60" aria-label="Today's board at a glance">
      <div className="flex items-center">
        <div className="flex-shrink-0 flex items-center gap-2 pl-4 pr-3 py-3">
          <span className="relative flex w-2 h-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full rounded-full bg-signal-pos opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-signal-pos" />
          </span>
          <span className="text-xs font-semibold text-ink-200 leading-tight">Today's<br className="sm:hidden" /> board</span>
        </div>
        <div className="live-strip-viewport relative flex-1 min-w-0 overflow-hidden py-2.5">
          {loading && !base.length ? (
            <div className="flex gap-3" aria-hidden="true">
              {[0, 1, 2, 3].map(i => <div key={i} className="h-[46px] w-56 flex-shrink-0 rounded-xl bg-ink-850 animate-pulse" />)}
            </div>
          ) : (
            <ul className="live-strip-track flex w-max" style={{ animationDuration: `${seconds}s` }}>
              {row(false)}
              {row(true)}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
