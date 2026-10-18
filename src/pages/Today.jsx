import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BrandMark, { SignOutButton } from '../components/BrandMark'
import { TopNav } from '../components/TabBar'
import { edgeTier } from '../lib/tiers'
import { fmtGameDateTime } from '../lib/gameTime'
import { prefetchDigest } from './DailyDigest'
import PropCard from '../components/PropCard'
import LineShop from '../components/LineShop'
import InstallButton from '../components/InstallButton'
import { SkeletonList } from '../components/Skeleton'
import LockedCard from '../components/Locked'
import { apiFetch } from '../lib/api'

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

// A started pick keeps its card (owner 2026-10-13). The chip replaces
// the sport label and a locked line sits under the pick.
const STARTED_TEXT = { won: 'Final, won', lost: 'Final, lost', push: 'Final, push' }
const fmtClock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function StartedChip({ p }) {
  const done = STARTED_TEXT[p.outcome]
  const live = !done && (Date.now() - new Date(p.game_date).getTime()) / 3600e3 <= 4
  const tone = p.outcome === 'won' ? 'text-signal-pos' : p.outcome === 'lost' ? 'text-signal-neg' : 'text-ink-200'
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full bg-ink-800 flex items-center gap-1 ${tone}`}>
      {live && <span className="w-1.5 h-1.5 rounded-full bg-signal-pos animate-pulse" />}
      {done || (live ? 'Game in progress' : 'Locked')}
    </span>
  )
}

function PickRow({ p, onOpen, id, started = false }) {
  const t = edgeTier(p.edge_pp)
  return (
    <button
      id={id}
      onClick={onOpen}
      className="w-full text-left bg-ink-900 rounded-2xl border border-ink-700 px-4 py-4 flex flex-col gap-2 active:scale-[0.99] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-pos"
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full bg-ink-800 ${t.color}`}>{p.tier}</span>
        {started ? <StartedChip p={p} /> : <span className="text-xs text-ink-500">{p.sport}</span>}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-lg font-semibold text-ink-100 leading-snug min-w-0">{pickWithoutPrice(p.pick)}</span>
        <span className=" text-base tabular-nums text-ink-200 flex-shrink-0">{fmtOdds(p.odds)}</span>
      </div>
      <div className="text-xs text-ink-400">
        {started
          ? <>{p.sport} · {p.away_team} at {p.home_team} · Locked at {fmtClock(p.game_date)}, {fmtOdds(p.odds)}</>
          : <>{p.away_team} at {p.home_team} · {fmtGameDateTime(p.game_date)}</>}
      </div>
      <div className="text-sm text-ink-300">
        {p.book_pct != null
          ? <>Book says <span className="tabular-nums text-ink-100">{p.book_pct}%</span>, we say <span className={`font-semibold tabular-nums ${t.color}`}>{p.our_pct}%</span></>
          : <>We put this <span className={`font-semibold tabular-nums ${t.color}`}>{Math.round(Number(p.edge_pp))}%</span> above the book.</>}
      </div>
      {!started && <LineShop shop={p.shop} bookPct={p.book_pct} compact />}
    </button>
  )
}

function TrapRow({ p, id }) {
  return (
    <div id={id} className="bg-ink-900 rounded-2xl border border-signal-neg/40 px-4 py-4 flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-ink-100 min-w-0">Don't bet {pickWithoutPrice(p.pick)}</span>
        <span className=" text-sm tabular-nums text-ink-300 flex-shrink-0">{fmtOdds(p.odds)}</span>
      </div>
      <div className="text-xs text-ink-400">
        {p.sport} · {p.away_team} at {p.home_team} · {fmtGameDateTime(p.game_date)}
      </div>
      <div className="text-sm text-ink-300">
        {p.book_pct != null
          ? <>Book says <span className="tabular-nums text-ink-100">{p.book_pct}%</span>, we say <span className="font-semibold tabular-nums text-signal-neg">{p.our_pct}%</span></>
          : <>We put this <span className="font-semibold tabular-nums text-signal-neg">{Math.round(Math.abs(Number(p.edge_pp)))}%</span> below the book.</>}
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
    apiFetch('/api/props')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setProps(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/today')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
      // Warm the board after Today's own cards, never ahead of them.
      .finally(() => prefetchDigest())
    return () => { cancelled = true }
  }, [])

  const picks = data?.picks || []
  const traps = data?.traps || []
  const started = data?.started || []
  const startedProps = (props?.live || []).slice(0, 3)
  const r30 = data?.record?.last30
  const plays = picks.filter(p => p.locked || Number(p.edge_pp) >= 4).length
  const shownProps = (props?.upcoming || []).slice(0, 3)
  const cardId = (kind, i) => `today-${kind}-${i}`

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <header className="sticky top-0 z-20 bg-ink-950/95 backdrop-blur border-b border-ink-800" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-xl lg:max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <BrandMark />
          <div className="flex items-center gap-1">
            <TopNav className="mr-2" />
            <InstallButton />
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* No live strip here (owner 2026-10-13: "the ticker stinks"). It
          repeated the cards right below it. The landing keeps its own. */}
      <main className="max-w-xl mx-auto px-4 pt-6 pb-16 flex flex-col gap-8">
        <section className="flex flex-col gap-1">
          <p className="text-sm text-ink-400">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="text-3xl font-bold tracking-tight">
            {!data && !error ? 'Today' : plays > 0 ? `${plays} play${plays === 1 ? '' : 's'} today` : 'A quiet day'}
          </h1>
          {data && plays === 0 && (
            <p className="text-sm text-ink-400">Nothing today has us 4% or more above the book. The best of the smaller reads is below, labeled Lean.</p>
          )}
        </section>

        {error && (
          <p className="text-sm text-ink-400">Today's board did not load. Try again in a minute, or open the full board.</p>
        )}

        {!data && !error && <SkeletonList count={3} label="Loading today's picks" />}

        {picks.length > 0 && (
          <section className="flex flex-col gap-3" aria-label="Today's picks">
            {picks.map((p, i) => (p.locked
              ? <LockedCard key={`${p.home_team}|${p.away_team}|${i}`} id={cardId('pick', i)} tier={p.tier} title={`${p.away_team} at ${p.home_team}`} sub={`${p.sport} · ${p.bet_type}`} when={p.game_date} />
              : <PickRow key={`${p.home_team}|${p.away_team}|${i}`} id={cardId('pick', i)} p={p} onOpen={() => navigate('/digest')} />
            ))}
          </section>
        )}
        {data && picks.length === 0 && (
          <p className="text-sm text-ink-400">No published picks in the next 30 hours yet. The board refreshes through the day.</p>
        )}

        {props?.upcoming?.length > 0 && (
          <section className="flex flex-col gap-3" aria-label="Props in shadow">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold text-ink-100">Player props</h2>
              <button onClick={() => navigate('/props')} className="text-sm font-semibold text-signal-pos hover:underline">All props</button>
            </div>
            <p className="text-sm text-ink-400 -mt-2">In shadow. Tracked in the open, not picks yet and not in the record.</p>
            {shownProps.map((p, i) => <div key={`${p.text}|${i}`} id={cardId('prop', i)}><PropCard p={p} /></div>)}
          </section>
        )}

        {traps.length > 0 && (
          <section className="flex flex-col gap-3" aria-label="Traps">
            <h2 className="text-lg font-semibold text-signal-neg">Stay off these</h2>
            {traps.map((p, i) => <TrapRow key={`${p.home_team}|${p.away_team}|${i}`} id={cardId('trap', i)} p={p} />)}
          </section>
        )}

        {(started.length > 0 || startedProps.length > 0) && (
          <section className="flex flex-col gap-3" aria-label="Started">
            <h2 className="text-lg font-semibold text-ink-100">Started</h2>
            <p className="text-sm text-ink-400 -mt-2">Locked when the game started. Tap a pick to see the full read on the board.</p>
            {started.map((p, i) => (
              <PickRow key={`started|${p.home_team}|${p.away_team}|${i}`} p={p} started onOpen={() => navigate('/digest')} />
            ))}
            {startedProps.map((p, i) => <PropCard key={`started-prop|${p.text}|${i}`} p={p} />)}
          </section>
        )}

        {/* The record closes the page as one line (owner 2026-10-12 design
            review). The full breakdown lives on the ledger. */}
        {r30 && (
          <p className="text-xs text-ink-400 text-center">
            Last 30 days <span className=" tabular-nums text-ink-200">{r30.won}-{r30.lost}</span>{' '}
            <span className={` tabular-nums ${r30.units >= 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{fmtUnits(r30.units)}</span>
            {' · '}
            <button onClick={() => navigate('/ledger')} className="text-signal-pos hover:underline">See every pick</button>
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => navigate('/digest')}
            className="flex-1 px-5 py-3.5 bg-signal-pos hover:bg-signal-pos/90 rounded-xl font-semibold text-sm text-ink-950 transition-all active:scale-[0.98]"
          >
            Full board and the why
          </button>
        </div>

        <p className="text-[11px] text-ink-600 text-center">For information and entertainment. 21+. If gambling stops being fun, call 1-800-GAMBLER.</p>
      </main>
    </div>
  )
}
