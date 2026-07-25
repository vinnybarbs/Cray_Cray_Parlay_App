import React, { useState, useEffect, useMemo } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { edgeTier, formatPp, edgePpForSide, pickIdFor, TIERS } from '../lib/tiers'

import { API_BASE_URL as API_BASE } from '../config'
import YesterdayBoard from '../components/YesterdayBoard'

// The Board, "give me picks for the sports I choose", rebuilt as a filtered
// view of the same graded edge-tier data the digest serves (audit 40 §3).
// One grading language (signed pp + six tiers), real odds on every row, no
// second pick generator, no fake loading theater. Picks are information, and
// the machine builds the parlays (see The House Ledger), so there is no
// lock/queue/betslip apparatus here.

const MIN_TIER_OPTIONS = [
  { key: 'all',    label: 'All picks',  min: -Infinity },
  { key: 'lean',   label: 'Lean+',      min: 2 },
  { key: 'play',   label: 'Play+',      min: 4 },
  { key: 'strong', label: 'Strong+',    min: 7 },
  { key: 'sharp',  label: 'Sharp Take', min: 10 },
]

import { fmtGameDateTime } from '../lib/gameTime'

function formatOdds(odds) {
  if (odds == null) return null
  const n = Number(odds)
  if (Number.isNaN(n)) return null
  return n > 0 ? `+${n}` : String(n)
}

// When no side cleared the 2pp pick bar, the edges dict still tells a
// story: the best available side (usually a Skip). Traps are NOT derived
// here anymore. A trap is a detector call (lure + negative edge), served
// as game.trap_calls, and it renders on its own tile in the trap section,
// never as a red footnote inside a pick tile.
function sideLabel(side, game) {
  const map = {
    home_ml: `${game.home_team} ML`,
    away_ml: `${game.away_team} ML`,
    home_spread: `${game.home_team} spread`,
    away_spread: `${game.away_team} spread`,
    over: 'Over', under: 'Under',
  }
  return map[side] || side
}

function edgeStory(game) {
  const edges = game.edges
  if (!edges) return null
  const entries = Object.entries(edges).filter(([, v]) => v != null)
  if (entries.length === 0) return null
  const toPp = (v) => Math.round(v * 1000) / 10
  const sorted = [...entries].sort((a, b) => b[1] - a[1])
  const story = { bestSide: sorted[0][0], bestPp: toPp(sorted[0][1]) }
  if (story.bestPp === 0) return null
  return story
}

function PickRow({ row, isOpen, onToggle }) {
  // pp null = no published pick. If the game still has edge data, surface
  // the story (best side's tier, trap callouts) instead of a blank preview.
  // Truly no-data games (soccer, UFC) stay honest previews.
  const story = edgeStory(row.game)
  const effPp = row.pp != null ? row.pp : story ? story.bestPp : null
  const showBestSide = row.pp == null && story
  const isPreview = effPp == null
  // A negative best side with no detected lure is not a Trap anymore, it
  // is a game to pass on. Detector-qualified traps render in the trap
  // section, never as pick rows.
  const tier = edgeTier(effPp != null && effPp <= -2 ? -1 : effPp)
  const odds = formatOdds(row.odds)
  return (
    <div>
    <button onClick={onToggle} className={`w-full text-left flex items-center gap-3 px-4 py-3 border-t border-ink-800 transition-colors ${isOpen ? 'bg-ink-850/70' : 'hover:bg-ink-850/40'}`}>
      <span className={`flex-shrink-0 w-24 text-center px-2 py-1 rounded-sharp text-[10px] font-mono font-bold uppercase tracking-wider ${isPreview ? 'text-ink-300 bg-ink-850 shadow-hairline' : `${tier.color} ${tier.bg}`}`}>
        {isPreview ? 'Preview' : tier.label}
      </span>
      <span className={`flex-shrink-0 w-16 text-right font-mono text-sm font-bold tabular-nums ${isPreview ? 'text-ink-600' : effPp >= 0 ? 'text-signal-pos' : 'text-signal-neg'}`}>
        {isPreview ? '-' : formatPp(effPp)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink-100 truncate">
          {row.game.recommended_pick
            || (showBestSide ? `best side: ${sideLabel(story.bestSide, row.game)}` : `${row.game.away_team} @ ${row.game.home_team}`)}
          {odds && <span className="ml-2 font-mono text-xs text-ink-300">{odds}</span>}
        </div>
        <div className="text-xs text-ink-400 truncate">
          {row.sport}{row.game.recommended_pick ? <> · {row.game.away_team} @ {row.game.home_team}</> : showBestSide ? <> · {row.game.away_team} @ {row.game.home_team} · below the 2pp pick bar</> : <> · analysis, no graded side</>}
          {row.game.game_date && <> · {fmtGameDateTime(row.game.game_date)}</>}
        </div>
      </div>
      <span className={`flex-shrink-0 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider ${isPreview ? 'text-ink-500' : tier.color}`}>
        {isPreview ? 'no bet graded' : tier.subtitle}
      </span>
    </button>
    {isOpen && (
      <div className="px-4 pb-3 pt-1 bg-ink-850/40 border-t border-ink-800/50">
        {row.game.analysis_snippet
          ? <p className="text-xs text-ink-200 leading-relaxed max-w-2xl">{row.game.analysis_snippet}</p>
          : <p className="text-xs text-ink-500">No written analysis yet. The next analysis pass will fill this in.</p>}
        {Array.isArray(row.game.key_factors) && row.game.key_factors.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {row.game.key_factors.slice(0, 4).map((f, i) => (
              <li key={i} className="text-[11px] text-ink-400 leading-relaxed">· {f}</li>
            ))}
          </ul>
        )}
      </div>
    )}
    </div>
  )
}

// A trap tile is its own thing, not a pick tile in red. It leads with the
// bait (why the side looks good to a casual bettor) and closes with the
// math (how overpriced it actually is). That contrast IS the product.
function TrapRow({ row }) {
  const t = row.trap
  const bait = (t.signals || []).map(s => s.label).join(' · ')
  return (
    <div className="w-full flex items-center gap-3 px-4 py-3 border-t border-ink-800">
      <span className="flex-shrink-0 w-24 text-center px-2 py-1 rounded-sharp text-[10px] font-mono font-bold uppercase tracking-wider text-signal-neg bg-signal-neg-dim/30 shadow-hairline-neg">
        Trap
      </span>
      <span className="flex-shrink-0 w-16 text-right font-mono text-sm font-bold tabular-nums text-signal-neg">
        {formatPp(t.edge_pp)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink-100 truncate">
          {sideLabel(t.side, row.game)}
        </div>
        {bait && (
          <div className="text-xs text-ink-300 truncate">
            the bait: {bait}
          </div>
        )}
        <div className="text-xs text-ink-400 truncate">
          {row.sport} · {row.game.away_team} @ {row.game.home_team}
          {row.game.game_date && <> · {fmtGameDateTime(row.game.game_date)}</>}
        </div>
      </div>
      <span className="flex-shrink-0 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-signal-neg">
        fade it
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

  const [openRow, setOpenRow] = useState(null)

  // Filters
  const [selectedSports, setSelectedSports] = useState([]) // empty = all
  // Default to everything. Traps, skips, and previews are content too.
  const [minTier, setMinTier] = useState('all')

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

  // Flatten gamesBySport into graded pick rows. Games whose published read
  // IS a trap (negative pp) belong to the trap section below, not the pick
  // list, so the same call never renders twice.
  const allRows = useMemo(() => {
    if (!data?.gamesBySport) return []
    const rows = []
    for (const [sport, games] of Object.entries(data.gamesBySport)) {
      for (const g of games) {
        const pp = edgePpForSide(g.edges, g.recommended_side)
        if (pp != null && pp <= -2) continue
        rows.push({ sport, game: g, pp })
      }
    }
    return rows.sort((a, b) => (b.pp ?? -999) - (a.pp ?? -999))
  }, [data])

  // Detector-qualified traps, one tile per call. Sorted by how seductive
  // the bait is, then by how overpriced the side is.
  const trapRows = useMemo(() => {
    if (!data?.gamesBySport) return []
    const rows = []
    for (const [sport, games] of Object.entries(data.gamesBySport)) {
      for (const g of games) {
        if (!Array.isArray(g.trap_calls)) continue
        for (const t of g.trap_calls) rows.push({ sport, game: g, trap: t })
      }
    }
    return rows.sort((a, b) => (b.trap.lure_score - a.trap.lure_score) || (a.trap.edge_pp - b.trap.edge_pp))
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

        {/* Loading. Real skeleton, no theater */}
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

        {/* Dark slate. No games on the board at all. Distinct from "your
            filter cleared everything" below: this is the calendar, not the
            filters, and it should never read as an outage. */}
        {!loading && !error && allRows.length === 0 && trapRows.length === 0 && (
          <div className="bg-ink-900 rounded-sharp shadow-hairline p-6 md:p-8">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400 mb-3">
              Slate status
            </div>
            <h2 className="text-xl font-bold text-ink-100 leading-tight">The slate is dark.</h2>
            <p className="text-sm text-ink-300 mt-2 leading-relaxed max-w-2xl">
              Every game on the board has started or settled, and the books haven't
              posted the next slate yet. Nothing is broken. There's just nothing
              to grade until new games go up.
            </p>
            {data?.firstGameTime && (
              <p className="mt-4 font-mono text-sm text-signal-pos">
                Next slate: {fmtGameDateTime(data.firstGameTime)}
              </p>
            )}
            {Object.entries(data?.upcomingCounts || {}).filter(([, n]) => n > 0).length > 0 && (
              <p className="mt-1 font-mono text-xs text-ink-400">
                On deck: {Object.entries(data.upcomingCounts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s, n]) => `${s} ${n}`).join(' · ')}
              </p>
            )}
            <YesterdayBoard />
            <p className="text-xs text-ink-500 mt-4">
              Meanwhile, every settled pick is on <button onClick={() => navigate('/ledger')} className="text-signal-pos hover:underline">The House Ledger</button>.
            </p>
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
              rows.map(row => {
                const id = pickIdFor(row.game)
                return (
                  <PickRow
                    key={id}
                    row={row}
                    isOpen={openRow === id}
                    onToggle={() => setOpenRow(openRow === id ? null : id)}
                  />
                )
              })
            )}
          </div>
        )}

        {/* The trap board. Traps are their own calls with their own tiles:
            the bait a casual bettor sees, against the price the model sees.
            Not the inverse of any pick. */}
        {!loading && !error && trapRows.length > 0 && (
          <div className="bg-ink-900 rounded-sharp shadow-hairline overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2.5 bg-ink-950 text-[10px] font-mono uppercase tracking-[0.18em] text-ink-500">
              <span className="text-signal-neg">Traps</span>
              <span>looks like a good bet · isn't</span>
              <span className="ml-auto flex-shrink-0">{trapRows.filter(r => selectedSports.length === 0 || selectedSports.includes(r.sport)).length} called</span>
            </div>
            {trapRows
              .filter(r => selectedSports.length === 0 || selectedSports.includes(r.sport))
              .map(r => (
                <TrapRow key={`${pickIdFor(r.game)}-${r.trap.side}`} row={r} />
              ))}
          </div>
        )}

        {!loading && !error && allRows.length > 0 && (
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-ink-500 text-center">
            same math as the digest · picks below 2pp are shown so you know what to skip, not to bet
          </p>
        )}
      </div>

    </div>
  )
}
