import React, { useEffect, useState } from 'react'
import InstallButton from '../components/InstallButton'
import { useNavigate } from 'react-router-dom'
import BrandMark, { SignOutButton } from '../components/BrandMark'
import { edgeTier, tierRange, TIERS, bookOurPct, pctPair, formatPp } from '../lib/tiers'

import { API_BASE_URL as API_BASE } from '../config'

// The House Ledger is the public, append-only settlement record. This page is
// the product's proof asset and its FTC substantiation surface at the same
// time: every pick published before the game, settled after, losers included,
// ROI and units alongside win rate. Anyone can read it, signed in or not.

import { fmtGameDateTime } from '../lib/gameTime'

function fmtDate(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDateTime(iso) {
  return fmtGameDateTime(iso) || '-'
}

function fmtOdds(odds) {
  if (odds == null) return '-'
  const n = parseInt(odds, 10)
  if (Number.isNaN(n)) return String(odds)
  return n > 0 ? `+${n}` : String(n)
}

function fmtUnits(u) {
  if (u == null) return '-'
  return `${u >= 0 ? '+' : ''}${u.toFixed(2)}u`
}

function OutcomeChip({ outcome, tier }) {
  // The feed and records only contain actionable picks (Lean and up), and traps
  // are split into their own fade report, so outcomes read straight here.
  const map = {
    won:  { label: 'Won',  cls: 'bg-signal-pos-dim/40 text-signal-pos shadow-hairline-pos' },
    lost: { label: 'Lost', cls: 'bg-signal-neg-dim/40 text-signal-neg shadow-hairline-neg' },
    push: { label: 'Push', cls: 'bg-ink-850 text-ink-300 shadow-hairline' },
    pending: { label: 'Open', cls: 'bg-ink-850 text-ink-200 shadow-hairline' },
    void: { label: 'Void', cls: 'bg-ink-850 text-ink-400 shadow-hairline' },
  }
  const m = map[outcome] || map.pending
  return <span className={`flex-shrink-0 w-14 text-center px-2 py-0.5 rounded-full text-xs font-semibold ${m.cls}`}>{m.label}</span>
}

// The digest hero's little windowed record line, on the ledger too
// (owner 2026-08-31). Same mv_public_record buckets, same populations
// side by side, so the two surfaces can never disagree.
const RECORD_PERIODS = [['last_3d', '3d'], ['last_7d', '7d'], ['last_30d', '30d'], ['all', 'all']]

function winRateColor(rate) {
  if (rate == null) return 'text-ink-300'
  if (rate >= 60) return 'text-green-400'
  if (rate >= 50) return 'text-signal-pos'
  return 'text-signal-neg'
}

function RecordWindowsLine({ windows }) {
  const [idx, setIdx] = useState(2) // default 30d, same as the digest
  if (!windows) return null
  const [bucket] = RECORD_PERIODS[idx]
  const w = windows[bucket] || {}
  const st = w.sharpTake && w.sharpTake.winRate != null ? w.sharpTake : null
  const o = w.overall && w.overall.winRate != null ? w.overall : null
  if (!st && !o) return null
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-400"
      title="Sharp Take record and the all-tiers Model record for the selected window. Same numbers as the Daily Digest."
    >
      <span>
        {'Sharp '}
        {st ? (
          <>
            <span className="tabular-nums text-ink-300">{st.won}-{st.lost}</span>
            {' '}<span className={`tabular-nums ${winRateColor(st.winRate)}`}>{st.winRate}%</span>
          </>
        ) : (
          <span className="text-ink-500">none</span>
        )}
        <span className="text-ink-600">{' · '}</span>
        {'All '}
        {o ? (
          <>
            <span className="tabular-nums text-ink-300">{o.won}-{o.lost}</span>
            {' '}<span className={`tabular-nums ${winRateColor(o.winRate)}`}>{o.winRate}%</span>
          </>
        ) : (
          <span className="text-ink-500">none</span>
        )}
      </span>
      <span className="flex items-center gap-1">
        {RECORD_PERIODS.map(([bucketKey, label], i) => (
          <button
            key={bucketKey}
            onClick={() => setIdx(i)}
            className={`px-1.5 py-0.5 rounded-full text-xs transition-colors ${
 i === idx
 ? 'bg-signal-pos-dim/60 text-signal-pos font-semibold'
 : 'bg-ink-850 text-ink-400 hover:text-ink-200'
 }`}
          >
            {label}
          </button>
        ))}
      </span>
    </div>
  )
}

function ParlayCard({ parlay }) {
  const legs = Array.isArray(parlay.legs) ? parlay.legs : []
  const odds = parlay.combined_odds > 0 ? `+${parlay.combined_odds}` : String(parlay.combined_odds)
  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline p-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs text-ink-400">
          {fmtDate(parlay.parlay_date)} · {parlay.legs_count}-leg machine build
        </span>
        <span className="ml-auto text-sm font-bold tabular-nums text-ink-100">{odds}</span>
        <OutcomeChip outcome={parlay.status} />
      </div>
      <div className="space-y-1.5">
        {legs.map((leg, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="tabular-nums text-ink-500 w-4 flex-shrink-0">{i + 1}.</span>
            <span className="min-w-0">
              <span className="text-ink-100 font-medium truncate block">{leg.pick}</span>
              {leg.away_team && leg.home_team && (
                <span className="text-ink-500 text-[11px] truncate block">{leg.away_team} at {leg.home_team}</span>
              )}
            </span>
            <span className="tabular-nums text-ink-400 flex-shrink-0">{fmtOdds(leg.odds)}</span>
            <span className="text-signal-pos/80 flex-shrink-0 tabular-nums">{pctPair(bookOurPct(Number(leg.edge_pp), leg.odds, null, leg.implied_prob)) ?? formatPp(leg.edge_pp)}</span>
            <span className="ml-auto text-ink-500 flex-shrink-0">{leg.sport}</span>
            {/* Live per-leg outcome: the ticket settles one leg at a
                time, and a pending parlay with a dead leg says so. */}
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
      <div className="mt-3 pt-2 border-t border-ink-800 text-xs text-ink-500">
        {parlay.model_win_prob != null ? (
          <>To hit: book says {Math.round(Number(parlay.fair_win_prob) * 100)}%, we say {Math.round(Number(parlay.model_win_prob) * 100)}%</>
        ) : (
          <>We rate the ticket {formatPp(parlay.combined_edge_pp)}</>
        )}
        {' '}· published {fmtDateTime(parlay.created_at)}
        {parlay.settled_at && <> · settled {fmtDateTime(parlay.settled_at)}</>}
      </div>
    </div>
  )
}

export default function HouseLedger() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAllOpen, setShowAllOpen] = useState(false)
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
  const legReport = data?.summary?.legReport
  const bySport = data?.summary?.bySport || {}
  const byBetType = data?.summary?.byBetType || {}
  // Strong Play is back in TIERS (2026-08-16 restore), so the ladder order
  // covers every label the MV emits, including the historical rows.
  const tierOrder = TIERS.map(t => t.label).filter(l => byTier[l])

  return (
    <div className="min-h-screen bg-ink-950 text-white font-sans">
      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-ink-950/95 border-b border-ink-800 backdrop-blur px-4 py-3 flex items-center gap-3">
        <BrandMark />
        <span className="text-sm font-semibold text-ink-200 hidden sm:inline">The House Ledger</span>
        <span className="hidden sm:inline text-xs text-ink-500">Append only, losers included</span>
        <button
          onClick={() => navigate('/today')}
          className="ml-auto px-3 py-1.5 text-xs font-semibold bg-ink-900 hover:bg-ink-800 text-ink-200 rounded-sharp border border-ink-700 transition-colors active:scale-95"
        >
          Today
        </button>
        <InstallButton />
        <SignOutButton />
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">

        {/* Hero */}
        <div>
          <p className="text-sm text-ink-400 mb-2">The house ledger, every pick since May 10</p>
          <h1 className="font-sans font-bold text-3xl md:text-4xl text-ink-100 tracking-[-0.02em] leading-tight">
            Every pick. Published before. Settled after.
          </h1>
          <RecordWindowsLine windows={data?.recordWindows} />
          <p className="mt-3 text-ink-300 max-w-2xl leading-relaxed text-sm">
            This is the house record, written by the settlement pipeline and never edited. It begins May 10, 2026, the day edge grading went live, and covers every actionable pick published since, across all sports. Traps are advice not to bet a side, so they're scored separately by what betting that side cost. The headline is the Sharp Take record, the tier this product exists to find. The full tier table shows where the rest of the edges live.
          </p>
          <button onClick={() => navigate('/today')} className="mt-3 text-sm font-semibold text-signal-pos hover:underline">
            See today's plays
          </button>
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
            {/* Sharp Take is the headline number. It is the product. The
                all-tier record drops to one line; the full table follows. */}
            {(byTier['Sharp Take'] || overall) && (() => {
              const sharp = byTier['Sharp Take']
              const h = sharp || overall
              return (
                <div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-ink-900 rounded-sharp shadow-hairline p-4">
                      <p className="text-xs text-signal-pos">{sharp ? 'Sharp Take record' : 'Record (all tiers)'}</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-ink-100">{h.won}-{h.lost}{h.push > 0 && <span className="text-ink-400 text-base">-{h.push}</span>}</p>
                    </div>
                    <div className="bg-ink-900 rounded-sharp shadow-hairline p-4">
                      <p className="text-xs text-ink-400">Hit rate</p>
                      <p className={`mt-1 text-2xl font-bold tabular-nums ${h.winRate >= 55 ? 'text-signal-pos' : h.winRate >= 50 ? 'text-ink-100' : 'text-signal-neg'}`}>{h.winRate != null ? `${h.winRate}%` : '-'}</p>
                    </div>
                    <div className="bg-ink-900 rounded-sharp shadow-hairline p-4">
                      <p className="text-xs text-ink-400">ROI at 1u stakes</p>
                      <p className={`mt-1 text-2xl font-bold tabular-nums ${h.roi > 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{h.roi != null ? `${h.roi >= 0 ? '+' : ''}${h.roi}%` : '-'}</p>
                    </div>
                    <div className="bg-ink-900 rounded-sharp shadow-hairline p-4">
                      <p className="text-xs text-ink-400">Units</p>
                      <p className={`mt-1 text-2xl font-bold tabular-nums ${h.units > 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{fmtUnits(h.units)}</p>
                    </div>
                  </div>
                  {sharp && overall && (
                    <p className="mt-2 text-xs text-ink-500">
                      All graded tiers: {overall.won}-{overall.lost}{overall.winRate != null ? ` (${overall.winRate}%)` : ''} · {fmtUnits(overall.units)} · full table below
                    </p>
                  )}
                </div>
              )
            })()}

            {/* Per-tier record */}
            {tierOrder.length > 0 && (
              <div className="bg-ink-900 rounded-sharp shadow-hairline overflow-hidden">
                <div className="px-4 pt-3 pb-1 text-xs text-ink-500">
                  Full record since May 10, 2026, every settled pick. The landing page shows the last 30 days only, so these totals run higher.
                </div>
                {/* Phones stack each tier with its four numbers under it, wider
                    screens get the table (owner 2026-10-12, no sideways scroll). */}
                <div className="hidden sm:grid grid-cols-[1fr_70px_70px_70px_80px] gap-3 px-4 py-2.5 text-xs text-ink-500">
                  <span>Tier and edge range</span>
                  <span className="text-right">Settled</span>
                  <span className="text-right">Hit rate</span>
                  <span className="text-right">ROI</span>
                  <span className="text-right">Units</span>
                </div>
                {tierOrder.map(label => {
                  const s = byTier[label]
                  const t = edgeTier(label === 'Sharp Take' ? 11 : label === 'Strong Play' ? 8 : label === 'Play' ? 5 : label === 'Lean' ? 3 : label === 'Skip' ? 1 : -3)
                  const cells = [
                    ['Settled', <span className="tabular-nums text-ink-300">{s.settled}</span>],
                    ['Hit rate', <span className={`font-bold tabular-nums ${s.winRate >= 55 ? 'text-signal-pos' : s.winRate >= 50 ? 'text-ink-100' : 'text-signal-neg'}`}>{s.winRate != null ? `${s.winRate}%` : '-'}</span>],
                    ['ROI', <span className={`tabular-nums ${s.roi > 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{s.roi != null ? `${s.roi >= 0 ? '+' : ''}${s.roi}%` : '-'}</span>],
                    ['Units', <span className={`tabular-nums ${s.units > 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{fmtUnits(s.units)}</span>],
                  ]
                  return (
                    <div key={label} className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_70px_70px_70px_80px] sm:gap-3 px-4 py-3 border-t border-ink-800 sm:items-center">
                      <span>
                        <span className={`text-sm font-bold ${t.color}`}>{label}</span>
                        <span className="ml-2 tabular-nums text-xs text-ink-500">{tierRange(label)}</span>
                      </span>
                      <div className="grid grid-cols-4 gap-2 sm:contents">
                        {cells.map(([name, val]) => (
                          <div key={name} className="flex flex-col sm:block sm:text-right text-sm">
                            <span className="text-xs text-ink-500 sm:hidden">{name}</span>
                            {val}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* The Trap Record: the namesake stat, graded live on its own
                ledger. A trap names an overpriced side, so that side LOSING
                means the call was right. It stays out of the actionable
                record above because its win condition is inverted; a correct
                trap must never render as a lost bet. */}
            {trapReport && trapReport.called > 0 && (
              <div className="bg-ink-900 rounded-sharp shadow-hairline px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-l-2 border-signal-neg">
                <span className="text-sm font-bold text-signal-neg">The Trap Record</span>
                <span className="text-sm tabular-nums text-ink-100">{trapReport.called} called</span>
                {/* The money line, not the win rate: bait sides are chalk,
                    so even a near-even bait record bleeds units at the
                    price. A fade percentage near 50 undersold the
                    detector (Vince, 2026-08-07). */}
                {trapReport.betRoiUnits != null && trapReport.betRoiUnits < 0 && (
                  <>
                    <span className="text-xs text-ink-500">Betting them cost</span>
                    <span className="text-sm font-bold tabular-nums text-signal-neg">
                      {trapReport.betRoiUnits}u
                    </span>
                    <span className="text-xs text-ink-500">At 1 unit stakes</span>
                  </>
                )}
                {trapReport.lastGraded && (
                  <span className="text-xs text-ink-500">
                    Last graded {fmtDate(trapReport.lastGraded)}
                  </span>
                )}
                <span className="text-sm text-ink-400 basis-full mt-1">
                  A trap names the side the crowd wants where we put its chance 2% or more below the book's. The bait went {trapReport.fadeLosses}-{trapReport.fadeWins} outright, and it still lost money, because the price is the trap. Graded on its own record, never mixed into the pick record above.
                </span>
              </div>
            )}

            {/* The Leg Pool: high hit probability, thin payout, only a
                parlay leg. Tracked so its hits feed calibration and the
                machine parlay builder, never mixed into the pick record. */}
            {legReport && legReport.tracked > 0 && (
              <div className="bg-ink-900 rounded-sharp shadow-hairline px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-l-2 border-ink-500">
                <span className="text-xs font-bold text-ink-200">The Leg Pool</span>
                <span className="text-sm tabular-nums text-ink-100">{legReport.tracked} tracked</span>
                <span className="text-xs text-ink-500">Hit</span>
                <span className={` text-sm font-bold tabular-nums ${legReport.hitRate >= 70 ? 'text-signal-pos' : 'text-ink-100'}`}>
                  {legReport.hits}-{legReport.misses}{legReport.hitRate != null ? ` (${legReport.hitRate}%)` : ''}
                </span>
                <span className="text-sm text-ink-400 basis-full mt-1">
                  a leg is a side the model grades 65% or better to win on a game with no betting edge. High chance to hit, bad payout, so it is never a pick. Tracked here because those hits calibrate the model and feed the machine parlays.
                </span>
              </div>
            )}


            {/* Hit rates by sport and by bet type. Same population as the
                headline record above. */}
            {(Object.keys(bySport).length > 0 || Object.keys(byBetType).length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[['By sport', bySport], ['By bet type', byBetType]].map(([title, groups]) => (
                  <div key={title} className="bg-ink-900 rounded-sharp shadow-hairline overflow-hidden self-start">
                    <div className="grid grid-cols-[1fr_64px_64px_72px] gap-2 px-4 py-2.5 text-xs text-ink-500">
                      <span>{title}</span>
                      <span className="text-right">Settled</span>
                      <span className="text-right">Hit rate</span>
                      <span className="text-right">Units</span>
                    </div>
                    {Object.entries(groups).map(([label, s]) => (
                      <div key={label} className="grid grid-cols-[1fr_64px_64px_72px] gap-2 px-4 py-2.5 border-t border-ink-800 items-center">
                        <span className="text-sm text-ink-100 font-medium truncate">{label === 'Total' ? 'Over/under' : label}</span>
                        <span className="text-right text-sm tabular-nums text-ink-300">{s.settled}</span>
                        <span className={`text-right text-sm font-bold tabular-nums ${s.winRate >= 55 ? 'text-signal-pos' : s.winRate >= 50 ? 'text-ink-100' : 'text-signal-neg'}`}>{s.winRate != null ? `${s.winRate}%` : '-'}</span>
                        <span className={`text-right text-sm tabular-nums ${s.units > 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{fmtUnits(s.units)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Open picks, the publish-before-start proof */}
            {data.openPicks?.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-ink-100 mb-1">Open picks, published and not yet settled</h2>
                <p className="text-sm text-ink-300 mb-4">On the record now, games not started. Timestamps are the receipt.</p>
                <div className="bg-ink-900 rounded-sharp shadow-hairline overflow-hidden">
                  {(showAllOpen ? data.openPicks : data.openPicks.slice(0, 10)).map(p => (
                    <div key={p.id} className="flex items-start gap-3 px-4 py-3 border-t border-ink-800 first:border-t-0">
                      <OutcomeChip outcome="pending" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="flex-1 min-w-0 text-sm text-ink-100 font-medium truncate">{String(p.pick || '').replace(/\s[+-]\d{3,}$/, '')}</span>
                          <span className="text-sm tabular-nums text-ink-400 flex-shrink-0">{fmtOdds(p.odds)}</span>
                        </div>
                        {p.edge_pp != null && <div className="text-sm text-signal-pos tabular-nums">{pctPair(bookOurPct(Number(p.edge_pp), p.odds, null, p.implied_prob), true) ?? formatPp(p.edge_pp)}</div>}
                        {p.away_team && p.home_team && (
                          <div className="text-xs text-ink-500 truncate">{p.away_team} at {p.home_team}{p.game_date ? ` \u00b7 ${fmtDate(p.game_date)}` : ''}</div>
                        )}
                        <div className="text-xs tabular-nums text-ink-500">Published {fmtDateTime(p.created_at)}</div>
                      </div>
                    </div>
                  ))}
                  {data.openPicks.length > 10 && (
                    <button onClick={() => setShowAllOpen(v => !v)} className="w-full px-4 py-3 border-t border-ink-800 text-sm font-semibold text-signal-pos hover:bg-ink-850">
                      {showAllOpen ? 'Show fewer' : `Show all ${data.openPicks.length} open picks`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Settled picks feed */}
            {data.picks?.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-ink-100 mb-1">Settled picks, latest {data.picks.length}</h2>
                <p className="text-sm text-ink-300 mb-4">Most recent settlements first. The full history stands behind the headline number.</p>
                <div className="bg-ink-900 rounded-sharp shadow-hairline overflow-hidden">
                  {data.picks.map(p => {
                    const t = edgeTier(p.edge_pp != null ? Number(p.edge_pp) : null)
                    return (
                      <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-ink-800 first:border-t-0 text-xs">
                        <OutcomeChip outcome={p.actual_outcome} />
                        <span className={`hidden sm:inline text-xs font-bold w-20 flex-shrink-0 ${t.color}`}>{p.tier || t.label}</span>
                        <span className="flex-1 min-w-0">
                          <span className="text-sm text-ink-100 font-medium truncate block">{String(p.pick || '').replace(/\s[+-]\d{3,}$/, '')}</span>
                          {p.away_team && p.home_team && (
                            <span className="text-ink-500 text-xs truncate block">{p.away_team} at {p.home_team}{p.game_date ? ` \u00b7 ${fmtDate(p.game_date)}` : ''}</span>
                          )}
                        </span>
                        {/* Settlement date dropped from the row (owner call
                            2026-08-22): grading follows the final within the
                            hour, so game date and settled date only differ on
                            midnight-crossing games and the second date read
                            as clutter. resolved_at still orders the feed. */}
                        <span className="ml-auto tabular-nums text-ink-400 flex-shrink-0">{fmtOdds(p.odds)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Machine-built parlays. Below the record and the feeds, and
                collapsed by default: the performance of the site is what
                this page proves, and a wall of expanded parlay cards was
                burying it. The record line stays visible as the summary. */}
            {data.parlays?.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer list-none flex flex-wrap items-center gap-x-3 gap-y-1 bg-ink-900 rounded-sharp shadow-hairline px-4 py-3 select-none">
                  <span className="text-xs text-signal-pos">Machine-built parlays</span>
                  {(() => {
                    // The server record counts every settled ticket; the
                    // cards below cap at 80, so deriving the record from
                    // them would drift once the history outgrows the cap.
                    // The fetched cards stay as the fallback shape only.
                    const rec = data.parlayRecord
                    const settled = rec ? rec.won + rec.lost
                      : data.parlays.filter(p => p.status === 'won' || p.status === 'lost').length
                    const won = rec ? rec.won
                      : data.parlays.filter(p => p.status === 'won').length
                    if (settled === 0) return (
                      <span className="tabular-nums text-xs text-ink-400">
                        {data.parlays.length} published · new rule since Oct 15, no settled ticket yet
                        {rec?.prior && rec.prior.won + rec.prior.lost > 0 && (
                          <> · earlier heavy only rule {rec.prior.won}-{rec.prior.lost}</>
                        )}
                      </span>
                    )
                    return (
                      <span className=" text-xs text-ink-300 tabular-nums">
                        Record since Oct 15: <span className="font-bold text-ink-100">{won}-{settled - won}</span> ({Math.round((won / settled) * 100)}%) · scored on its own, never mixed into the pick record
                        {rec?.prior && rec.prior.won + rec.prior.lost > 0 && (
                          <> · earlier heavy only rule {rec.prior.won}-{rec.prior.lost}</>
                        )}
                      </span>
                    )
                  })()}
                  <span className="ml-auto text-ink-400 text-xs group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <p className="text-sm text-ink-300 my-4 max-w-2xl">
                  Parlays the machine assembles as a gimme plus value since Oct 15: the safest Legs or -186 and heavier favorites plus one Play or better, built only at positive value and a -125 or better payout, cross-game, published before the first pitch and settled here win or lose. A parlay is a bet on the combination: each leg already counts as an individual pick in the record above, so a parlay that misses does not double-punish the legs that hit.
                </p>
                <div className="grid md:grid-cols-2 gap-3">
                  {data.parlays.map(p => <ParlayCard key={p.id} parlay={p} />)}
                </div>
              </details>
            )}

            {/* Methodology */}
            {data.methodology && (
              <div className="bg-ink-900 rounded-sharp shadow-hairline p-6">
                <h2 className="text-lg font-semibold text-ink-100 mb-4">How we grade</h2>
                <div className="space-y-3 text-sm text-ink-300 leading-relaxed">
                  <p><span className="text-ink-500 text-xs block">Population</span>{data.methodology.population}</p>
                  <p><span className="text-ink-500 text-xs block">Grading</span>{data.methodology.grading}</p>
                  <p><span className="text-ink-500 text-xs block">Stakes</span>{data.methodology.stakes}</p>
                  <p><span className="text-ink-500 text-xs block">Timestamps</span>{data.methodology.timestamps}</p>
                </div>
                <p className="mt-5 pt-4 border-t border-ink-800 text-xs text-ink-500">
                  Past performance does not guarantee future results. For information and entertainment only, not betting advice. 21+. 1-800-GAMBLER.
                </p>
              </div>
            )}
          </>
        )}

        {/* No dead end: proof leads back to the plays (owner 2026-10-12). */}
        <button
          onClick={() => navigate('/today')}
          className="w-full sm:w-auto px-6 py-3 bg-signal-pos hover:bg-signal-pos/90 rounded-xl font-semibold text-sm text-ink-950 transition-all active:scale-[0.98]"
        >
          See today's plays
        </button>
      </div>
    </div>
  )
}
