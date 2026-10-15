import React, { useEffect, useState } from 'react'
import { API_BASE_URL as API_BASE } from '../config'
import { fmtGameDateTime } from '../lib/gameTime'
import { apiFetch } from '../lib/api'
import { UnlockButton } from './Locked'

// The machine-built parlays, one button away on the digest (owner spec
// 2026-08-25: they lived only in the ledger and nobody could find them).
// Composition since 2026-10-15 (owner): gimme plus value, the safest
// Legs or heavy favorites plus one Play or better, only at a positive
// claimed EV and a -125 or better payout. The record line counts this
// rule alone, the heavy only slips before it keep their own record.

function StatusChip({ status }) {
  const map = {
    won:  { label: 'Won',  cls: 'bg-signal-pos-dim/40 text-signal-pos' },
    lost: { label: 'Lost', cls: 'bg-signal-neg-dim/40 text-signal-neg' },
    push: { label: 'Push', cls: 'bg-ink-850 text-ink-300' },
  }
  const m = map[status] || { label: 'Open', cls: 'bg-ink-850 text-ink-200' }
  return <span className={`px-2 py-0.5 rounded-sharp tabular-nums text-[10px] font-bold tracking-wider flex-shrink-0 ${m.cls}`}>{m.label}</span>
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
        const res = await apiFetch(`/api/house-parlays`)
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 bg-ink-950 text-xs text-ink-400">
            <span className="text-ink-200">House parlays · {dateLabel}</span>
            {rec && rec.hitRate != null && (
              <span className="ml-auto">
                since Oct 15 <span className="text-ink-200">{rec.won}-{rec.lost}</span>
                {' '}<span className={rec.hitRate >= 70 ? 'text-signal-pos' : 'text-ink-300'}>{rec.hitRate}%</span>
                {' '}· goal 70
              </span>
            )}
          </div>

          {data.parlays.length === 0 ? (
            <p className="px-4 py-4 text-sm text-ink-300">
              No open parlay today. The builder only ships a gimme plus a Play
              or better when the ticket has positive value and pays -125 or
              better, and this board does not have one. No ticket beats a
              ticket that loses money. Settled parlays live on the House Ledger.
            </p>
          ) : (
            <div className="divide-y divide-ink-850">
              {data.parlays.map((p) => (
                <div key={p.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                    <span className="tabular-nums text-xs font-bold text-ink-100">
                      {p.legs_count}-leg · {fmtOdds(p.combined_odds)}
                    </span>
                    {p.model_win_prob != null && (
                      <span className="tabular-nums text-[10px] text-ink-400">
                        model {Math.round(p.model_win_prob * 100)}% to hit
                      </span>
                    )}
                    <span className="ml-auto"><StatusChip status={p.status} /></span>
                  </div>
                  {p.locked && (
                    <div className="flex items-center justify-between gap-3 py-1">
                      <span className="text-xs text-ink-400">Legs that have not started are for Pro members.</span>
                      <UnlockButton />
                    </div>
                  )}
                  {(p.legs || []).map((leg, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 text-sm">
                      <span className="px-1.5 py-0.5 rounded-sharp tabular-nums text-[10px] bg-ink-850 shadow-hairline text-ink-300 flex-shrink-0">
                        {leg.locked ? 'Pro' : leg.tier}
                      </span>
                      <span className="text-ink-200 min-w-0">{leg.locked ? `${leg.away_team} at ${leg.home_team}` : leg.pick}</span>
                      <span className="tabular-nums text-[11px] text-ink-400 flex-shrink-0 ml-auto whitespace-nowrap">
                        {leg.sport}{leg.game_date ? ` · ${fmtGameDateTime(leg.game_date)}` : ''}
                      </span>
                      {/* The ticket settles a leg at a time. */}
                      <span className={`px-1.5 py-0.5 rounded-sharp text-xs font-semibold flex-shrink-0 ${
                        leg.outcome === 'won' ? 'bg-signal-pos-dim/40 text-signal-pos'
                        : leg.outcome === 'lost' ? 'bg-signal-neg-dim/40 text-signal-neg'
                        : leg.outcome === 'push' || leg.outcome === 'void' ? 'bg-ink-850 text-ink-400'
                        : 'bg-ink-850 text-ink-300'
                      }`}>
                        {leg.outcome === 'won' ? 'W' : leg.outcome === 'lost' ? 'L'
                          : leg.outcome === 'push' ? 'P' : leg.outcome === 'void' ? 'V' : 'Open'}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          <p className="px-4 py-2.5 text-[11px] text-ink-500 bg-ink-950">
            Gimme plus value: the safest Legs or -186 and heavier favorites
            plus one Play or better, built only at positive value and a
            -125 or better payout. Scored on its own since Oct 15, never mixed
            into the pick record.
          </p>
        </div>
      )}
    </div>
  )
}
