import React, { useEffect, useState } from 'react'
import { edgeTier, formatPp } from '../lib/tiers'
import { API_BASE_URL as API_BASE } from '../config'

// Yesterday's board — rendered inside the dark-slate empty states on the
// Digest and The Board. When today has nothing to grade, show what the
// machine published yesterday and how every pick actually settled. Same
// receipts posture as the House Ledger, scoped to one day.

function OutcomeChip({ outcome }) {
  const map = {
    won:  { label: 'WON',  cls: 'bg-signal-pos-dim/40 text-signal-pos' },
    lost: { label: 'LOST', cls: 'bg-signal-neg-dim/40 text-signal-neg' },
    push: { label: 'PUSH', cls: 'bg-ink-850 text-ink-300' },
    void: { label: 'VOID', cls: 'bg-ink-850 text-ink-400' },
  }
  const m = map[outcome] || { label: 'OPEN', cls: 'bg-ink-850 text-ink-200' }
  return <span className={`px-2 py-0.5 rounded-sharp font-mono text-[10px] font-bold tracking-wider flex-shrink-0 ${m.cls}`}>{m.label}</span>
}

export default function YesterdayBoard({ alwaysOpen = false }) {
  const [open, setOpen] = useState(alwaysOpen)
  const [openRow, setOpenRow] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    // Depend on `open` alone. Including loading/data re-ran the effect on
    // the setLoading(true) render, whose cleanup cancelled the in-flight
    // fetch — the response was thrown away and the skeleton pulsed forever.
    if (!open) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/board-history`)
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

  if (!open && !alwaysOpen) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-5 px-4 py-2 text-xs font-semibold bg-ink-850 hover:bg-ink-800 text-ink-200 rounded-sharp shadow-hairline transition-colors active:scale-95"
      >
        Yesterday's board — every pick, settled
      </button>
    )
  }

  const s = data?.summary
  const dateLabel = data
    ? new Date(`${data.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : null

  const fmtPublished = (iso) => iso
    ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' MT'
    : null

  return (
    <div className="mt-5">
      {loading && <div className="h-20 bg-ink-850 rounded-sharp animate-pulse" />}
      {error && <p className="text-signal-neg text-sm">Couldn't load yesterday's board: {error}</p>}
      {data && (
        <div className="bg-ink-950/60 rounded-sharp shadow-hairline overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 bg-ink-950 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
            <span className="text-ink-200">{dateLabel}</span>
            {s && s.total > 0 && (
              <>
                <span>{s.won}–{s.lost}{s.push > 0 ? `–${s.push}` : ''}</span>
                {s.winRate != null && <span className={s.winRate >= 55 ? 'text-signal-pos' : s.winRate < 50 ? 'text-signal-neg' : ''}>{s.winRate}%</span>}
                <span title="Profit measured in units, staking 1 unit per pick at the published odds" className={`tabular-nums cursor-help ${s.units >= 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{s.units >= 0 ? '+' : ''}{s.units.toFixed(2)}u at 1u a pick</span>
              </>
            )}
            <span className="ml-auto text-ink-600">losers included</span>
          </div>
          {data.traps?.length > 0 && (
            <>
              <div className="px-4 py-2 bg-ink-950 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500 border-t border-ink-800">
                Traps called · the advice was to fade these sides
              </div>
              {data.traps.map((p, i) => {
                const fade = p.actual_outcome === 'lost' ? { label: 'FADE WON', cls: 'bg-signal-pos-dim/40 text-signal-pos' }
                  : p.actual_outcome === 'won' ? { label: 'FADE LOST', cls: 'bg-signal-neg-dim/40 text-signal-neg' }
                  : { label: p.actual_outcome === 'push' || p.actual_outcome === 'void' ? 'PUSH' : 'OPEN', cls: 'bg-ink-850 text-ink-300' }
                return (
                  <div key={`trap-${i}`} className="flex items-center gap-3 px-4 py-2.5 border-t border-ink-800">
                    <span className="flex-shrink-0 w-20 text-center px-1.5 py-0.5 rounded-sharp text-[10px] font-mono font-bold uppercase tracking-wider text-signal-neg bg-signal-neg-dim/30">
                      TRAP
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink-100 truncate">
                        {p.pick}
                        {p.odds && <span className="ml-2 font-mono text-xs text-ink-400">{p.odds}</span>}
                      </div>
                      <div className="text-xs text-ink-500 truncate">{p.sport} · {p.away_team} @ {p.home_team}</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-sharp font-mono text-[10px] font-bold tracking-wider flex-shrink-0 ${fade.cls}`}>{fade.label}</span>
                  </div>
                )
              })}
            </>
          )}
          {(!s || s.total === 0) ? (
            <p className="px-4 py-6 text-sm text-ink-400 text-center">Nothing was published yesterday either — the slate was dark.</p>
          ) : (
            data.picks.map((p, i) => {
              const tier = edgeTier(p.edge_pp)
              const isOpen = openRow === i
              return (
                <div key={i}>
                  <button
                    onClick={() => setOpenRow(isOpen ? null : i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 border-t border-ink-800 text-left transition-colors ${isOpen ? 'bg-ink-850/70' : 'hover:bg-ink-850/40'}`}
                  >
                    <span className={`flex-shrink-0 w-20 text-center px-1.5 py-0.5 rounded-sharp text-[10px] font-mono font-bold uppercase tracking-wider ${tier.color} ${tier.bg}`}>
                      {tier.label}
                    </span>
                    <span className={`flex-shrink-0 w-14 text-right font-mono text-xs font-bold tabular-nums ${p.edge_pp >= 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>
                      {p.edge_pp != null ? formatPp(p.edge_pp) : '—'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink-100 truncate">
                        {p.pick}
                        {p.odds && <span className="ml-2 font-mono text-xs text-ink-400">{p.odds}</span>}
                      </div>
                      <div className="text-xs text-ink-500 truncate">{p.sport} · {p.away_team} @ {p.home_team}</div>
                    </div>
                    <OutcomeChip outcome={p.actual_outcome} />
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-3 pt-1 bg-ink-850/40 border-t border-ink-800/50">
                      {p.reasoning
                        ? <p className="text-xs text-ink-200 leading-relaxed max-w-2xl">{p.reasoning}</p>
                        : <p className="text-xs text-ink-500">No written analysis was stored with this pick.</p>}
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500">
                        {tier.label}{tier.subtitle && tier.subtitle.toLowerCase() !== tier.label.toLowerCase() ? ` · ${tier.subtitle}` : ''} · published {fmtPublished(p.created_at)} — before the game started
                      </p>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
