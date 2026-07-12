import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { edgeTier, formatPp, edgePpForSide } from '../lib/tiers'

import { API_BASE_URL as API_BASE } from '../config'
import YesterdayBoard from '../components/YesterdayBoard'

const SPORT_META = {
  NBA:   { emoji: '🏀', label: 'NBA' },
  NFL:   { emoji: '🏈', label: 'NFL' },
  MLB:   { emoji: '⚾', label: 'MLB' },
  NHL:   { emoji: '🏒', label: 'NHL' },
  EPL:   { emoji: '⚽', label: 'EPL' },
  MLS:   { emoji: '⚽', label: 'MLS' },
  NCAAB: { emoji: '🏀', label: 'NCAAB' },
  NCAAF: { emoji: '🏈', label: 'NCAAF' },
}

function getSportMeta(sport) {
  return SPORT_META[sport] || { emoji: '🎯', label: sport }
}

// Map game_analysis sport values to display sport codes for injury lookup
const ANALYSIS_SPORT_TO_CODE = {
  NBA: 'NBA',
  NFL: 'NFL',
  MLB: 'MLB',
  NHL: 'NHL',
  NCAAB: 'NCAAB',
  NCAAF: 'NCAAF',
  EPL: 'EPL',
  MLS: 'MLS',
  basketball_nba: 'NBA',
  americanfootball_nfl: 'NFL',
  baseball_mlb: 'MLB',
  icehockey_nhl: 'NHL',
  basketball_ncaab: 'NCAAB',
  americanfootball_ncaaf: 'NCAAF',
  soccer_epl: 'EPL',
  soccer_usa_mls: 'MLS',
}

function toMountainTime(isoString) {
  if (!isoString) return null
  return new Date(isoString).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatFullDate(isoString) {
  const d = isoString ? new Date(isoString) : new Date()
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function edgeBadgeClass(score) {
  if (score == null) return 'bg-ink-800 text-ink-300'
  if (score >= 8) return 'bg-emerald-900 text-emerald-300 border border-emerald-700'
  if (score >= 6) return 'bg-signal-pos-dim text-signal-pos border border-signal-pos'
  return 'bg-ink-800 text-ink-300 border border-ink-600'
}

// edgeTier / formatPp / edgePpForSide now live in src/lib/tiers.js — one
// grading language shared by digest, generator, landing, and ledger.

// Build a readable pick label for one side using market context already on the game row.
function sidePickText(game, side) {
  switch (side) {
    case 'home_ml':     return game.moneyline_home != null ? `${game.home_team} ML ${game.moneyline_home > 0 ? '+' : ''}${game.moneyline_home}` : `${game.home_team} ML`
    case 'away_ml':     return game.moneyline_away != null ? `${game.away_team} ML ${game.moneyline_away > 0 ? '+' : ''}${game.moneyline_away}` : `${game.away_team} ML`
    case 'home_spread': return game.spread != null ? `${game.home_team} ${game.spread > 0 ? '+' : ''}${game.spread}` : `${game.home_team} spread`
    case 'away_spread': return game.spread != null ? `${game.away_team} ${(-game.spread) > 0 ? '+' : ''}${-game.spread}` : `${game.away_team} spread`
    case 'over':        return game.total != null ? `Over ${game.total}` : 'Over'
    case 'under':       return game.total != null ? `Under ${game.total}` : 'Under'
    default:            return side
  }
}

function winRateColor(rate) {
  if (rate == null) return 'text-ink-300'
  if (rate >= 60) return 'text-green-400'
  if (rate >= 50) return 'text-signal-pos'
  return 'text-signal-neg'
}

function winRateBarColor(rate) {
  if (rate == null) return 'bg-ink-700'
  if (rate >= 60) return 'bg-green-500'
  if (rate >= 50) return 'bg-signal-pos'
  return 'bg-red-500'
}

function edgeMovementIcon(movement) {
  if (!movement) return null
  const m = String(movement).toLowerCase()
  if (m === 'up' || m === 'rising') return <span className="text-green-400 font-bold">↑</span>
  if (m === 'down' || m === 'falling') return <span className="text-signal-neg font-bold">↓</span>
  return <span className="text-ink-300">→</span>
}

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-ink-800 rounded ${className}`} />
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="bg-ink-900 rounded-sharp p-6 border border-ink-700">
        <Skeleton className="h-10 w-64 mb-3" />
        <Skeleton className="h-5 w-40 mb-2" />
        <Skeleton className="h-4 w-32" />
      </div>
      {[1, 2].map(i => (
        <div key={i} className="bg-ink-900 rounded-sharp p-6 border border-ink-700 space-y-4">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map(j => (
              <div key={j} className="bg-ink-950 rounded-sharp p-4 space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Countdown({ targetIso }) {
  const [remaining, setRemaining] = useState(null)

  useEffect(() => {
    if (!targetIso) return
    const tick = () => {
      const diff = new Date(targetIso).getTime() - Date.now()
      if (diff <= 0) {
        setRemaining('Game time!')
        return
      }
      const totalSecs = Math.floor(diff / 1000)
      const h = Math.floor(totalSecs / 3600)
      const m = Math.floor((totalSecs % 3600) / 60)
      const s = totalSecs % 60
      setRemaining(
        `${h > 0 ? `${h}h ` : ''}${m}m ${String(s).padStart(2, '0')}s`
      )
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetIso])

  if (!targetIso || !remaining) return null

  return (
    <div className="flex items-center gap-2 text-sm text-ink-300 mt-1">
      <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
      <span>First game in <span className="font-mono text-green-400 font-semibold">{remaining}</span></span>
    </div>
  )
}

// ─── Deep Research Modal ────────────────────────────────────────────────────

function DeepResearchModal({ gameKey, game, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const overlayRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`${API_BASE}/api/deep-research?game_key=${encodeURIComponent(gameKey)}`)
        if (!res.ok) throw new Error(`Server error ${res.status}`)
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [gameKey])

  // Close on overlay click
  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) onClose()
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Prevent body scroll while modal open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const analysis = data?.analysis || game
  const version = analysis.analysis_version
  const keyFactors = Array.isArray(analysis.key_factors)
    ? analysis.key_factors
    : analysis.key_factors
      ? String(analysis.key_factors).split(/[·\n]/).map(s => s.trim()).filter(Boolean)
      : []

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4"
    >
      <div className="relative w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[88vh] bg-ink-950 sm:rounded-sharp border border-ink-700 shadow-2xl flex flex-col overflow-hidden">

        {/* Modal header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-ink-700 bg-ink-900 flex-shrink-0">
          <div>
            <div className="text-xs text-ink-400 uppercase tracking-wider mb-0.5">Deep Research</div>
            <h2 className="text-base font-bold text-white leading-tight">
              {game.away_team} <span className="text-ink-400">@</span> {game.home_team}
            </h2>
            {game.game_date && (
              <div className="text-xs text-ink-400 mt-0.5">{toMountainTime(game.game_date)} MT</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 text-ink-400 hover:text-white text-xl leading-none p-1 -mr-1 mt-0.5 transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Modal body — scrollable */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">

          {loading && (
            <div className="space-y-3">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          )}

          {!loading && error && (
            <div className="bg-signal-neg-dim/40 border border-red-700 rounded-sharp p-4 text-center">
              <p className="text-signal-neg text-sm font-medium">Failed to load deep research data</p>
              <p className="text-signal-neg text-xs mt-1">{error}</p>
              <p className="text-xs text-ink-400 mt-2">Showing available card data below.</p>
            </div>
          )}

          {/* Edge score + movement */}
          <div className="bg-ink-900 rounded-sharp p-4 border border-ink-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-ink-400 uppercase tracking-wider font-semibold">Edge Analysis</span>
              {version && (
                <span className="text-xs bg-ink-800 text-ink-200 rounded-full px-2 py-0.5">
                  Pass #{version}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {/* Use the same signed-pp + tier display as the tile, not the
                  legacy 0-10 edge_score. Showing both on one screen confused
                  users: "is it 12.3pp or 10/10?" The pp number is the truth;
                  edge_score is a saturated derivative of the same data. */}
              <EdgeChip signedPp={edgePpForSide(analysis.edges, analysis.recommended_side)} />
              {analysis.edge_movement && (
                <span className="text-sm flex items-center gap-1 text-ink-300">
                  Movement: {edgeMovementIcon(analysis.edge_movement)}
                  <span className="capitalize">{analysis.edge_movement}</span>
                </span>
              )}
            </div>
          </div>

          {/* Analysis snippet + key factors */}
          {(analysis.analysis_snippet || keyFactors.length > 0) && (
            <div className="bg-ink-900 rounded-sharp p-4 border border-ink-700 space-y-3">
              <div className="text-xs text-ink-400 uppercase tracking-wider font-semibold">Analysis</div>
              {analysis.analysis_snippet && (
                <p className="text-sm text-ink-200 leading-relaxed">{analysis.analysis_snippet}</p>
              )}
              {keyFactors.length > 0 && (
                <div>
                  <div className="text-xs text-ink-400 mb-1.5 font-medium">Key Factors</div>
                  <ul className="space-y-1">
                    {keyFactors.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-ink-300">
                        <span className="text-signal-pos flex-shrink-0 mt-0.5">•</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* What changed (refinement history) */}
          {analysis.what_changed && (
            <div className="bg-ink-900 rounded-sharp p-4 border border-ink-700">
              <div className="text-xs text-ink-400 uppercase tracking-wider font-semibold mb-2">What Changed</div>
              <p className="text-xs text-ink-300 leading-relaxed italic">{analysis.what_changed}</p>
            </div>
          )}

          {/* Current lines */}
          {(() => {
            const odds = data?.odds || []
            const hasOdds = odds.length > 0
            const hasCardLines = analysis.spread != null || analysis.total != null || analysis.moneyline_home != null
            if (!hasOdds && !hasCardLines) return null
            return (
              <div className="bg-ink-900 rounded-sharp p-4 border border-ink-700">
                <div className="text-xs text-ink-400 uppercase tracking-wider font-semibold mb-3">Current Lines</div>
                {hasOdds ? (
                  <div className="space-y-2">
                    {odds.map((line, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-ink-400 capitalize">{line.market_type || 'Line'}</span>
                        <div className="flex gap-3 text-ink-200">
                          {line.spread != null && <span>Spread: {line.spread > 0 ? '+' : ''}{line.spread}</span>}
                          {line.total != null && <span>O/U: {line.total}</span>}
                          {line.moneyline_home != null && (
                            <span>ML: {line.moneyline_home > 0 ? '+' : ''}{line.moneyline_home} / {line.moneyline_away > 0 ? '+' : ''}{line.moneyline_away}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {analysis.spread != null && (
                      <span className="text-xs bg-ink-800 rounded px-2 py-1 text-ink-200">
                        Spread: {analysis.spread > 0 ? '+' : ''}{analysis.spread}
                      </span>
                    )}
                    {analysis.total != null && (
                      <span className="text-xs bg-ink-800 rounded px-2 py-1 text-ink-200">
                        O/U: {analysis.total}
                      </span>
                    )}
                    {analysis.moneyline_home != null && (
                      <span className="text-xs bg-ink-800 rounded px-2 py-1 text-ink-200">
                        ML: {analysis.moneyline_home > 0 ? '+' : ''}{analysis.moneyline_home} / {analysis.moneyline_away > 0 ? '+' : ''}{analysis.moneyline_away}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Injury report */}
          {data?.injuries && data.injuries.length > 0 && (
            <div className="bg-ink-900 rounded-sharp p-4 border border-ink-700">
              <div className="text-xs text-orange-400 uppercase tracking-wider font-semibold mb-3">Injury Report</div>
              <div className="space-y-3">
                {data.injuries.map((entry, i) => {
                  const lines = typeof entry.content === 'string'
                    ? entry.content.split('\n').filter(l => l.trim())
                    : []
                  return (
                    <div key={i}>
                      <div className="text-xs text-ink-400 font-medium mb-1">{entry.team_name}</div>
                      <ul className="space-y-0.5">
                        {lines.slice(0, 6).map((line, j) => (
                          <li key={j} className="flex items-start gap-2 text-xs text-ink-300">
                            <span className="text-orange-500 flex-shrink-0 mt-0.5">•</span>
                            {line}
                          </li>
                        ))}
                        {lines.length === 0 && (
                          <li className="text-xs text-ink-500 italic">No injury data.</li>
                        )}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Recent articles */}
          {data?.articles && data.articles.length > 0 && (
            <div className="bg-ink-900 rounded-sharp p-4 border border-ink-700">
              <div className="text-xs text-ink-400 uppercase tracking-wider font-semibold mb-3">Recent News</div>
              <div className="space-y-3">
                {data.articles.map((article, i) => (
                  <div key={i} className="border-b border-ink-700 last:border-0 pb-3 last:pb-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-xs text-ink-200 font-medium leading-snug">{article.title}</p>
                      {article.sentiment && (
                        <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${
                          article.sentiment === 'positive' ? 'bg-green-900/60 text-green-400' :
                          article.sentiment === 'negative' ? 'bg-signal-neg-dim/60 text-signal-neg' :
                          'bg-ink-800 text-ink-300'
                        }`}>
                          {article.sentiment}
                        </span>
                      )}
                    </div>
                    {article.betting_summary && (
                      <p className="text-xs text-ink-400 leading-relaxed">{article.betting_summary}</p>
                    )}
                    {article.published_at && (
                      <p className="text-xs text-ink-700 mt-1">
                        {new Date(article.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent form — last 5 games each team */}
          {(() => {
            const homeResults = data?.homeTeamResults || []
            const awayResults = data?.awayTeamResults || []
            if (homeResults.length === 0 && awayResults.length === 0) return null

            const renderResult = (r, teamName) => {
              const isHome = r.home_team_name === teamName
              const teamScore = isHome ? r.home_score : r.away_score
              const oppScore = isHome ? r.away_score : r.home_score
              const opponent = isHome ? r.away_team_name : r.home_team_name
              const won = teamScore != null && oppScore != null ? teamScore > oppScore : null
              return (
                <div key={`${r.date}-${r.home_team_name}`} className="flex items-center gap-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded font-bold flex-shrink-0 ${
                    won === true ? 'bg-green-900 text-green-300' :
                    won === false ? 'bg-signal-neg-dim text-signal-neg' :
                    'bg-ink-800 text-ink-300'
                  }`}>
                    {won === true ? 'W' : won === false ? 'L' : '?'}
                  </span>
                  <span className="text-ink-300 truncate">
                    {isHome ? 'vs' : '@'} {opponent}
                    {teamScore != null && ` ${teamScore}-${oppScore}`}
                  </span>
                  {r.date && (
                    <span className="text-ink-700 flex-shrink-0 ml-auto">
                      {new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              )
            }

            return (
              <div className="bg-ink-900 rounded-sharp p-4 border border-ink-700">
                <div className="text-xs text-ink-400 uppercase tracking-wider font-semibold mb-3">Recent Form</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {homeResults.length > 0 && (
                    <div>
                      <div className="text-xs text-ink-300 font-medium mb-2">{game.home_team}</div>
                      <div className="space-y-1.5">
                        {homeResults.map(r => renderResult(r, game.home_team))}
                      </div>
                    </div>
                  )}
                  {awayResults.length > 0 && (
                    <div>
                      <div className="text-xs text-ink-300 font-medium mb-2">{game.away_team}</div>
                      <div className="space-y-1.5">
                        {awayResults.map(r => renderResult(r, game.away_team))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
        </div>

      </div>
    </div>
  )
}

// ─── EdgeChip ────────────────────────────────────────────────────────────────
// Replaces the old "Edge X.0" badge. Shows signed pp + tier label so a "Sharp
// Take" reads as a model take with documented hit-rate range, not as 10/10
// confidence in a coin flip.

function EdgeChip({ signedPp, size = 'md' }) {
  const tier = edgeTier(signedPp)
  const pp = formatPp(signedPp)
  const isNeg = signedPp != null && signedPp < 0
  const isPos = signedPp != null && signedPp > 0
  const arrow = isPos ? '▲' : isNeg ? '▼' : '·'
  const padding = size === 'sm' ? 'px-2 py-1' : 'px-2.5 py-1.5'
  const ppSize = size === 'sm' ? 'text-[11px]' : 'text-sm'
  const ppTooltip = pp != null
    ? `${pp} · ${tier.label} — gap between the model's win-probability and the book's implied probability, in percentage points`
    : 'No model edge available for this side'
  return (
    <div
      className={`rounded-sharp ${tier.bg} ${padding} flex flex-col items-end leading-tight flex-shrink-0`}
      title={ppTooltip}
    >
      <div className={`font-mono font-semibold ${ppSize} ${tier.color} tabular-nums tracking-tight`}>
        <span className="mr-0.5">{arrow}</span>{pp ?? '—'}
      </div>
      <div className={`font-mono text-[9px] uppercase tracking-[0.14em] ${tier.color} mt-0.5`}>{tier.label}</div>
      {tier.subtitle && (
        <div className="text-[9px] text-ink-400 lowercase tracking-wide italic leading-none">{tier.subtitle}</div>
      )}
    </div>
  )
}

// ─── MarketTabs ──────────────────────────────────────────────────────────────
// One row per market (ML / Spread / Total). Each row shows both sides with
// signed edges. Math-recommended side is highlighted. Below ±2pp we render
// the value muted so users see "no edge" rather than mistaking 0.4pp for a play.

function MarketRow({ sides, recommendedSide }) {
  const hasAnyEdge = sides.some(s => s.signedPp != null)
  return (
    <div className="rounded-sharp bg-ink-850 shadow-hairline px-3 py-2">
      <div className="space-y-1">
        {sides.map(s => {
          const tier = edgeTier(s.signedPp)
          const isPick = s.side === recommendedSide
          const muted = s.signedPp == null || Math.abs(s.signedPp) < 2
          return (
            <div key={s.side} className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                {isPick && <span className="text-signal-pos font-mono text-[10px] leading-none" title="Model pick">►</span>}
                <span className={`truncate ${isPick ? 'text-signal-pos font-medium' : 'text-ink-200'}`}>
                  {s.text}
                </span>
              </div>
              <span
                className={`flex-shrink-0 font-mono text-[11px] tabular-nums ${muted ? 'text-ink-500' : tier.color}`}
                title={s.signedPp != null ? `${formatPp(s.signedPp)} · ${tier.label}` : 'No model edge for this side'}
              >
                {hasAnyEdge ? (formatPp(s.signedPp) ?? '—') : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MarketTabs({ game }) {
  const { edges, recommended_side } = game
  const defaultTab = recommended_side?.startsWith('over') || recommended_side?.startsWith('under')
    ? 'total'
    : recommended_side?.endsWith('_spread')
      ? 'spread'
      : 'ml'
  const [tab, setTab] = useState(defaultTab)

  const tabs = [
    { id: 'ml',     label: 'ML',     show: game.moneyline_home != null || edges?.home_ml != null },
    { id: 'spread', label: 'Spread', show: game.spread != null        || edges?.home_spread != null },
    { id: 'total',  label: 'Total',  show: game.total != null         || edges?.over != null },
  ].filter(t => t.show)

  // If the previously-chosen tab is no longer available (no market for it),
  // fall back to whatever's first.
  const activeTab = tabs.find(t => t.id === tab) ? tab : tabs[0]?.id

  if (!tabs.length) return null

  const sidesByTab = {
    ml: [
      { side: 'home_ml', text: sidePickText(game, 'home_ml'), signedPp: edgePpForSide(edges, 'home_ml') },
      { side: 'away_ml', text: sidePickText(game, 'away_ml'), signedPp: edgePpForSide(edges, 'away_ml') },
    ],
    spread: [
      { side: 'home_spread', text: sidePickText(game, 'home_spread'), signedPp: edgePpForSide(edges, 'home_spread') },
      { side: 'away_spread', text: sidePickText(game, 'away_spread'), signedPp: edgePpForSide(edges, 'away_spread') },
    ],
    total: [
      { side: 'over',  text: sidePickText(game, 'over'),  signedPp: edgePpForSide(edges, 'over') },
      { side: 'under', text: sidePickText(game, 'under'), signedPp: edgePpForSide(edges, 'under') },
    ],
  }

  return (
    <div>
      <div className="flex items-stretch mb-2 rounded-sharp shadow-hairline overflow-hidden">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] py-1.5 transition-colors ${
              activeTab === t.id
                ? 'text-ink-100 bg-ink-750'
                : 'text-ink-400 bg-ink-900 hover:text-ink-200'
            } ${i > 0 ? 'border-l border-ink-600' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <MarketRow
        sides={sidesByTab[activeTab] || []}
        recommendedSide={recommended_side}
      />
    </div>
  )
}

// ─── GameCard ───────────────────────────────────────────────────────────────

function GameCard({ game, gameKey, sport, onDeepResearch }) {
  const [expanded, setExpanded] = useState(false)

  // Signed edge in pp for the recommended side. When the math returned a real
  // pick, this reflects that bet's edge. When it didn't (no-edge game), we
  // fall back to null so the chip renders "—".
  const signedPp = edgePpForSide(game.edges, game.recommended_side)

  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline overflow-hidden flex flex-col">
      <div className="p-4 flex-1">
        {/* Matchup header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="font-mono font-medium text-ink-100 text-sm leading-tight tracking-tight">
              {game.away_team} <span className="text-ink-500">@</span> {game.home_team}
            </div>
            {(game.away_record || game.home_record) && (
              <div className="font-mono text-[11px] text-ink-400 mt-0.5 tabular-nums">
                {game.away_record && <span>{game.away_record}</span>}
                {game.away_record && game.home_record && <span className="text-ink-600"> vs </span>}
                {game.home_record && <span>{game.home_record}</span>}
              </div>
            )}
            {game.game_date && (
              <div className="font-mono text-[11px] text-ink-500 mt-0.5 tabular-nums">{toMountainTime(game.game_date)} MT</div>
            )}
          </div>
          <EdgeChip signedPp={signedPp} />
        </div>

        {/* Recommended pick */}
        {game.recommended_pick ? (
          <div className="bg-ink-850 rounded-sharp shadow-hairline px-3 py-2 mb-3">
            <div className="font-mono text-[9px] text-ink-400 uppercase tracking-[0.14em] mb-0.5">Model Pick</div>
            <div className="text-signal-pos font-mono font-medium text-sm tabular-nums">{game.recommended_pick}</div>
          </div>
        ) : (
          <div className="bg-ink-850/40 rounded-sharp px-3 py-2 mb-3 border border-dashed border-ink-600">
            <div className="font-mono text-[11px] text-ink-400">No model edge — every market &lt; 2pp</div>
          </div>
        )}

        {/* Per-market tabs */}
        <div className="mb-3">
          <MarketTabs game={game} />
        </div>

        {/* Analysis snippet (expandable) */}
        {game.analysis_snippet && (
          <div>
            <p className={`text-xs text-ink-300 leading-relaxed ${!expanded ? 'line-clamp-2' : ''}`}>
              {game.analysis_snippet}
            </p>
            {game.analysis_snippet.length > 120 && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-signal-pos/80 hover:text-signal-pos mt-1"
              >
                {expanded ? '— show less' : '+ read more'}
              </button>
            )}
          </div>
        )}

        {/* Key factors */}
        {expanded && game.key_factors && (
          <div className="mt-3 pt-3 border-t border-ink-700">
            <div className="font-mono text-[9px] text-ink-400 uppercase tracking-[0.14em] mb-1">Key Factors</div>
            <p className="text-xs text-ink-300 leading-relaxed">
              {Array.isArray(game.key_factors)
                ? game.key_factors.join(' · ')
                : String(game.key_factors)}
            </p>
          </div>
        )}
      </div>

      {/* Action row — Deep Research. The pick itself is information, not a
          button: the machine builds the parlays now. */}
      <div className="px-4 pb-4 pt-0 flex gap-2">
        {gameKey && (
          <button
            onClick={() => onDeepResearch(game, gameKey)}
            className="flex-1 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-300 hover:text-ink-100 bg-ink-850 hover:bg-ink-800 rounded-sharp shadow-hairline hover:shadow-hairline-bright transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
          >
            <span className="text-signal-pos">+</span> Research
          </button>
        )}
      </div>
    </div>
  )
}

// ─── InjurySection ──────────────────────────────────────────────────────────

function InjurySection({ content }) {
  const [open, setOpen] = useState(false)
  if (!content) return null

  const lines = typeof content === 'string'
    ? content.split('\n').filter(l => l.trim())
    : []

  return (
    <div className="mt-4 border-t border-ink-700 pt-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm font-semibold text-orange-400 hover:text-orange-300 w-full text-left"
      >
        <span>🩹 Injury Report</span>
        <span className="text-ink-400 text-xs ml-auto">{open ? '▲ Hide' : '▼ Show'}</span>
      </button>
      {open && (
        <ul className="mt-3 space-y-1">
          {lines.length > 0
            ? lines.map((line, i) => (
                <li key={i} className="text-xs text-ink-300 flex items-start gap-2">
                  <span className="text-orange-500 flex-shrink-0 mt-0.5">•</span>
                  {line}
                </li>
              ))
            : (
              <li className="text-xs text-ink-400 italic">No injury data available.</li>
            )}
        </ul>
      )}
    </div>
  )
}

// ─── SportSection ────────────────────────────────────────────────────────────

function SportSection({ sport, games, injuries, isDefaultExpanded, onDeepResearch, upcomingCount }) {
  const [expanded, setExpanded] = useState(isDefaultExpanded)
  const meta = getSportMeta(sport)

  // Split games by whether the math returned an actionable pick. "On the
  // bubble" surfaces games where the model considered the matchup but every
  // market sat below the +2pp threshold — kept visible (so users see we're
  // not forcing picks) but separated from the actionable list.
  const ppFor = (g) => edgePpForSide(g.edges, g.recommended_side)
  const pickGames = games.filter(g => g.recommended_pick && (ppFor(g) ?? 0) >= 2)
  const bubbleGames = games.filter(g => !pickGames.includes(g))

  // Top 3 actionable picks for the collapsed preview / top tile grid.
  const topGames = pickGames.slice(0, 3)
  const extraGames = pickGames.slice(3)
  const injuryCode = ANALYSIS_SPORT_TO_CODE[sport] || sport
  const injuryEntry = injuries[injuryCode]
  const topSignedPp = pickGames[0] ? ppFor(pickGames[0]) : null
  const topTier = edgeTier(topSignedPp)

  // Use game_key from the DB directly (returned by /api/digest)
  function getGameKey(game) {
    return game.game_key || null
  }

  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline overflow-hidden">
      {/* Sport header bar — clickable to collapse/expand */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left bg-ink-850 px-6 py-4 border-b border-ink-700 hover:bg-ink-800 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl flex-shrink-0">{meta.emoji}</span>
            <div className="min-w-0">
              <h2 className="font-mono text-base font-semibold text-ink-100 uppercase tracking-[0.06em]">{meta.label}</h2>
              <p className="font-mono text-[11px] text-ink-400 tabular-nums">
                {pickGames.length} pick{pickGames.length !== 1 ? 's' : ''}
                {bubbleGames.length > 0 && <span className="text-ink-500"> · {bubbleGames.length} on the bubble</span>}
                {upcomingCount > 0 && <span className="text-ink-500"> · {upcomingCount} next 24h</span>}
                {!expanded && topSignedPp != null && (
                  <span className="ml-2 text-ink-500">
                    · Top: <span className={`font-semibold ${topTier.color}`}>{formatPp(topSignedPp)} {topTier.label}</span>
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Chevron */}
            <span className="font-mono text-ink-400 text-xs select-none">
              {expanded ? '▲' : '▼'}
            </span>
          </div>
        </div>
      </button>

      {/* Collapsed preview — top 3 actionable picks as compact rows */}
      {!expanded && topGames.length > 0 && (
        <div className="px-6 py-3 space-y-2">
          {topGames.map((game, i) => {
            const pp = ppFor(game)
            const tier = edgeTier(pp)
            return (
              <div key={i} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`px-1.5 py-0.5 rounded-sharp font-mono text-[10px] font-semibold flex-shrink-0 tabular-nums ${tier.bg} ${tier.color}`}>
                    {formatPp(pp) ?? '—'}
                  </span>
                  <span className="text-ink-200 truncate">{game.away_team} @ {game.home_team}</span>
                </div>
                <span className="font-mono text-signal-pos text-xs font-medium flex-shrink-0 truncate max-w-[140px] tabular-nums">
                  {game.recommended_pick || '—'}
                </span>
              </div>
            )
          })}
          {pickGames.length > 3 && (
            <p className="font-mono text-[10px] text-ink-500 text-center pt-1 uppercase tracking-[0.14em]">Tap to see all {pickGames.length} picks</p>
          )}
        </div>
      )}

      {/* Expanded body — full tiles */}
      {expanded && (
        <div className="p-6">
          {pickGames.length > 0 ? (
            <>
              <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400 mb-3 font-medium">
                Picks · ranked by model edge
              </h3>
              {/* Top 3 tiles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {topGames.map((game, i) => (
                  <GameCard
                    key={`${game.home_team}-${game.away_team}-${i}`}
                    game={game}
                    gameKey={getGameKey(game)}
                    sport={sport}
                    onDeepResearch={onDeepResearch}
                  />
                ))}
              </div>

              {/* Additional picks beyond top 3 */}
              {extraGames.length > 0 && (
                <>
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 border-t border-ink-700" />
                    <span className="font-mono text-[10px] text-ink-500 uppercase tracking-[0.14em] whitespace-nowrap">
                      {extraGames.length} more {meta.label} pick{extraGames.length !== 1 ? 's' : ''}
                    </span>
                    <div className="flex-1 border-t border-ink-700" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {extraGames.map((game, i) => (
                      <GameCard
                        key={`${game.home_team}-${game.away_team}-extra-${i}`}
                        game={game}
                        gameKey={getGameKey(game)}
                        onDeepResearch={onDeepResearch}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="rounded-sharp bg-ink-950/40 border border-dashed border-ink-700 px-4 py-6 text-center text-sm text-ink-400">
              No actionable picks for {meta.label} today — the model considered every game and didn't find an edge ≥ 2pp.
            </div>
          )}

          {/* On the bubble — games we analyzed but didn't recommend */}
          {bubbleGames.length > 0 && (
            <details className="mt-6 group">
              <summary className="cursor-pointer list-none flex items-center gap-2 select-none">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400 font-medium">
                  On the bubble
                </span>
                <span className="font-mono text-[10px] text-ink-500 tabular-nums">{bubbleGames.length} game{bubbleGames.length !== 1 ? 's' : ''} · model has no edge</span>
                <span className="ml-auto text-ink-400 text-xs group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {bubbleGames.map((game, i) => (
                  <GameCard
                    key={`${game.home_team}-${game.away_team}-bubble-${i}`}
                    game={game}
                    gameKey={getGameKey(game)}
                    sport={sport}
                    onDeepResearch={onDeepResearch}
                  />
                ))}
              </div>
            </details>
          )}

          {/* Injuries */}
          <InjurySection content={injuryEntry?.content} />
        </div>
      )}
    </div>
  )
}

// ─── PickOfTheDay ────────────────────────────────────────────────────────────
// The single highest-edge tile across all sports today, featured prominently
// above the sport sections. This IS the "first Sharp Take seen" aha moment for
// new users — without it, they'd have to expand sport accordions to find the
// best play. With it, the value prop lands on first scroll.

function PickOfTheDay({ pick, tierCounts, totalGames, tierStats }) {
  const [expanded, setExpanded] = useState(false)
  if (!pick) return null
  const { game, sport, signedPp } = pick
  const tier = edgeTier(signedPp)
  const sportMeta = getSportMeta(sport)
  const arrow = signedPp > 0 ? '▲' : '▼'
  const pp = formatPp(signedPp)

  // Surface the model's view in human terms when the data is on the row.
  // pre-analyze writes calc_*_prob and implied_*_prob alongside edges, but
  // they may be absent on older rows — fall back gracefully.
  const side = game.recommended_side
  const isHomeSide = side === 'home_ml' || side === 'home_spread'
  const isAwaySide = side === 'away_ml' || side === 'away_spread'
  const modelProb = isHomeSide ? game.calc_home_prob : isAwaySide ? game.calc_away_prob : null
  const impliedProb = isHomeSide ? game.implied_home_prob : isAwaySide ? game.implied_away_prob : null
  const showProbCompare = modelProb != null && impliedProb != null && (side === 'home_ml' || side === 'away_ml')

  // Rank context — "highest of N graded today" gives the headline its bite.
  const totalSignalPicks = (tierCounts?.sharpTakes || 0) + (tierCounts?.strongPlays || 0) + (tierCounts?.plays || 0) + (tierCounts?.leans || 0)

  // Track record across same-tier picks (last 30 days). Combines Sharp Take +
  // Strong Play when both are present so a low-volume sport still has signal.
  // Hidden until ≥10 settled — small samples mislead more than they help.
  const trackRecord = (() => {
    const ts = tierStats?.sharpTake
    if (!ts) return null
    const w = ts.won || 0
    const l = ts.lost || 0
    if (w + l < 10) return null
    return { w, l, rate: ((w / (w + l)) * 100).toFixed(1) }
  })()

  return (
    <div className="bg-ink-900 rounded-sharp overflow-hidden shadow-hairline-pos">
      {/* Top bar — featured label + sport context */}
      <div className="flex items-center justify-between px-5 py-2 bg-signal-pos-dim/25 border-b border-signal-pos-dim/60">
        <span className="font-mono text-[10px] uppercase tracking-[0.20em] text-signal-pos font-semibold">
          ★ Pick of the Day
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-300">
          {sportMeta.emoji} {sportMeta.label}
        </span>
      </div>

      <div className="p-5 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-mono text-sm text-ink-300 tracking-tight tabular-nums">
              {game.away_team} <span className="text-ink-500">@</span> {game.home_team}
              {game.game_date && <span className="text-ink-500"> · {toMountainTime(game.game_date)} MT</span>}
            </div>
            <div className="mt-2 font-mono text-2xl md:text-3xl font-bold text-signal-pos tabular-nums tracking-tight leading-tight">
              {game.recommended_pick}
            </div>
          </div>

          {/* Edge stat block — sized larger than a regular EdgeChip */}
          <div className={`flex flex-col items-end leading-tight flex-shrink-0 rounded-sharp ${tier.bg} px-3 py-2`}>
            <div className={`font-mono text-2xl font-bold ${tier.color} tabular-nums tracking-tight`}>
              <span className="mr-1">{arrow}</span>{pp}
            </div>
            <div className={`font-mono text-[10px] uppercase tracking-[0.14em] ${tier.color} mt-0.5`}>{tier.label}</div>
            {tier.subtitle && (
              <div className="text-[10px] text-ink-400 lowercase italic leading-none">{tier.subtitle}</div>
            )}
          </div>
        </div>

        {/* Sharp Take track record — last 30d hit rate for same-tier picks.
            Hidden until ≥10 settled (see trackRecord derivation above). The
            point isn't to celebrate the model — it's to show the receipt. */}
        {trackRecord && (
          <div className="mt-3 flex items-center justify-between bg-ink-850 shadow-hairline rounded-sharp px-3 py-2 gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-300">
              Sharp Take · last 30 days
            </span>
            <span className="font-mono text-sm tabular-nums flex-shrink-0">
              <span className="text-signal-pos font-semibold">{trackRecord.w}W</span>
              <span className="text-ink-500 mx-1">·</span>
              <span className="text-ink-400">{trackRecord.l}L</span>
              <span className="text-ink-500 mx-1">·</span>
              <span className={parseFloat(trackRecord.rate) >= 55 ? 'text-signal-pos font-semibold' : 'text-ink-200'}>
                {trackRecord.rate}%
              </span>
            </span>
          </div>
        )}

        {/* Why this pick — rank context + model-vs-market in human terms */}
        <div className="mt-4 bg-ink-850 shadow-hairline rounded-sharp px-3 py-2.5">
          <div className="font-mono text-[9px] text-signal-pos uppercase tracking-[0.18em] mb-1.5">Why this pick</div>
          <div className="space-y-1 font-mono text-xs">
            <div className="flex items-start gap-2">
              <span className="text-signal-pos flex-shrink-0">▸</span>
              <span className="text-ink-200 tabular-nums">
                Highest edge across <span className="text-ink-100 font-semibold">{totalGames}</span> game{totalGames !== 1 ? 's' : ''} graded today
                {totalSignalPicks > 0 && (
                  <span className="text-ink-400"> · ahead of {totalSignalPicks - 1} other actionable pick{totalSignalPicks !== 2 ? 's' : ''}</span>
                )}
              </span>
            </div>
            {showProbCompare && (
              <div className="flex items-start gap-2">
                <span className="text-signal-pos flex-shrink-0">▸</span>
                <span className="text-ink-200 tabular-nums">
                  Model gives this side <span className="text-signal-pos font-semibold">{(modelProb * 100).toFixed(1)}%</span>
                  <span className="text-ink-400"> · book implies </span>
                  <span className="text-ink-100">{(impliedProb * 100).toFixed(1)}%</span>
                  <span className="text-ink-400"> · {pp} gap</span>
                </span>
              </div>
            )}
            {!showProbCompare && (
              <div className="flex items-start gap-2">
                <span className="text-signal-pos flex-shrink-0">▸</span>
                <span className="text-ink-200 tabular-nums">
                  Model disagrees with the book by <span className="text-signal-pos font-semibold">{pp}</span> on this side
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Analysis snippet — surfaces De-Genny's voice on the featured pick.
            Expandable with the same +read more / −show less pattern as regular tiles. */}
        {game.analysis_snippet && (
          <div className="mt-3">
            <p className={`text-sm text-ink-300 leading-relaxed ${!expanded ? 'line-clamp-3' : ''}`}>
              {game.analysis_snippet}
            </p>
            {game.analysis_snippet.length > 220 && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-signal-pos/80 hover:text-signal-pos mt-1.5"
              >
                {expanded ? '− show less' : '+ read more'}
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

// ─── GolfLeaderboard ─────────────────────────────────────────────────────────

function fmtGolfPrice(price) {
  if (price == null) return '—'
  const n = Number(price)
  return n > 0 ? `+${n}` : String(n)
}

function GolfFieldBoard({ field }) {
  const [expanded, setExpanded] = useState(false)
  const [openNote, setOpenNote] = useState(null)
  const players = field.players || []
  const shown = expanded ? players : players.slice(0, 10)

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400 mb-2">
        <span className="text-ink-200">{field.name}</span>
        <span>· outright market, field of {players.length}</span>
      </div>
      <div className="flex items-center gap-3 px-2 py-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-ink-500">
        <span className="flex-1">Player</span>
        <span className="w-14 text-right">Best</span>
        <span className="w-14 text-right">Win %</span>
        <span className="w-16 text-right">vs fair</span>
      </div>
      <div className="space-y-0.5">
        {shown.map((p, i) => (
          <div key={i}>
            <button
              onClick={() => setOpenNote(openNote === i ? null : i)}
              className={`w-full flex items-center gap-3 px-2 py-1.5 rounded-sharp text-left transition-colors ${openNote === i ? 'bg-ink-850' : 'hover:bg-ink-850/60'}`}
            >
              <span className="flex-1 min-w-0 text-sm text-ink-100 font-medium truncate">
                {p.name}
                {p.position && <span className="ml-2 font-mono text-[10px] text-signal-pos">P{p.position} {p.score}</span>}
              </span>
              <span className="w-14 text-right font-mono text-xs text-ink-200 tabular-nums">{fmtGolfPrice(p.best_price)}</span>
              <span className="w-14 text-right font-mono text-xs text-ink-400 tabular-nums">{p.consensus_prob != null ? `${(p.consensus_prob * 100).toFixed(1)}%` : '—'}</span>
              <span className={`w-16 text-right font-mono text-xs tabular-nums ${p.value_pp > 0 ? 'text-signal-pos' : p.value_pp < 0 ? 'text-signal-neg' : 'text-ink-500'}`}>
                {p.value_pp != null ? `${p.value_pp > 0 ? '+' : ''}${p.value_pp.toFixed(1)}pp` : ''}
              </span>
            </button>
            {openNote === i && p.note && (
              <p className="px-2 pb-2 pt-1 text-xs text-ink-300 leading-relaxed">{p.note}</p>
            )}
            {openNote === i && !p.note && (
              <p className="px-2 pb-2 pt-1 text-xs text-ink-500">No research note for this player yet — deeper in the field than the analysis covers.</p>
            )}
          </div>
        ))}
      </div>
      {players.length > 10 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full mt-2 text-center text-xs font-mono text-signal-pos/80 hover:text-signal-pos"
        >
          {expanded ? 'Show less' : `Show the full field (${players.length})`}
        </button>
      )}
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-600">
        devigged from live books · "vs fair" compares the best available price to the blended fair number · not a graded pick
      </p>
    </div>
  )
}

function GolfLeaderboard({ golf }) {
  const [expanded, setExpanded] = useState(false)
  if (!golf) return null

  const preview = golf.leaderboard?.slice(0, 5) || []
  const full = golf.leaderboard || []
  const shown = expanded ? full : preview
  const fields = golf.fields || []

  return (
    <div className="bg-ink-900 rounded-sharp border border-ink-700 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-ink-850 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">⛳</span>
          <div className="text-left">
            <h3 className="text-lg font-bold text-white">{golf.tournament}</h3>
            <p className="text-sm text-ink-300">{golf.status}{golf.venue ? ` — ${golf.venue}` : ''}</p>
          </div>
        </div>
        <span className="text-ink-300 text-sm">{expanded ? '▲' : '▼'}</span>
      </button>

      <div className="px-4 pb-4">
        {/* Live leaderboard */}
        {full.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-ink-400 px-2 mb-1">
              <span>Pos</span>
              <span className="flex-1 ml-3">Player</span>
              <span className="w-16 text-right">Score</span>
            </div>
            {shown.map((p, i) => (
              <div key={i} className={`flex items-center justify-between px-2 py-1.5 rounded ${i < 3 ? 'bg-ink-850' : ''}`}>
                <span className={`w-6 text-sm font-bold ${i < 3 ? 'text-signal-pos' : 'text-ink-300'}`}>{p.position}</span>
                <span className="flex-1 ml-2 text-sm text-white font-medium">{p.name}</span>
                <span className={`w-16 text-right text-sm font-bold ${
                  p.score?.toString().startsWith('-') ? 'text-green-400' : p.score === 'E' ? 'text-ink-200' : 'text-signal-neg'
                }`}>{p.score}</span>
              </div>
            ))}
            {full.length > 5 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="w-full mt-1 text-center text-xs font-mono text-signal-pos/80 hover:text-signal-pos"
              >
                {expanded ? 'Show less' : `Show all ${full.length} players`}
              </button>
            )}
          </div>
        )}

        {/* Researched field boards — one per tournament with live outright odds */}
        {fields.map(f => <GolfFieldBoard key={f.key} field={f} />)}
      </div>
    </div>
  )
}

// ─── YesterdayRecap ──────────────────────────────────────────────────────────

function RecapCard({ sport, won, lost, picks }) {
  const [expanded, setExpanded] = useState(false)
  const total = won + lost
  const rate = total > 0 ? Math.round((won / total) * 100) : null
  const meta = getSportMeta(sport)
  const visible = expanded ? picks : picks.slice(0, 4)

  return (
    <div className="bg-ink-950 rounded-sharp p-4 border border-ink-700">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span>{meta.emoji}</span>
          <span className="font-semibold text-white text-sm">{meta.label}</span>
        </div>
        <span className={`text-sm font-bold ${winRateColor(rate)}`}>
          {won}-{lost}{rate != null ? ` (${rate}%)` : ''}
        </span>
      </div>
      <div className="space-y-1.5">
        {visible.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
              p.outcome === 'won'
                ? 'bg-green-900 text-green-300 border border-ink-700'
                : 'bg-signal-neg-dim text-signal-neg border border-red-700'
            }`}>
              {p.outcome === 'won' ? 'W' : 'L'}
            </span>
            <span className="text-xs text-ink-300 truncate">
              {p.pick || `${p.away_team} @ ${p.home_team}`}
            </span>
          </div>
        ))}
      </div>
      {picks.length > 4 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          {expanded ? 'Show less' : `Show all ${picks.length} picks`}
        </button>
      )}
    </div>
  )
}

function YesterdayRecap({ results }) {
  const sports = Object.keys(results)
  if (sports.length === 0) return null

  return (
    <div className="bg-ink-900 rounded-sharp border border-ink-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-ink-700">
        <h2 className="text-lg font-bold text-white">Recent Results</h2>
        <p className="text-xs text-ink-300 mt-0.5">Picks settled in the last 3 days</p>
      </div>
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sports.map(sport => (
          <RecapCard key={sport} sport={sport} won={results[sport].won} lost={results[sport].lost} picks={results[sport].picks} />
        ))}
      </div>
    </div>
  )
}

// ─── ModelPerformance ────────────────────────────────────────────────────────

function ModelPerformance({ accuracy }) {
  const [period, setPeriod] = React.useState('last_7d')
  const data = accuracy?.[period]
  if (!data || !data.overall) return null

  const { overall, bySport, byBetType } = data
  const sports = Object.entries(bySport || {}).sort((a, b) => (b[1].winRate || 0) - (a[1].winRate || 0))
  const betTypes = Object.entries(byBetType || {}).sort((a, b) => (b[1].winRate || 0) - (a[1].winRate || 0))

  const periodLabel = period === 'last_7d' ? 'in the last 7 days'
    : period === 'last_30d' ? 'in the last 30 days'
    : 'all time'

  const pills = [
    { key: 'last_7d',  label: '7d' },
    { key: 'last_30d', label: '30d' },
    { key: 'all',      label: 'All' },
  ]

  return (
    <div className="bg-ink-900 rounded-sharp border border-ink-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-ink-700 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Model Performance</h2>
          <p className="text-xs text-ink-300 mt-0.5">{overall.total} picks settled {periodLabel}</p>
        </div>
        <div className="flex bg-ink-950 rounded-sharp p-0.5">
          {pills.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${period === p.key ? 'bg-purple-600 text-white' : 'text-ink-300 hover:text-ink-100'}`}
            >{p.label}</button>
          ))}
        </div>
      </div>
      <div className="p-6">
        {/* Overall rate */}
        {overall.winRate != null && (
          <div className="text-center mb-6 pb-6 border-b border-ink-700">
            <div className="text-xs text-ink-400 uppercase tracking-widest mb-1">Overall Win Rate</div>
            <div className={`text-5xl font-extrabold ${winRateColor(overall.winRate)}`}>
              {overall.winRate}%
            </div>
            <div className="text-sm text-ink-400 mt-1">
              {overall.won}W — {overall.lost}L
            </div>
          </div>
        )}

        {/* Per-sport bars */}
        {sports.length > 0 && (
          <>
            <div className="text-xs text-ink-400 uppercase tracking-widest mb-2">By Sport</div>
            <div className="space-y-3 mb-6">
              {sports.map(([sport, stats]) => {
                const meta = getSportMeta(sport)
                return (
                  <div key={sport}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{meta.emoji}</span>
                        <span className="text-sm text-ink-200 font-medium">{meta.label}</span>
                        <span className="text-xs text-ink-500">({stats.won}W-{stats.lost}L)</span>
                      </div>
                      <span className={`text-sm font-bold ${winRateColor(stats.winRate)}`}>
                        {stats.winRate != null ? `${stats.winRate}%` : 'N/A'}
                      </span>
                    </div>
                    <div className="h-2 bg-ink-800 rounded-full overflow-hidden">
                      {stats.winRate != null && (
                        <div
                          className={`h-full rounded-full transition-all ${winRateBarColor(stats.winRate)}`}
                          style={{ width: `${stats.winRate}%` }}
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* Per-bet-type bars */}
        {betTypes.length > 0 && (
          <>
            <div className="text-xs text-ink-400 uppercase tracking-widest mb-2">By Bet Type</div>
            <div className="space-y-3">
              {betTypes.map(([betType, stats]) => (
                <div key={betType}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ink-200 font-medium">{betType}</span>
                      <span className="text-xs text-ink-500">({stats.won}W-{stats.lost}L)</span>
                    </div>
                    <span className={`text-sm font-bold ${winRateColor(stats.winRate)}`}>
                      {stats.winRate != null ? `${stats.winRate}%` : 'N/A'}
                    </span>
                  </div>
                  <div className="h-2 bg-ink-800 rounded-full overflow-hidden">
                    {stats.winRate != null && (
                      <div
                        className={`h-full rounded-full transition-all ${winRateBarColor(stats.winRate)}`}
                        style={{ width: `${stats.winRate}%` }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── QuietDayCard — fallback hero when nothing clears the feature bar ────────
// The bar stays at 7pp; on a quiet slate the honest move is to say so and
// hand the user a next step, not to leave a hole where the hero was.

function QuietDayCard({ best, trapCount }) {
  const tier = best ? edgeTier(best.signedPp) : null
  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline p-6 md:p-8">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400 mb-3">
        Pick of the day · 7pp feature bar
      </div>
      <h2 className="text-xl md:text-2xl font-bold text-ink-100 leading-tight">
        No featured pick today.
      </h2>
      <p className="text-sm text-ink-300 mt-2 leading-relaxed max-w-2xl">
        Nothing on the board cleared the 7-point feature bar, and we don't
        lower the bar on quiet days — that discipline is what the record is
        built on. Here's what's still worth your time:
      </p>
      <div className="mt-5 space-y-3">
        {best && (
          <div className="flex items-start gap-3 bg-ink-850 rounded-sharp p-4 shadow-hairline">
            <span className={`px-2 py-0.5 rounded-sharp text-[10px] font-mono font-bold uppercase tracking-wider ${tier.color} ${tier.bg}`}>
              {tier.label}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink-100">
                {best.game.recommended_pick}
                <span className="text-signal-pos/80 ml-2 font-mono text-xs">{formatPp(best.signedPp)}</span>
              </div>
              <div className="text-xs text-ink-400 mt-0.5">
                {best.sport} · {best.game.away_team} @ {best.game.home_team} · best edge on a quiet board, below our feature bar — size it accordingly
              </div>
            </div>
          </div>
        )}
        {trapCount > 0 && (
          <p className="text-sm text-ink-300">
            <span className="text-signal-neg font-bold font-mono">{trapCount}</span> Trap{trapCount !== 1 ? 's' : ''} on the board below — knowing what <span className="text-ink-100">not</span> to bet is half the product.
          </p>
        )}
        <button
          onClick={() => { window.location.hash = '#/chat' }}
          className="px-5 py-2.5 bg-ink-850 shadow-hairline hover:bg-ink-800 hover:shadow-hairline-bright rounded-sharp font-mono font-medium uppercase tracking-[0.12em] text-xs text-ink-200 transition-all active:scale-[0.98]"
        >
          Ask De-Genny what's worth a look →
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function DailyDigest({ onBack }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deepResearchTarget, setDeepResearchTarget] = useState(null) // { game, gameKey }
  const [legendOpen, setLegendOpen] = useState(false)
  // Sharp Take / Strong Play hit-rate over last 30d — surfaces below the
  // featured pick to anchor the picks-actually-win narrative ("don't trust
  // me, trust the receipt").
  const [tierStats, setTierStats] = useState(null)

  const fetchDigest = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/digest`)
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDigest()
  }, [fetchDigest])

  // Fetch tier hit-rate once per mount. Drives the Sharp Take track record
  // badge on PickOfTheDay. Cheap query (≤6 rows from a materialized view).
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    ;(async () => {
      const { data: rows } = await supabase
        .from('mv_model_accuracy')
        .select('*')
        .eq('period_bucket', 'last_30d')
        .eq('dimension_type', 'tier')
      if (cancelled || !rows) return
      const byTier = (name) => rows.find(r => r.dimension_value === name) || null
      setTierStats({ sharpTake: byTier('Sharp Take'), strongPlay: byTier('Strong Play') })
    })()
    return () => { cancelled = true }
  }, [])

  const sportSections = data
    ? Object.entries(data.gamesBySport)
        .filter(([, games]) => games.length > 0)
        .sort((a, b) => b[1].length - a[1].length)
    : []

  const totalGames = sportSections.reduce((sum, [, games]) => sum + games.length, 0)
  const totalSports = sportSections.length

  // Count tiles by tier so we can render a count-first hero ("12 Sharp Takes today").
  // Cheaper than rendering every tile twice — derived once per data refresh.
  const tierCounts = useMemo(() => {
    const c = { sharpTakes: 0, strongPlays: 0, plays: 0, leans: 0, traps: 0 }
    if (!data?.gamesBySport) return c
    for (const games of Object.values(data.gamesBySport)) {
      for (const g of games) {
        const pp = edgePpForSide(g.edges, g.recommended_side)
        if (pp == null) continue
        if (pp < 0) c.traps++
        else if (pp >= 10) c.sharpTakes++
        else if (pp >= 7) c.strongPlays++
        else if (pp >= 4) c.plays++
        else if (pp >= 2) c.leans++
      }
    }
    return c
  }, [data])

  // Pick of the Day — the single highest-edge tile across all sports today.
  // Featured only when it clears the Strong Play tier (>= 7pp) AND has a real
  // recommended_pick string. Settled results showed sub-7pp picks running
  // 46-51%, which is not headline material. Otherwise the callout hides,
  // which is the honest move on a quiet board.
  const POD_MIN_PP = 7
  const pickOfTheDay = useMemo(() => {
    if (!data?.gamesBySport) return null
    let best = null
    for (const [sport, games] of Object.entries(data.gamesBySport)) {
      for (const g of games) {
        const pp = edgePpForSide(g.edges, g.recommended_side)
        if (pp == null || pp < POD_MIN_PP) continue
        if (!g.recommended_pick) continue
        if (!best || pp > best.signedPp) {
          best = { game: g, sport, signedPp: pp }
        }
      }
    }
    return best
  }, [data])

  // Quiet-day fallback: the best sub-feature-bar edge, so a first session on
  // a quiet board still has a next step instead of a missing hero (audit 40,
  // funnel leak 5). Never dressed up as a Pick of the Day — labeled honestly.
  const quietBest = useMemo(() => {
    if (!data?.gamesBySport || pickOfTheDay) return null
    let best = null
    for (const [sport, games] of Object.entries(data.gamesBySport)) {
      for (const g of games) {
        const pp = edgePpForSide(g.edges, g.recommended_side)
        if (pp == null || pp < 2) continue
        if (!g.recommended_pick) continue
        if (!best || pp > best.signedPp) {
          best = { game: g, sport, signedPp: pp }
        }
      }
    }
    return best
  }, [data, pickOfTheDay])

  // 30d hit-rate for the hero trust anchor — prefer 30d, fall back to 7d, then all-time.
  const heroHitRate = data?.modelAccuracy?.last_30d?.overall?.winRate != null
    ? { rate: data.modelAccuracy.last_30d.overall.winRate, label: '30d' }
    : data?.modelAccuracy?.last_7d?.overall?.winRate != null
      ? { rate: data.modelAccuracy.last_7d.overall.winRate, label: '7d' }
      : data?.modelAccuracy?.all?.overall?.winRate != null
        ? { rate: data.modelAccuracy.all.overall.winRate, label: 'all-time' }
        : null

  const handleOpenDeepResearch = useCallback((game, gameKey) => {
    setDeepResearchTarget({ game, gameKey })
  }, [])

  const handleCloseDeepResearch = useCallback(() => {
    setDeepResearchTarget(null)
  }, [])

  return (
    <div className="min-h-screen bg-ink-950 text-white font-sans">
      {/* Top nav bar — the digest is the authenticated home, so there is no
          "Back". Other surfaces are forward navigation. */}
      <div className="sticky top-0 z-30 bg-ink-950/95 border-b border-ink-800 backdrop-blur px-4 py-3 flex items-center gap-3">
        <span className="text-sm font-semibold text-ink-200">Daily Digest</span>
        <button
          onClick={() => { window.location.hash = '#/ledger' }}
          className="ml-auto px-3 py-1.5 text-xs font-semibold bg-ink-900 hover:bg-ink-800 text-ink-200 rounded-sharp border border-ink-700 transition-colors active:scale-95"
        >
          Ledger
        </button>
        <button
          onClick={onBack}
          className="px-3 py-1.5 text-xs font-semibold bg-ink-900 hover:bg-ink-800 text-ink-200 rounded-sharp border border-ink-700 transition-colors active:scale-95"
        >
          The Board
        </button>
        <button
          onClick={fetchDigest}
          className="px-3 py-1.5 text-xs font-semibold bg-ink-900 hover:bg-ink-800 text-ink-200 rounded-sharp border border-ink-700 transition-colors active:scale-95"
        >
          {loading ? '...' : '↻ Refresh'}
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Hero header */}
        <div className="bg-ink-900 rounded-sharp shadow-hairline p-6 md:p-8">
          {/* Top meta row: today's date + 30d model hit-rate (trust anchor) + edge legend trigger */}
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400 mb-3 gap-3">
            <span className="truncate">{data ? formatFullDate(null) : 'Loading...'}</span>
            <div className="flex items-center gap-4 flex-shrink-0">
              {heroHitRate && (
                <span>
                  Model · <span className={`tabular-nums ${winRateColor(heroHitRate.rate)}`}>{heroHitRate.rate}%</span> · {heroHitRate.label}
                </span>
              )}
              <button
                onClick={() => setLegendOpen(true)}
                className="text-ink-400 hover:text-signal-pos transition-colors flex items-center gap-1"
                title="What do these pp numbers and tier labels mean?"
              >
                <span className="text-signal-pos">ⓘ</span> How edges work
              </button>
            </div>
          </div>

          <div className="min-w-0">
            {/* Count-first headline — math-derived, instantly tells you what's actionable today */}
              {data ? (
                tierCounts.sharpTakes > 0 ? (
                  <h1 className="font-mono text-3xl md:text-4xl font-bold tracking-tight tabular-nums text-ink-100 leading-tight">
                    <span className="text-signal-pos">{tierCounts.sharpTakes}</span> Sharp Take{tierCounts.sharpTakes !== 1 ? 's' : ''}
                    {tierCounts.strongPlays > 0 && (
                      <span className="text-ink-400"> · </span>
                    )}
                    {tierCounts.strongPlays > 0 && (
                      <span><span className="text-signal-pos">{tierCounts.strongPlays}</span> <span className="text-ink-200">Strong</span></span>
                    )}
                  </h1>
                ) : tierCounts.strongPlays > 0 ? (
                  <h1 className="font-mono text-3xl md:text-4xl font-bold tracking-tight tabular-nums text-ink-100 leading-tight">
                    <span className="text-signal-pos">{tierCounts.strongPlays}</span> Strong Play{tierCounts.strongPlays !== 1 ? 's' : ''}
                  </h1>
                ) : (
                  <h1 className="font-mono text-2xl md:text-3xl font-bold tracking-tight text-ink-100 leading-tight">
                    Quiet board — no tiles cleared 7pp today
                  </h1>
                )
              ) : (
                <h1 className="font-mono text-3xl md:text-4xl font-bold text-ink-300">…</h1>
              )}

              {/* Secondary tier counts + traps to fade */}
              {data && (
                <p className="text-sm mt-2 font-mono tabular-nums text-ink-300">
                  {tierCounts.plays > 0 && <span><span className="text-signal-pos">{tierCounts.plays}</span> Play{tierCounts.plays !== 1 ? 's' : ''}</span>}
                  {tierCounts.plays > 0 && tierCounts.leans > 0 && <span className="text-ink-600"> · </span>}
                  {tierCounts.leans > 0 && <span><span className="text-signal-pos/70">{tierCounts.leans}</span> Lean{tierCounts.leans !== 1 ? 's' : ''}</span>}
                  {(tierCounts.plays > 0 || tierCounts.leans > 0) && tierCounts.traps > 0 && <span className="text-ink-600"> · </span>}
                  {tierCounts.traps > 0 && <span><span className="text-signal-neg">{tierCounts.traps}</span> Trap{tierCounts.traps !== 1 ? 's' : ''} to fade</span>}
                </p>
              )}

              {/* System explainer for first-time users */}
              {data && (
                <p className="text-ink-400 text-xs mt-3 font-mono leading-relaxed">
                  {totalGames} game{totalGames !== 1 ? 's' : ''} graded across {totalSports} sport{totalSports !== 1 ? 's' : ''}. Math picks the side. De-Genny narrates.
                </p>
              )}

              {data?.firstGameTime && <Countdown targetIso={data.firstGameTime} />}
          </div>
        </div>

        {/* Loading state */}
        {loading && <LoadingSkeleton />}

        {/* Error state */}
        {!loading && error && (
          <div className="bg-signal-neg-dim/40 border border-red-700 rounded-sharp p-6 text-center">
            <p className="text-signal-neg font-medium">Failed to load digest</p>
            <p className="text-signal-neg text-sm mt-1">{error}</p>
            <button
              onClick={fetchDigest}
              className="mt-4 px-4 py-2 bg-red-800 hover:bg-red-700 rounded-sharp text-sm text-white"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Sport sections */}
        {!loading && !error && data && (
          <>
            {/* Model Performance — right after hero */}
            {(data.modelAccuracy?.last_7d?.overall || data.modelAccuracy?.last_30d?.overall || data.modelAccuracy?.all?.overall) && (
              <ModelPerformance accuracy={data.modelAccuracy} />
            )}

            {/* Yesterday's Recap — right after performance */}
            {Object.keys(data.yesterdayResults).length > 0 && (
              <YesterdayRecap results={data.yesterdayResults} />
            )}

            {/* Pick of the Day — the single best edge across all sports, featured
                above the accordions so new users see the aha moment on first scroll. */}
            {pickOfTheDay && <PickOfTheDay pick={pickOfTheDay} tierCounts={tierCounts} totalGames={totalGames} tierStats={tierStats} />}
            {/* Dark slate (no games at all) gets the calendar card below instead —
                the 7pp-bar copy makes no sense when there is nothing to grade. */}
            {!pickOfTheDay && totalGames > 0 && <QuietDayCard best={quietBest} trapCount={tierCounts.traps} />}

            {/* Golf tournament leaderboard */}
            {data.golf && <GolfLeaderboard golf={data.golf} />}

            {/* Sport sections — all start collapsed, show 3 game preview */}
            {sportSections.length === 0 ? (
              <div className="bg-ink-900 rounded-sharp shadow-hairline p-6 md:p-8">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400 mb-3">
                  Slate status
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-ink-100 leading-tight">The slate is dark.</h2>
                <p className="text-sm text-ink-300 mt-2 leading-relaxed max-w-2xl">
                  Every game on the board has started or settled, and the books haven't
                  posted the next slate yet. Nothing is broken — there's just nothing
                  to grade until new games go up.
                </p>
                {data.firstGameTime && (
                  <p className="mt-4 font-mono text-sm text-signal-pos">
                    Next slate: {new Date(data.firstGameTime).toLocaleString('en-US', { timeZone: 'America/Denver', weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} MT
                  </p>
                )}
                {Object.entries(data.upcomingCounts || {}).filter(([, n]) => n > 0).length > 0 && (
                  <p className="mt-1 font-mono text-xs text-ink-400">
                    On deck: {Object.entries(data.upcomingCounts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s, n]) => `${s} ${n}`).join(' · ')}
                  </p>
                )}
                <YesterdayBoard />
                <p className="text-xs text-ink-500 mt-4">
                  Meanwhile, every settled pick is on <button onClick={() => { window.location.hash = '#/ledger' }} className="text-signal-pos hover:underline">The House Ledger</button>.
                </p>
              </div>
            ) : (
              sportSections.map(([sport, games], i) => (
                <SportSection
                  key={sport}
                  sport={sport}
                  games={games}
                  injuries={data.injuries}
                  isDefaultExpanded={i === 0}
                  onDeepResearch={handleOpenDeepResearch}
                  upcomingCount={data.upcomingCounts?.[sport] || 0}
                />
              ))
            )}

            {/* Bottom CTA — primary action (Chat) gets the amber fill; secondary (Generator) stays ghost so the eye lands on the primary */}
            <div className="bg-ink-900 rounded-sharp shadow-hairline p-6 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => { window.location.hash = '#/chat' }}
                className="w-full sm:w-auto px-6 py-3 bg-signal-pos hover:bg-signal-pos/90 rounded-sharp font-mono font-bold uppercase tracking-[0.12em] text-sm text-ink-950 transition-all active:scale-[0.98]"
              >
                Chat with De-Genny
              </button>
              <button
                onClick={onBack}
                className="w-full sm:w-auto px-6 py-3 bg-ink-850 shadow-hairline hover:bg-ink-800 hover:shadow-hairline-bright rounded-sharp font-mono font-medium uppercase tracking-[0.12em] text-sm text-ink-200 transition-all active:scale-[0.98]"
              >
                The Board — filter every pick
              </button>
            </div>
          </>
        )}
      </div>

      {/* Deep Research Modal */}
      {deepResearchTarget && (
        <DeepResearchModal
          gameKey={deepResearchTarget.gameKey}
          game={deepResearchTarget.game}
          onClose={handleCloseDeepResearch}
        />
      )}

      {/* Edge legend modal — teach-once explainer for pp + tier ladder. */}
      <EdgeLegendModal open={legendOpen} onClose={() => setLegendOpen(false)} />

      {/* Sticky locked-picks bar — visible whenever the user has staged ≥ 1 pick.
          Pinned to viewport bottom; the parent container reserves pb-32 to avoid overlap. */}
    </div>
  )
}

// ─── EdgeLegendModal ─────────────────────────────────────────────────────────
// Teach-once explainer triggered from the hero's "ⓘ How edges work" button.
// Defines pp and shows the full tier ladder so users don't have to infer the
// system from individual tiles. Dismissible via X / click-outside / Escape.

function EdgeLegendModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handler)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', handler)
    }
  }, [open, onClose])

  if (!open) return null

  const tiers = [
    { range: '≥ 10pp', label: 'Sharp Take',  sub: 'sharp take',  cls: 'text-signal-pos font-semibold' },
    { range: '7–10pp', label: 'Strong Play', sub: 'hammer it',   cls: 'text-signal-pos font-semibold' },
    { range: '4–7pp',  label: 'Play',        sub: 'play it',     cls: 'text-signal-pos' },
    { range: '2–4pp',  label: 'Lean',        sub: 'lean it',     cls: 'text-signal-pos/70' },
    { range: '0–2pp',  label: 'Skip',        sub: 'pass on it',  cls: 'text-ink-300' },
    { range: '< 0pp',  label: 'Trap',        sub: 'fade it',     cls: 'text-signal-neg font-semibold' },
  ]

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-ink-950/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-ink-900 shadow-hairline rounded-sharp max-w-lg w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink-700">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-ink-100">
            How edges work
          </h2>
          <button
            onClick={onClose}
            className="font-mono text-ink-400 hover:text-ink-100 transition-colors px-2"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <div className="font-mono text-[10px] text-signal-pos uppercase tracking-[0.18em] mb-1.5">
              pp = percentage points
            </div>
            <p className="text-ink-200 text-sm leading-relaxed">
              The signed gap between what our model thinks each side wins, and what the book is implying with its odds. Bigger gap = more disagreement with the book = the headline edge on the tile.
            </p>
            <p className="text-ink-300 text-xs leading-relaxed mt-2 font-mono">
              Example: <span className="tabular-nums text-signal-pos">+6.2pp</span> on a Strong Play means the model thinks that side wins 6.2 percentage points more often than the −110 line implies.
            </p>
          </div>

          <div>
            <div className="font-mono text-[10px] text-signal-pos uppercase tracking-[0.18em] mb-2">
              Tier ladder
            </div>
            <div className="font-mono text-xs space-y-1.5 tabular-nums">
              {tiers.map(t => (
                <div key={t.label} className="grid grid-cols-[68px_1fr_110px] gap-3 items-baseline">
                  <span className={t.cls}>{t.range}</span>
                  <span className={t.cls}>{t.label}</span>
                  <span className="text-ink-400 italic lowercase">{t.sub}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-ink-700">
            <p className="text-ink-300 text-xs leading-relaxed font-mono">
              Math picks the side. De-Genny narrates. We publish negative edges too — that's why <span className="text-signal-neg">Trap</span> exists.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

