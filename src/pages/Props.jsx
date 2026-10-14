import React, { useEffect, useState } from 'react'
import InstallButton from '../components/InstallButton'
import { useNavigate } from 'react-router-dom'
import BrandMark, { SignOutButton } from '../components/BrandMark'
import PropCard, { fmtUnits } from '../components/PropCard'
import { API_BASE_URL as API_BASE } from '../config'
import { SkeletonList } from '../components/Skeleton'
import { apiFetch } from '../lib/api'

// Props (shadow), owner 2026-10-12. Every NFL player prop read at 4
// points or more, the recent results and the shadow record by market.
// Props are not picks yet: they publish only when the shadow record and
// the closing line clear the bar (build_queue 65), and nothing here
// counts toward the official record.

export default function Props() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('upcoming')
  // Market filter chips (owner mockup 2026-10-12). 'all' or a market key.
  const [market, setMarket] = useState('all')

  useEffect(() => {
    let cancelled = false
    apiFetch(`/api/props`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [])

  const allUpcoming = data?.upcoming || []
  const allRecent = data?.recent || []
  const allLive = data?.live || []
  // Chips for the markets on the board right now, in board order.
  const markets = []
  for (const p of [...allUpcoming, ...allLive, ...allRecent]) {
    if (!markets.some(m => m.key === p.market)) markets.push({ key: p.market, label: p.marketLabel })
  }
  const pick = (list) => (market === 'all' ? list : list.filter(p => p.market === market))
  const upcoming = pick(allUpcoming)
  const recent = pick(allRecent)
  const live = pick(allLive)
  const rec = data?.record
  const total = rec?.total

  // Group upcoming reads by game so a slate reads like a card per game.
  const games = []
  const byGame = new Map()
  for (const p of upcoming) {
    const k = `${p.away_team}|${p.home_team}|${p.commence_time}`
    if (!byGame.has(k)) { byGame.set(k, []); games.push(k) }
    byGame.get(k).push(p)
  }

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <header className="sticky top-0 z-20 bg-ink-950/95 backdrop-blur border-b border-ink-800" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <button onClick={() => navigate('/today')} className="focus:outline-none"><BrandMark /></button>
          <div className="flex items-center gap-1">
            <button onClick={() => navigate('/today')} className="hidden md:inline-block px-3 py-1.5 text-xs text-ink-400 hover:text-white transition-colors">Today</button>
            <InstallButton />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-6 pb-16 flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-3xl font-bold tracking-tight">Props</h1>
          </div>
          <p className="text-sm text-ink-400">
            NFL player prop reads, tracked in the open before they go live. Not picks yet and not in the official record. They publish once this shadow record and the closing line both clear the bar.
          </p>
        </section>

        {markets.length > 1 && (
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" role="group" aria-label="Filter by market">
            {[{ key: 'all', label: 'All' }, ...markets].map(m => (
              <button
                key={m.key}
                onClick={() => setMarket(m.key)}
                aria-pressed={market === m.key}
                className={`px-4 py-2 rounded-full text-sm whitespace-nowrap border transition-colors first-letter:uppercase ${market === m.key ? 'bg-ink-100 text-ink-950 border-ink-100' : 'bg-ink-900 text-ink-300 border-ink-700'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-4 border-b border-ink-800" role="tablist">
          {[['upcoming', `Upcoming (${upcoming.length})`], ['recent', 'Recent results']].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-sm border-b-2 transition-colors ${tab === k ? 'border-signal-pos text-ink-100 font-semibold' : 'border-transparent text-ink-400'}`}>
              {label}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-ink-400">Props did not load. Try again in a minute.</p>}
        {!data && !error && <SkeletonList count={4} label="Loading props" />}

        {data && tab === 'upcoming' && (
          upcoming.length === 0
            ? <p className="text-sm text-ink-400">No prop reads with us 4% or more above the book for the next games yet. Reads refresh twice a day.</p>
            : games.map(k => (
              <section key={k} className="flex flex-col gap-2">
                {byGame.get(k).map((p, i) => <PropCard key={`${p.text}|${i}`} p={p} />)}
              </section>
            ))
        )}

        {/* Reads whose game already started stay up, locked, with their
            why (owner 2026-10-13). */}
        {data && tab === 'upcoming' && live.length > 0 && (
          <section className="flex flex-col gap-2" aria-label="Started">
            <h2 className="text-sm font-semibold text-ink-300 mt-2">Started</h2>
            {live.map((p, i) => <PropCard key={`live|${p.text}|${i}`} p={p} />)}
          </section>
        )}

        {data && tab === 'recent' && (
          recent.length === 0
            ? <p className="text-sm text-ink-400">No graded props from the last week yet. Grades land the day after games.</p>
            : <section className="flex flex-col gap-2">{recent.map((p, i) => <PropCard key={`${p.text}|${i}`} p={p} showOutcome />)}</section>
        )}

        {total && (total.won + total.lost) > 0 && (
          <details className="bg-ink-900 rounded-2xl border border-ink-700 px-4 py-3 flex flex-col gap-3" aria-label="Shadow record">
            <summary className="flex items-center justify-between cursor-pointer text-sm text-ink-300">
              <span>Shadow record by market, us 4% or more above the book</span>
              <span className=" tabular-nums text-ink-100">
                {total.won}-{total.lost} <span className={total.units >= 0 ? 'text-signal-pos' : 'text-signal-neg'}>{fmtUnits(total.units)}</span>
              </span>
            </summary>
            <table className="w-full text-sm mt-3">
              <tbody>
                {rec.byMarket.map(m => (
                  <tr key={m.market} className="border-t border-ink-800">
                    <td className="py-1.5 text-ink-300 capitalize">{m.label}</td>
                    <td className="py-1.5 text-right tabular-nums text-ink-200">{m.won}-{m.lost}</td>
                    <td className={`py-1.5 text-right tabular-nums w-20 ${m.units >= 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{fmtUnits(m.units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-ink-500 mt-2">Graded since Sep 14 at the consensus price, 1 unit each. Rushing and receiving yards changed method on Oct 12 and anytime TD started Oct 12.</p>
          </details>
        )}

        <p className="text-[11px] text-ink-600 text-center">For information and entertainment. 21+. If gambling stops being fun, call 1-800-GAMBLER.</p>
      </main>
    </div>
  )
}
