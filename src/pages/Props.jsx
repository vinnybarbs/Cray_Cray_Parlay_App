import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BrandMark, { SignOutButton } from '../components/BrandMark'
import PropCard, { fmtUnits } from '../components/PropCard'
import { API_BASE_URL as API_BASE } from '../config'
import { SkeletonList } from '../components/Skeleton'

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

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/props`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [])

  const upcoming = data?.upcoming || []
  const recent = data?.recent || []
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
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-6 pb-16 flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-500">NFL player props</p>
          <h1 className="text-2xl font-bold tracking-tight">Props, in shadow</h1>
          <p className="text-sm text-ink-400">
            These are the model's prop reads, tracked in the open before they go live. They are not picks yet and they do not count toward the official record. Props publish once this record and the closing line both clear the bar.
          </p>
        </section>

        {total && (total.won + total.lost) > 0 && (
          <section className="bg-ink-900 rounded-sharp shadow-hairline px-4 py-4 flex flex-col gap-3" aria-label="Shadow record">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-400">Shadow record, 4 points or more</h2>
              <span className="font-mono tabular-nums text-sm text-ink-100">
                {total.won}-{total.lost} <span className={total.units >= 0 ? 'text-signal-pos' : 'text-signal-neg'}>{fmtUnits(total.units)}</span>
              </span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {rec.byMarket.map(m => (
                  <tr key={m.market} className="border-t border-ink-800">
                    <td className="py-1.5 text-ink-300 capitalize">{m.label}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-ink-200">{m.won}-{m.lost}</td>
                    <td className={`py-1.5 text-right font-mono tabular-nums w-20 ${m.units >= 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>{fmtUnits(m.units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-ink-500">Graded since Sep 14 at the consensus price, 1 unit each. Rushing and receiving yards changed method on Oct 12 and anytime TD started Oct 12.</p>
          </section>
        )}

        <div className="flex gap-2" role="tablist">
          {[['upcoming', `Upcoming (${upcoming.length})`], ['recent', 'Recent results']].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-sharp font-mono text-[11px] uppercase tracking-[0.12em] ${tab === k ? 'bg-ink-100 text-ink-950' : 'bg-ink-900 text-ink-400 shadow-hairline'}`}>
              {label}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-ink-400">Props did not load. Try again in a minute.</p>}
        {!data && !error && <SkeletonList count={4} label="Loading props" />}

        {data && tab === 'upcoming' && (
          upcoming.length === 0
            ? <p className="text-sm text-ink-400">No prop reads at 4 points or more for the next games yet. Reads refresh twice a day.</p>
            : games.map(k => (
              <section key={k} className="flex flex-col gap-2">
                {byGame.get(k).map((p, i) => <PropCard key={`${p.text}|${i}`} p={p} />)}
              </section>
            ))
        )}

        {data && tab === 'recent' && (
          recent.length === 0
            ? <p className="text-sm text-ink-400">No graded props from the last week yet. Grades land the day after games.</p>
            : <section className="flex flex-col gap-2">{recent.map((p, i) => <PropCard key={`${p.text}|${i}`} p={p} showOutcome />)}</section>
        )}

        <p className="text-[11px] text-ink-600 text-center">For information and entertainment. 21+. If gambling stops being fun, call 1-800-GAMBLER.</p>
      </main>
    </div>
  )
}
