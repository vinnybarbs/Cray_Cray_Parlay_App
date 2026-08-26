import React, { useEffect, useState } from 'react'
import { API_BASE_URL as API_BASE } from '../config'
import { fmtGameDateTime } from '../lib/gameTime'

// The machine-built parlays, one button away on the digest (owner spec
// 2026-08-25: they lived only in the ledger and nobody could find them).
// Composition is hit-first: one or two Legs plus the safest Play-or-better
// anchor, and the running record line is where the 70 percent hit goal
// gets judged in public.

function StatusChip({ status }) {
  const map = {
    won:  { label: 'WON',  cls: 'bg-signal-pos-dim/40 text-signal-pos' },
    lost: { label: 'LOST', cls: 'bg-signal-neg-dim/40 text-signal-neg' },
    push: { label: 'PUSH', cls: 'bg-ink-850 text-ink-300' },
  }
  const m = map[status] || { label: 'OPEN', cls: 'bg-ink-850 text-ink-200' }
  return <span className={`px-2 py-0.5 rounded-sharp font-mono text-[10px] font-bold tracking-wider flex-shrink-0 ${m.cls}`}>{m.label}</span>
}

const fmtOdds = (n) => (n == null ? null : n > 0 ? `+${n}` : String(n))

export default function HouseParlays() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/house-parlays`)
        if (!res.ok) throw new Error(`Server error ${res.status}`)
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-5 px-4 py-2 text-xs font-semibold bg-ink-850 hover:bg-ink-800 text-ink-200 rounded-sharp shadow-hairline transition-colors active:scale-95"
      >
        House parlays. Machine built, hit first
      </button>
    )
  }

  const dateLabel = data
    ? new Date(`${data.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : null
  const rec = data?.record

  return (
    <div className="mt-5 w-full">
      {loading && <div className="h-20 bg-ink-850 rounded-sharp animate-pulse" />}
      {error && <p className="text-signal-neg text-sm">Couldn't load house parlays: {error}</p>}
      {data && (
        <div className="bg-ink-950/60 rounded-sharp shadow-hairline overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 bg-ink-950 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
            <span className="text-ink-200">House parlays · {dateLabel}</span>
            {!data.isToday && <span>most recent build</span>}
            {rec && rec.hitRate != null && (
              <span className="ml-auto">
                to date <span className="text-ink-200">{rec.won}-{rec.lost}</span>
                {' '}<span className={rec.hitRate >= 70 ? 'text-signal-pos' : 'text-ink-300'}>{rec.hitRate}%</span>
                {' '}· goal 70
              </span>
            )}
          </div>

          {data.parlays.length === 0 ? (
            <p className="px-4 py-4 text-sm text-ink-300">
              No parlay today. The builder only ships tickets made of heavy
              favorites, a Leg grade or -186 and heavier, and this board does
              not have enough of them. No ticket beats a coin-flip ticket.
            </p>
          ) : (
            <div className="divide-y divide-ink-850">
              {data.parlays.map((p) => (
                <div key={p.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                    <span className="font-mono text-xs font-bold text-ink-100">
                      {p.legs_count}-leg · {fmtOdds(p.combined_odds)}
                    </span>
                    {p.model_win_prob != null && (
                      <span className="font-mono text-[10px] text-ink-400">
                        model {Math.round(p.model_win_prob * 100)}% to hit
                      </span>
                    )}
                    <span className="ml-auto"><StatusChip status={p.status} /></span>
                  </div>
                  {(p.legs || []).map((leg, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 text-sm">
                      <span className="px-1.5 py-0.5 rounded-sharp font-mono text-[10px] bg-ink-850 shadow-hairline text-ink-300 flex-shrink-0">
                        {leg.tier}
                      </span>
                      <span className="text-ink-200 min-w-0">{leg.pick}</span>
                      <span className="font-mono text-[11px] text-ink-400 flex-shrink-0 ml-auto whitespace-nowrap">
                        {leg.sport}{leg.game_date ? ` · ${fmtGameDateTime(leg.game_date)}` : ''}
                      </span>
                      {/* The ticket settles a leg at a time. */}
                      <span className={`px-1.5 py-0.5 rounded-sharp font-mono text-[9px] font-bold tracking-wider flex-shrink-0 ${
                        leg.outcome === 'won' ? 'bg-signal-pos-dim/40 text-signal-pos'
                        : leg.outcome === 'lost' ? 'bg-signal-neg-dim/40 text-signal-neg'
                        : leg.outcome === 'push' || leg.outcome === 'void' ? 'bg-ink-850 text-ink-400'
                        : 'bg-ink-850 text-ink-300'
                      }`}>
                        {leg.outcome === 'won' ? 'W' : leg.outcome === 'lost' ? 'L'
                          : leg.outcome === 'push' ? 'P' : leg.outcome === 'void' ? 'V' : 'OPEN'}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          <p className="px-4 py-2.5 text-[11px] text-ink-500 bg-ink-950">
            Heavy favorites only: every component is a Leg grade or a -186 and
            heavier favorite. Parlays are a hit-rate product, not an edge
            product, and the record line above is the scoreboard.
          </p>
        </div>
      )}
    </div>
  )
}
