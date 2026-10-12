import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BrandMark, { SignOutButton } from '../components/BrandMark'
import { edgeTier } from '../lib/tiers'
import { fmtGameDateTime } from '../lib/gameTime'
import { API_BASE_URL as API_BASE } from '../config'
import PropCard from '../components/PropCard'
import InstallButton from '../components/InstallButton'
import { SkeletonList } from '../components/Skeleton'

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
  const [props, setProps] = useState(null)

  // Shadow props ride below the picks (owner 2026-10-12). A props
  // failure never blocks the page.
  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/props`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setProps(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

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
  const plays = picks.filter(p => Number(p.edge_pp) >= 4).length

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <header className="sticky top-0 z-20 bg-ink-950/95 backdrop-blur border-b border-ink-800" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <BrandMark />
          <div className="flex items-center gap-1">
            <InstallButton />
            <button onClick={() => navigate('/ledger')} className="hidden md:inline-block px-3 py-1.5 text-xs text-ink-400 hover:text-white transition-colors">Ledger</button>
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
            {!data && !error ? 'Today' : plays > 0 ? `${plays} play${plays === 1 ? '' : 's'} today` : 'A quiet day'}
          </h1>
          {data && plays === 0 && (
            <p className="text-sm text-ink-400">Nothing clears 4 points today. The best of the smaller reads is below, labeled Lean.</p>
          )}
        </section>

        {error && (
          <p className="text-sm text-ink-400">Today's board did not load. Try again in a minute, or open the full board.</p>
        )}

        {!data && !error && <SkeletonList count={3} label="Loading today's picks" />}

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

        {props?.upcoming?.length > 0 && (
          <section className="flex flex-col gap-3" aria-label="Props in shadow">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-400">Props, in shadow</h2>
              <button onClick={() => navigate('/props')} className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-300 hover:text-white">All props</button>
            </div>
            <p className="text-xs text-ink-500 -mt-1">Tracked in the open, not picks yet, not in the record.</p>
            {props.upcoming.slice(0, 3).map((p, i) => <PropCard key={`${p.text}|${i}`} p={p} />)}
          </section>
        )}

        {traps.length > 0 && (
          <section className="flex flex-col gap-3" aria-label="Traps">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-neg">Stay off these</h2>
            {traps.map(p => <TrapRow key={`${p.home_team}|${p.away_team}`} p={p} />)}
          </section>
        )}

        {/* The record closes the page as one line (owner 2026-10-12 design
            review). The full breakdown lives on the ledger. */}
        {r30 && (
          <p className="text-xs text-ink-400 text-center">
            Last 30 days <span className="font-mono tabular-nums text-ink-200">{r30.won}-{r30.lost}</span>{' '}
            <span className={`font-mono tabular-nums ${r30.units >= 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{fmtUnits(r30.units)}</span>
            {' · '}
            <button onClick={() => navigate('/ledger')} className="text-signal-pos hover:underline">See every pick</button>
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => navigate('/digest')}
            className="flex-1 px-5 py-3 bg-signal-pos hover:bg-signal-pos/90 rounded-sharp font-mono font-bold uppercase tracking-[0.12em] text-xs text-ink-950 transition-all active:scale-[0.98]"
          >
            Full board and the why
          </button>
        </div>

        <p className="text-[11px] text-ink-600 text-center">For information and entertainment. 21+. If gambling stops being fun, call 1-800-GAMBLER.</p>
      </main>
    </div>
  )
}
