import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BrandMark, { SignOutButton } from '../components/BrandMark'
import { edgeTier } from '../lib/tiers'
import { fmtGameDateTime } from '../lib/gameTime'
import { API_BASE_URL as API_BASE } from '../config'

// Today (build_queue 96, owner 2026-10-12): the one screen a first time
// visitor or a home screen install opens on. The day's best plays in
// plain words, the traps to stay off, and the record underneath. The
// full board, the factor trace and the ledger are one tap away. Public,
// no sign in, every record number from mv_public_record via /api/today.

function fmtOdds(odds) {
  if (odds == null) return ''
  const n = parseInt(odds, 10)
  if (Number.isNaN(n)) return String(odds)
  return n > 0 ? `+${n}` : String(n)
}

function fmtUnits(u) {
  if (u == null) return '-'
  return `${u > 0 ? '+' : ''}${Number(u).toFixed(1)}u`
}

// The pick text carries its price ("Bills ML -150"). Strip the trailing
// price so the card can show it on its own line.
function pickWithoutPrice(pick) {
  return String(pick || '').replace(/\s[+-]\d{3,}$/, '')
}

function PickRow({ p, onOpen }) {
  const t = edgeTier(p.edge_pp)
  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-ink-900 rounded-sharp shadow-hairline px-4 py-4 flex flex-col gap-2 active:scale-[0.99] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-pos"
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`font-mono text-[10px] font-bold uppercase tracking-[0.14em] ${t.color}`}>{p.tier}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">{p.sport}</span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-lg font-semibold text-ink-100 leading-snug min-w-0">{pickWithoutPrice(p.pick)}</span>
        <span className="font-mono text-base tabular-nums text-ink-200 flex-shrink-0">{fmtOdds(p.odds)}</span>
      </div>
      <div className="text-xs text-ink-400">
        {p.away_team} at {p.home_team} · {fmtGameDateTime(p.game_date)}
      </div>
      <div className="text-sm text-ink-300">
        We make this <span className={`font-semibold tabular-nums ${t.color}`}>{Number(p.edge_pp).toFixed(1)} points</span> more likely than the price says.
      </div>
    </button>
  )
}

function TrapRow({ p }) {
  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline border-l-2 border-signal-neg px-4 py-3 flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-ink-100 min-w-0">Don't bet {pickWithoutPrice(p.pick)}</span>
        <span className="font-mono text-sm tabular-nums text-ink-300 flex-shrink-0">{fmtOdds(p.odds)}</span>
      </div>
      <div className="text-xs text-ink-400">
        {p.sport} · {p.away_team} at {p.home_team} · {fmtGameDateTime(p.game_date)}
      </div>
      <div className="text-sm text-ink-300">
        The price is <span className="font-semibold tabular-nums text-signal-neg">{Math.abs(Number(p.edge_pp)).toFixed(1)} points</span> worse than fair.
      </div>
    </div>
  )
}

export default function Today() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/today`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [])

  const picks = data?.picks || []
  const traps = data?.traps || []
  const r30 = data?.record?.last30
  const rAll = data?.record?.allTime
  const bait = data?.record?.trapBait
  const plays = picks.filter(p => Number(p.edge_pp) >= 4).length

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <header className="sticky top-0 z-20 bg-ink-950/95 backdrop-blur border-b border-ink-800" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <BrandMark />
          <div className="flex items-center gap-1">
            <button onClick={() => navigate('/ledger')} className="px-3 py-1.5 text-xs text-ink-400 hover:text-white transition-colors">Ledger</button>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-6 pb-16 flex flex-col gap-8">
        <section className="flex flex-col gap-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-500">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="text-2xl font-bold tracking-tight">
            {!data && !error ? 'Loading today' : plays > 0 ? `${plays} play${plays === 1 ? '' : 's'} today` : 'A quiet day'}
          </h1>
          {data && plays === 0 && (
            <p className="text-sm text-ink-400">Nothing clears 4 points today. The best of the smaller reads is below, labeled Lean.</p>
          )}
        </section>

        {error && (
          <p className="text-sm text-ink-400">Today's board did not load. Try again in a minute, or open the full board.</p>
        )}

        {picks.length > 0 && (
          <section className="flex flex-col gap-3" aria-label="Today's picks">
            {picks.map(p => (
              <PickRow key={`${p.home_team}|${p.away_team}`} p={p} onOpen={() => navigate('/digest')} />
            ))}
          </section>
        )}
        {data && picks.length === 0 && (
          <p className="text-sm text-ink-400">No published picks in the next 30 hours yet. The board refreshes through the day.</p>
        )}

        {traps.length > 0 && (
          <section className="flex flex-col gap-3" aria-label="Traps">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-neg">Stay off these</h2>
            {traps.map(p => <TrapRow key={`${p.home_team}|${p.away_team}`} p={p} />)}
          </section>
        )}

        {(r30 || rAll) && (
          <section className="bg-ink-900 rounded-sharp shadow-hairline px-4 py-4 flex flex-col gap-3" aria-label="Record">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-400">The record, every pick graded</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {r30 && (
                <div className="min-w-0">
                  <dt className="text-xs text-ink-500">Last 30 days</dt>
                  <dd className="font-mono tabular-nums text-ink-100">
                    {r30.won}-{r30.lost} <span className={r30.units >= 0 ? 'text-signal-pos' : 'text-signal-neg'}>{fmtUnits(r30.units)}</span>
                  </dd>
                </div>
              )}
              {rAll && (
                <div className="min-w-0">
                  <dt className="text-xs text-ink-500">Since May 10</dt>
                  <dd className="font-mono tabular-nums text-ink-100">
                    {rAll.won}-{rAll.lost} <span className={rAll.units >= 0 ? 'text-signal-pos' : 'text-signal-neg'}>{fmtUnits(rAll.units)}</span>
                  </dd>
                </div>
              )}
              {bait && bait.units != null && (
                <div className="col-span-2 min-w-0">
                  <dt className="text-xs text-ink-500">Betting the sides we said not to bet</dt>
                  <dd className="font-mono tabular-nums text-ink-100">
                    <span className={bait.units < 0 ? 'text-signal-pos' : 'text-signal-neg'}>{fmtUnits(bait.units)}</span>
                  </dd>
                </div>
              )}
            </dl>
            <p className="text-xs text-ink-500">1 unit stakes at the published price. Losers stay on the ledger.</p>
          </section>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => navigate('/digest')}
            className="flex-1 px-5 py-3 bg-signal-pos hover:bg-signal-pos/90 rounded-sharp font-mono font-bold uppercase tracking-[0.12em] text-xs text-ink-950 transition-all active:scale-[0.98]"
          >
            Full board and the why
          </button>
          <button
            onClick={() => navigate('/ledger')}
            className="flex-1 px-5 py-3 bg-ink-900 shadow-hairline rounded-sharp font-mono font-bold uppercase tracking-[0.12em] text-xs text-ink-200 transition-all active:scale-[0.98]"
          >
            Every graded pick
          </button>
        </div>

        <p className="text-[11px] text-ink-600 text-center">For information and entertainment. 21+. If gambling stops being fun, call 1-800-GAMBLER.</p>
      </main>
    </div>
  )
}
