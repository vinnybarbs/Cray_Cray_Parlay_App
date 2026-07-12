import React, { useState, useEffect, useMemo } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { edgeTier, formatPp, edgePpForSide, pickIdFor, TIERS } from '../lib/tiers'

import { API_BASE_URL as API_BASE } from '../config'

// The Board — "give me picks for the sports I choose", rebuilt as a filtered
// view of the same graded edge-tier data the digest serves (audit 40 §3).
// One grading language (signed pp + six tiers), real odds on every row, no
// second pick generator, no fake loading theater. Picks are information —
// the machine builds the parlays (see The House Ledger), so there is no
// lock/queue/betslip apparatus here.

const MIN_TIER_OPTIONS = [
  { key: 'all',    label: 'All picks',  min: -Infinity },
  { key: 'lean',   label: 'Lean+',      min: 2 },
  { key: 'play',   label: 'Play+',      min: 4 },
  { key: 'strong', label: 'Strong+',    min: 7 },
  { key: 'sharp',  label: 'Sharp Take', min: 10 },
]

function toMountainTime(isoString) {
  if (!isoString) return null
  return new Date(isoString).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatOdds(odds) {
  if (odds == null) return null
  const n = Number(odds)
  if (Number.isNaN(n)) return null
  return n > 0 ? `+${n}` : String(n)
}

function PickRow({ row }) {
  const tier = edgeTier(row.pp)
  const odds = formatOdds(row.odds)
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-t border-ink-800">
      <span className={`flex-shrink-0 w-24 text-center px-2 py-1 rounded-sharp text-[10px] font-mono font-bold uppercase tracking-wider ${tier.color} ${tier.bg}`}>
        {tier.label}
      </span>
      <span className={`flex-shrink-0 w-16 text-right font-mono text-sm font-bold tabular-nums ${row.pp >= 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>
        {formatPp(row.pp)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink-100 truncate">
          {row.game.recommended_pick || '—'}
          {odds && <span className="ml-2 font-mono text-xs text-ink-300">{odds}</span>}
        </div>
        <div className="text-xs text-ink-400 truncate">
          {row.sport} · {row.game.away_team} @ {row.game.home_team}
          {row.game.game_date && <> · {toMountainTime(row.game.game_date)} MT</>}
        </div>
      </div>
      <span className={`flex-shrink-0 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider ${tier.color}`}>
        {tier.subtitle}
      </span>
    </div>
  )
}

export default function GeneratorPage() {
  const { isAuthenticated, signOut } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters
  const [selectedSports, setSelectedSports] = useState([]) // empty = all
  const [minTier, setMinTier] = useState('lean')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`${API_BASE}/api/digest`)
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

  // Flatten gamesBySport into graded pick rows.
  const allRows = useMemo(() => {
    if (!data?.gamesBySport) return []
    const rows = []
    for (const [sport, games] of Object.entries(data.gamesBySport)) {
      for (const g of games) {
        rows.push({ sport, game: g, pp: edgePpForSide(g.edges, g.recommended_side) })
      }
    }
    return rows.sort((a, b) => (b.pp ?? -999) - (a.pp ?? -999))
  }, [data])

  const sports = useMemo(() => [...new Set(allRows.map(r => r.sport))], [allRows])

  const minPp = MIN_TIER_OPTIONS.find(o => o.key === minTier)?.min ?? -Infinity
  const rows = allRows.filter(r =>
    (selectedSports.length === 0 || selectedSports.includes(r.sport)) &&
    (minTier === 'all' || (r.pp != null && r.pp >= minPp))
  )

  const toggleSport = (s) => {
    setSelectedSports(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="min-h-screen bg-ink-950 text-white font-sans">
      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-ink-950/95 border-b border-ink-800 backdrop-blur px-4 py-3 flex items-center gap-3">
        <span className="text-sm font-semibold text-ink-200">The Board</span>
        <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500">every graded pick · filter it your way</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => navigate('/digest')} className="px-3 py-1.5 text-xs font-semibold bg-ink-900 hover:bg-ink-800 text-ink-200 rounded-sharp border border-ink-700 transition-colors active:scale-95">Digest</button>
          <button onClick={() => navigate('/chat')} className="px-3 py-1.5 text-xs font-semibold bg-ink-900 hover:bg-ink-800 text-ink-200 rounded-sharp border border-ink-700 transition-colors active:scale-95">De-Genny</button>
          <button onClick={() => navigate('/results')} className="hidden sm:block px-3 py-1.5 text-xs font-semibold bg-ink-900 hover:bg-ink-800 text-ink-200 rounded-sharp border border-ink-700 transition-colors active:scale-95">Results</button>
          <button onClick={() => navigate('/ledger')} className="hidden sm:block px-3 py-1.5 text-xs font-semibold bg-ink-900 hover:bg-ink-800 text-ink-200 rounded-sharp border border-ink-700 transition-colors active:scale-95">Ledger</button>
          <button onClick={signOut} className="px-3 py-1.5 text-xs text-ink-400 hover:text-white transition-colors">Sign out</button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">

        {/* Filters */}
        <div className="bg-ink-900 rounded-sharp shadow-hairline p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400 w-14 flex-shrink-0">Sport</span>
            <button
              onClick={() => setSelectedSports([])}
              className={`px-3 py-1 rounded-sharp text-xs font-mono font-medium transition-all ${selectedSports.length === 0 ? 'bg-signal-pos text-ink-950' : 'bg-ink-850 shadow-hairline text-ink-300 hover:bg-ink-800'}`}
            >
              All
            </button>
            {sports.map(s => (
              <button
                key={s}
                onClick={() => toggleSport(s)}
                className={`px-3 py-1 rounded-sharp text-xs font-mono font-medium transition-all ${selectedSports.includes(s) ? 'bg-signal-pos text-ink-950' : 'bg-ink-850 shadow-hairline text-ink-300 hover:bg-ink-800'}`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400 w-14 flex-shrink-0">Edge</span>
            {MIN_TIER_OPTIONS.map(o => (
              <button
                key={o.key}
                onClick={() => setMinTier(o.key)}
                className={`px-3 py-1 rounded-sharp text-xs font-mono font-medium transition-all ${minTier === o.key ? 'bg-signal-pos text-ink-950' : 'bg-ink-850 shadow-hairline text-ink-300 hover:bg-ink-800'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500">
            {TIERS.filter(t => t.min >= 2).map(t => `${t.label} ${t.range}`).join(' · ')}
          </p>
        </div>

        {/* Loading — real skeleton, no theater */}
        {loading && (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-16 bg-ink-900 rounded-sharp shadow-hairline animate-pulse" />
            ))}
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="bg-signal-neg-dim/40 border border-red-700 rounded-sharp p-6 text-center">
            <p className="text-signal-neg font-medium">Failed to load the board</p>
            <p className="text-signal-neg text-sm mt-1">{error}</p>
          </div>
        )}

        {/* Dark slate — no games on the board at all. Distinct from "your
            filter cleared everything" below: this is the calendar, not the
            filters, and it should never read as an outage. */}
        {!loading && !error && allRows.length === 0 && (
          <div className="bg-ink-900 rounded-sharp shadow-hairline p-6 md:p-8">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400 mb-3">
              $ slate_status --next
            </div>
            <h2 className="text-xl font-bold text-ink-100 leading-tight">The slate is dark.</h2>
            <p className="text-sm text-ink-300 mt-2 leading-relaxed max-w-2xl">
              Every game on the board has started or settled, and the books haven't
              posted the next slate yet. Nothing is broken — there's just nothing
              to grade until new games go up.
            </p>
            {data?.firstGameTime && (
              <p className="mt-4 font-mono text-sm text-signal-pos">
                Next slate: {new Date(data.firstGameTime).toLocaleString('en-US', { timeZone: 'America/Denver', weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} MT
              </p>
            )}
            {Object.entries(data?.upcomingCounts || {}).filter(([, n]) => n > 0).length > 0 && (
              <p className="mt-1 font-mono text-xs text-ink-400">
                On deck: {Object.entries(data.upcomingCounts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s, n]) => `${s} ${n}`).join(' · ')}
              </p>
            )}
            <button
              onClick={() => navigate('/ledger')}
              className="mt-5 px-4 py-2 text-xs font-semibold bg-ink-850 hover:bg-ink-800 text-ink-200 rounded-sharp shadow-hairline transition-colors active:scale-95"
            >
              Browse The House Ledger
            </button>
          </div>
        )}

        {/* Rows */}
        {!loading && !error && allRows.length > 0 && (
          <div className="bg-ink-900 rounded-sharp shadow-hairline overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2.5 bg-ink-950 text-[10px] font-mono uppercase tracking-[0.18em] text-ink-500">
              <span className="w-24 text-center flex-shrink-0">Tier</span>
              <span className="w-16 text-right flex-shrink-0">Edge</span>
              <span className="flex-1">Pick · matchup</span>
              <span className="flex-shrink-0">{rows.length} of {allRows.length}</span>
            </div>
            {rows.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-ink-300">Nothing clears that filter right now.</p>
                <p className="text-xs text-ink-500 mt-1 font-mono">Loosen the edge floor or check back after the next analysis run.</p>
              </div>
            ) : (
              rows.map(row => (
                <PickRow key={pickIdFor(row.game)} row={row} />
              ))
            )}
          </div>
        )}

        {!loading && !error && allRows.length > 0 && (
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-ink-500 text-center">
            // same math as the digest · picks below 2pp are shown so you know what to skip, not to bet
          </p>
        )}
      </div>

    </div>
  )
}
