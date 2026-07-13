import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { edgeTier, tierRange, TIERS } from '../lib/tiers'

import { API_BASE_URL as API_BASE } from '../config'

// The House Ledger — the public, append-only settlement record. This page is
// the product's proof asset and its FTC substantiation surface at the same
// time: every pick published before the game, settled after, losers included,
// ROI and units alongside win rate. Anyone can read it, signed in or not.

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' })
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

function fmtOdds(odds) {
  if (odds == null) return '—'
  const n = parseInt(odds, 10)
  if (Number.isNaN(n)) return String(odds)
  return n > 0 ? `+${n}` : String(n)
}

function fmtUnits(u) {
  if (u == null) return '—'
  return `${u >= 0 ? '+' : ''}${u.toFixed(2)}u`
}

function OutcomeChip({ outcome, tier }) {
  // The feed and records only contain actionable picks (Lean and up) — traps
  // are split into their own fade report — so outcomes read straight here.
  const map = {
    won:  { label: 'WON',  cls: 'bg-signal-pos-dim/40 text-signal-pos shadow-hairline-pos' },
    lost: { label: 'LOST', cls: 'bg-signal-neg-dim/40 text-signal-neg shadow-hairline-neg' },
    push: { label: 'PUSH', cls: 'bg-ink-850 text-ink-300 shadow-hairline' },
    pending: { label: 'OPEN', cls: 'bg-ink-850 text-ink-200 shadow-hairline' },
    void: { label: 'VOID', cls: 'bg-ink-850 text-ink-400 shadow-hairline' },
  }
  const m = map[outcome] || map.pending
  return <span className={`px-2 py-0.5 rounded-sharp font-mono text-[10px] font-bold tracking-wider ${m.cls}`}>{m.label}</span>
}

function ParlayCard({ parlay }) {
  const legs = Array.isArray(parlay.legs) ? parlay.legs : []
  const odds = parlay.combined_odds > 0 ? `+${parlay.combined_odds}` : String(parlay.combined_odds)
  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline p-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
          {fmtDate(parlay.parlay_date)} · {parlay.legs_count}-leg machine build
        </span>
        <span className="ml-auto font-mono text-sm font-bold tabular-nums text-ink-100">{odds}</span>
        <OutcomeChip outcome={parlay.status} />
      </div>
      <div className="space-y-1.5">
        {legs.map((leg, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="font-mono text-ink-500 w-4 flex-shrink-0">{i + 1}.</span>
            <span className="text-ink-100 font-medium truncate">{leg.pick}</span>
            <span className="font-mono text-ink-400 flex-shrink-0">{fmtOdds(leg.odds)}</span>
            <span className="font-mono text-signal-pos/80 flex-shrink-0 tabular-nums">+{Number(leg.edge_pp).toFixed(1)}pp</span>
            <span className="ml-auto text-ink-500 flex-shrink-0">{leg.sport}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-2 border-t border-ink-800 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500">
        {parlay.model_win_prob != null ? (
          <>model {(Number(parlay.model_win_prob) * 100).toFixed(1)}% to hit · fair {(Number(parlay.fair_win_prob) * 100).toFixed(1)}% · edge +{Number(parlay.combined_edge_pp).toFixed(1)}pp</>
        ) : (
          <>combined edge +{Number(parlay.combined_edge_pp).toFixed(1)}pp</>
        )}
        {' '}· published {fmtDateTime(parlay.created_at)} MT
        {parlay.settled_at && <> · settled {fmtDateTime(parlay.settled_at)} MT</>}
      </div>
    </div>
  )
}

export default function HouseLedger() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public-ledger`)
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
  }, [])

  const overall = data?.summary?.overall
  const byTier = data?.summary?.byTier || {}
  const trapReport = data?.summary?.trapReport
  const tierOrder = TIERS.map(t => t.label).filter(l => byTier[l])

  return (
    <div className="min-h-screen bg-ink-950 text-white font-sans">
      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-ink-950/95 border-b border-ink-800 backdrop-blur px-4 py-3 flex items-center gap-3">
        <span className="text-sm font-semibold text-ink-200">The House Ledger</span>
        <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500">append-only · losers included</span>
        <button
          onClick={() => navigate('/')}
          className="ml-auto px-3 py-1.5 text-xs font-semibold bg-ink-900 hover:bg-ink-800 text-ink-200 rounded-sharp border border-ink-700 transition-colors active:scale-95"
        >
          Home
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">

        {/* Hero */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.20em] text-signal-pos mb-3">The house ledger · all-time · straight from settlement</p>
          <h1 className="font-sans font-bold text-3xl md:text-4xl text-ink-100 tracking-[-0.02em] leading-tight">
            Every pick. Published before. Settled after.
          </h1>
          <p className="mt-3 text-ink-300 max-w-2xl leading-relaxed text-sm">
            This is the house record, written by the settlement pipeline and never edited. The headline number covers every actionable pick we published, across all sports. Traps are advice to bet against a side, so they're scored separately as fades. The tier table shows where the edges actually live.
          </p>
        </div>

        {loading && (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-24 bg-ink-900 rounded-sharp shadow-hairline animate-pulse" />)}</div>
        )}
        {!loading && error && (
          <div className="bg-signal-neg-dim/40 border border-red-700 rounded-sharp p-6 text-center">
            <p className="text-signal-neg font-medium">Failed to load the ledger</p>
            <p className="text-signal-neg text-sm mt-1">{error}</p>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Overall record */}
            {overall && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-ink-900 rounded-sharp shadow-hairline p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">Record (all tiers)</p>
                  <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-ink-100">{overall.won}–{overall.lost}{overall.push > 0 && <span className="text-ink-400 text-base">–{overall.push}</span>}</p>
                </div>
                <div className="bg-ink-900 rounded-sharp shadow-hairline p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">Hit rate</p>
                  <p className={`mt-1 text-2xl font-bold font-mono tabular-nums ${overall.winRate >= 55 ? 'text-signal-pos' : overall.winRate >= 50 ? 'text-ink-100' : 'text-signal-neg'}`}>{overall.winRate != null ? `${overall.winRate}%` : '—'}</p>
                </div>
                <div className="bg-ink-900 rounded-sharp shadow-hairline p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">ROI at 1u stakes</p>
                  <p className={`mt-1 text-2xl font-bold font-mono tabular-nums ${overall.roi > 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{overall.roi != null ? `${overall.roi >= 0 ? '+' : ''}${overall.roi}%` : '—'}</p>
                </div>
                <div className="bg-ink-900 rounded-sharp shadow-hairline p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">Units</p>
                  <p className={`mt-1 text-2xl font-bold font-mono tabular-nums ${overall.units > 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{fmtUnits(overall.units)}</p>
                </div>
              </div>
            )}

            {/* Per-tier record */}
            {tierOrder.length > 0 && (
              <div className="bg-ink-900 rounded-sharp shadow-hairline overflow-x-auto">
                <div className="grid grid-cols-[1fr_70px_70px_70px_80px] gap-3 px-4 py-2.5 bg-ink-950 text-[10px] font-mono uppercase tracking-[0.18em] text-ink-500 min-w-[480px]">
                  <span>Tier · edge range</span>
                  <span className="text-right">Settled</span>
                  <span className="text-right">Hit rate</span>
                  <span className="text-right">ROI</span>
                  <span className="text-right">Units</span>
                </div>
                {tierOrder.map(label => {
                  const s = byTier[label]
                  const t = edgeTier(label === 'Sharp Take' ? 11 : label === 'Strong Play' ? 8 : label === 'Play' ? 5 : label === 'Lean' ? 3 : label === 'Skip' ? 1 : -1)
                  return (
                    <div key={label} className="grid grid-cols-[1fr_70px_70px_70px_80px] gap-3 px-4 py-3 border-t border-ink-800 items-center min-w-[480px]">
                      <span>
                        <span className={`font-mono text-xs font-bold uppercase tracking-wider ${t.color}`}>{label}</span>
                        <span className="ml-2 font-mono text-[10px] text-ink-500">{tierRange(label)}</span>
                      </span>
                      <span className="text-right font-mono text-sm tabular-nums text-ink-300">{s.settled}</span>
                      <span className={`text-right font-mono text-sm font-bold tabular-nums ${s.winRate >= 55 ? 'text-signal-pos' : s.winRate >= 50 ? 'text-ink-100' : 'text-signal-neg'}`}>{s.winRate != null ? `${s.winRate}%` : '—'}</span>
                      <span className={`text-right font-mono text-sm tabular-nums ${s.roi > 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{s.roi != null ? `${s.roi >= 0 ? '+' : ''}${s.roi}%` : '—'}</span>
                      <span className={`text-right font-mono text-sm tabular-nums ${s.units > 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{fmtUnits(s.units)}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Traps are fade advice, not bets — the record above only counts
                actionable picks. A trap side losing means the call was right. */}
            {trapReport && trapReport.called > 0 && (
              <div className="bg-ink-900 rounded-sharp shadow-hairline px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-signal-neg">Traps called</span>
                <span className="font-mono text-sm tabular-nums text-ink-100">{trapReport.called}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500">fading them went</span>
                <span className={`font-mono text-sm font-bold tabular-nums ${trapReport.fadeRate >= 55 ? 'text-signal-pos' : 'text-ink-100'}`}>
                  {trapReport.fadeWins}–{trapReport.fadeLosses}{trapReport.fadeRate != null ? ` (${trapReport.fadeRate}%)` : ''}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-600 basis-full sm:basis-auto sm:ml-auto">a trap is advice to bet against a side — its loss is our win</span>
              </div>
            )}


            {/* Machine-built parlays */}
            {data.parlays?.length > 0 && (
              <div>
                <h2 className="font-mono text-[10px] uppercase tracking-[0.20em] text-signal-pos mb-1">Machine-built parlays</h2>
                <p className="text-sm text-ink-300 mb-4 max-w-2xl">
                  Parlays the machine assembles from its own highest-edge legs, cross-game only, published before the first pitch and settled here win or lose.
                </p>
                <div className="grid md:grid-cols-2 gap-3">
                  {data.parlays.map(p => <ParlayCard key={p.id} parlay={p} />)}
                </div>
              </div>
            )}

            {/* Open picks — publish-before-start proof */}
            {data.openPicks?.length > 0 && (
              <div>
                <h2 className="font-mono text-[10px] uppercase tracking-[0.20em] text-signal-pos mb-1">Open picks · published, not yet settled</h2>
                <p className="text-sm text-ink-300 mb-4">On the record now, games not started. Timestamps are the receipt.</p>
                <div className="bg-ink-900 rounded-sharp shadow-hairline overflow-hidden">
                  {data.openPicks.map(p => (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-ink-800 first:border-t-0 text-xs">
                      <OutcomeChip outcome="pending" />
                      <span className="text-ink-100 font-medium truncate">{p.pick}</span>
                      <span className="font-mono text-ink-400 flex-shrink-0">{fmtOdds(p.odds)}</span>
                      {p.edge_pp != null && <span className="font-mono text-signal-pos/80 tabular-nums flex-shrink-0">+{Number(p.edge_pp).toFixed(1)}pp</span>}
                      <span className="ml-auto font-mono text-[10px] text-ink-500 flex-shrink-0">published {fmtDateTime(p.created_at)} MT</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Settled picks feed */}
            {data.picks?.length > 0 && (
              <div>
                <h2 className="font-mono text-[10px] uppercase tracking-[0.20em] text-signal-pos mb-1">Settled picks · latest {data.picks.length}</h2>
                <p className="text-sm text-ink-300 mb-4">Most recent settlements first. The full history stands behind the headline number.</p>
                <div className="bg-ink-900 rounded-sharp shadow-hairline overflow-hidden">
                  {data.picks.map(p => {
                    const t = edgeTier(p.edge_pp != null ? Number(p.edge_pp) : null)
                    return (
                      <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-ink-800 first:border-t-0 text-xs">
                        <OutcomeChip outcome={p.actual_outcome} />
                        <span className={`hidden sm:inline font-mono text-[10px] font-bold uppercase tracking-wider w-20 flex-shrink-0 ${t.color}`}>{p.tier || t.label}</span>
                        <span className="text-ink-100 font-medium truncate">{p.pick}</span>
                        <span className="font-mono text-ink-400 flex-shrink-0">{fmtOdds(p.odds)}</span>
                        <span className="ml-auto font-mono text-[10px] text-ink-500 flex-shrink-0">{fmtDate(p.resolved_at)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Methodology */}
            {data.methodology && (
              <div className="bg-ink-900 rounded-sharp shadow-hairline p-6">
                <h2 className="font-mono text-[10px] uppercase tracking-[0.20em] text-ink-400 mb-4">§ methodology</h2>
                <div className="space-y-3 text-sm text-ink-300 leading-relaxed">
                  <p><span className="text-ink-500 font-mono text-[10px] uppercase tracking-[0.14em] block">population</span>{data.methodology.population}</p>
                  <p><span className="text-ink-500 font-mono text-[10px] uppercase tracking-[0.14em] block">grading</span>{data.methodology.grading}</p>
                  <p><span className="text-ink-500 font-mono text-[10px] uppercase tracking-[0.14em] block">stakes</span>{data.methodology.stakes}</p>
                  <p><span className="text-ink-500 font-mono text-[10px] uppercase tracking-[0.14em] block">timestamps</span>{data.methodology.timestamps}</p>
                </div>
                <p className="mt-5 pt-4 border-t border-ink-800 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-500">
                  // past performance does not guarantee future results · informational and entertainment purposes only · not betting advice · 21+ · 1-800-GAMBLER
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
