import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { edgeTier, formatPp, edgePpForSide, lockOddsFor, breakEvenPct, SHADOW_SPORTS } from '../lib/tiers'

import { API_BASE_URL as API_BASE } from '../config'
import YesterdayBoard from '../components/YesterdayBoard'
import HouseParlays from '../components/HouseParlays'
import BrandMark, { SignOutButton } from '../components/BrandMark'

// Shadow sports: the board shows the model's read, but nothing publishes
// until go-live, so no tile may wear bet-tier language. The set lives in
// lib/tiers.js so every surface (digest chips, hero counts, The Board's
// pick list) reads the same law.
const SHADOW_DISPLAY = SHADOW_SPORTS

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

import { fmtGameDateTime, fmtGameDay, fmtFullDate as formatFullDate } from '../lib/gameTime'

function edgeBadgeClass(score) {
  if (score == null) return 'bg-ink-800 text-ink-300'
  if (score >= 8) return 'bg-emerald-900 text-emerald-300 border border-emerald-700'
  if (score >= 6) return 'bg-signal-pos-dim text-signal-pos border border-signal-pos'
  return 'bg-ink-800 text-ink-300 border border-ink-600'
}

// edgeTier / formatPp / edgePpForSide now live in src/lib/tiers.js, one
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
              <div className="text-xs text-ink-400 mt-0.5">{fmtGameDateTime(game.game_date)}</div>
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

        {/* Modal body, scrollable */}
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
              <EdgeChip signedPp={edgePpForSide(analysis.edges, analysis.recommended_side)} odds={lockOddsFor(analysis)} shadow={SHADOW_DISPLAY.has(analysis.sport)} />
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
                    {/* Rows are {market, bookmaker, outcomes:[{name, price, point?}]}, meaning
                        prices live inside outcomes, not flat columns. */}
                    {odds.map((line, i) => {
                      const marketLabel = { h2h: 'Moneyline', spreads: 'Spread', totals: 'Total' }[line.market] || line.market || 'Line'
                      const fmtP = (p) => (p > 0 ? `+${p}` : `${p}`)
                      return (
                        <div key={i} className="flex items-start justify-between gap-3 text-xs">
                          <span className="text-ink-400 flex-shrink-0">{marketLabel} <span className="text-ink-600">· {line.bookmaker}</span></span>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-ink-200 justify-end">
                            {(line.outcomes || []).map((o, j) => (
                              <span key={j} className="whitespace-nowrap">
                                {o.name}{o.point != null ? ` ${o.point > 0 ? '+' : ''}${o.point}` : ''} <span className="font-mono">{fmtP(o.price)}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )
                    })}
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

          {/* Recent form, last 5 games each team */}
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
                      {/* Date-only strings parse as UTC midnight and render as
                          the PREVIOUS day in US zones. Anchor at noon UTC so
                          the calendar date survives (same fix as
                          YesterdayBoard). */}
                      {new Date(String(r.date).includes('T') ? r.date : `${r.date}T12:00:00Z`)
                        .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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

          {/* UFC fighter form: career records, recent fights, layoff, H2H.
              Sourced from ufc_fighters/ufc_fight_results, the team-sport
              sections above are always empty for UFC. */}
          {(() => {
            const ufc = data?.ufc
            if (!ufc) return null
            const fighters = [ufc.home, ufc.away].filter(Boolean)
            const hasAny = fighters.some(f => f.record != null || (f.recentLines || []).length > 0)
            if (!hasAny) return null
            return (
              <div className="bg-ink-900 rounded-sharp p-4 border border-ink-700">
                <div className="text-xs text-ink-400 uppercase tracking-wider font-semibold mb-3">Fighter Form</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {fighters.map(f => (
                    <div key={f.key}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-ink-200 font-medium truncate">{f.name}</span>
                        {f.record && (
                          <span className="flex-shrink-0 text-[10px] font-mono bg-ink-800 text-ink-200 rounded px-1.5 py-0.5 tabular-nums">{f.record}</span>
                        )}
                      </div>
                      {f.layoffDays != null && (
                        <div className={`text-[11px] font-mono tabular-nums mb-1.5 ${f.layoffDays >= 365 ? 'text-orange-400' : 'text-ink-400'}`}>
                          last fought {f.layoffDays} days ago{f.layoffDays >= 365 ? ' · long layoff' : ''}
                        </div>
                      )}
                      {(f.recentLines || []).length > 0 ? (
                        <div className="space-y-1">
                          {f.recentLines.map((line, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <span className={`px-1.5 py-0.5 rounded font-bold flex-shrink-0 ${
                                line.startsWith('W') ? 'bg-green-900 text-green-300' : 'bg-signal-neg-dim text-signal-neg'
                              }`}>
                                {line.startsWith('W') ? 'W' : 'L'}
                              </span>
                              <span className="text-ink-300 leading-snug">{line.replace(/^[WL] /, '')}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-ink-500 italic">No stored recent fights.</p>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-ink-700 text-xs text-ink-300">
                  {(ufc.h2h || []).length > 0 ? (
                    <span>Head-to-head: <span className="text-ink-100 font-medium">{ufc.h2h[0].winner_name}</span> won the most recent meeting.</span>
                  ) : (
                    <span className="text-ink-400">Head-to-head: no prior meeting in stored results.</span>
                  )}
                </div>
              </div>
            )
          })()}

          {/* Tennis player form: rank, 30-day record, workload, recent
              matches, H2H. Sourced from tennis_rankings/tennis_match_results,
              the team-sport sections above are always empty for tennis. */}
          {(() => {
            const tennis = data?.tennis
            if (!tennis) return null
            const players = [tennis.home, tennis.away].filter(Boolean)
            const hasAny = players.some(p => p.rank != null || (p.recentLines || []).length > 0)
            if (!hasAny) return null

            const renderPlayer = (p) => (
              <div key={p.key}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-ink-200 font-medium truncate">{p.name}</span>
                  {p.rank != null && (
                    <span className="flex-shrink-0 text-[10px] font-mono bg-ink-800 text-ink-200 rounded px-1.5 py-0.5 tabular-nums">
                      {(p.tour || '').toUpperCase()} #{p.rank}
                    </span>
                  )}
                </div>
                {(p.record30d || p.matchesLast14 > 0) && (
                  <div className="text-[11px] text-ink-400 font-mono tabular-nums mb-1.5">
                    {p.record30d && <span>Last 30d: {p.record30d}</span>}
                    {p.record30d && p.matchesLast14 > 0 && <span className="text-ink-600"> · </span>}
                    {p.matchesLast14 > 0 && (
                      <span className={p.matchesLast14 >= 5 ? 'text-orange-400' : ''}>
                        {p.matchesLast14} match{p.matchesLast14 !== 1 ? 'es' : ''} in 14d{p.matchesLast14 >= 5 ? ' · heavy load' : ''}
                      </span>
                    )}
                  </div>
                )}
                {(p.recentLines || []).length > 0 ? (
                  <div className="space-y-1">
                    {p.recentLines.map((line, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className={`px-1.5 py-0.5 rounded font-bold flex-shrink-0 ${
                          line.startsWith('W') ? 'bg-green-900 text-green-300' : 'bg-signal-neg-dim text-signal-neg'
                        }`}>
                          {line.startsWith('W') ? 'W' : 'L'}
                        </span>
                        <span className="text-ink-300 leading-snug">{line.replace(/^[WL] /, '')}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-ink-500 italic">No recent results stored.</p>
                )}
              </div>
            )

            const h2h = tennis.h2h || []
            const homeWins = h2h.filter(m => m.winner_key === tennis.home?.key).length
            const awayWins = h2h.length - homeWins
            const leader = homeWins >= awayWins ? tennis.home : tennis.away
            const h2hRecord = homeWins >= awayWins ? `${homeWins}-${awayWins}` : `${awayWins}-${homeWins}`

            return (
              <div className="bg-ink-900 rounded-sharp p-4 border border-ink-700">
                <div className="text-xs text-ink-400 uppercase tracking-wider font-semibold mb-3">Player Form</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {players.map(renderPlayer)}
                </div>
                <div className="mt-3 pt-3 border-t border-ink-700 text-xs text-ink-300">
                  {h2h.length > 0 ? (
                    <span>Head-to-head: <span className="text-ink-100 font-medium">{leader?.name}</span> leads {h2hRecord}
                      {h2h[0]?.score && <span className="text-ink-400"> · last meeting {h2h[0].winner_name} won {h2h[0].score}</span>}
                    </span>
                  ) : (
                    <span className="text-ink-400">Head-to-head: no prior meeting in stored results.</span>
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

function EdgeChip({ signedPp, odds = null, leg = false, size = 'md', shadow = false }) {
  let tier = edgeTier(signedPp, odds)
  // A 65%+ side below the 2pp floor is a Leg, not a Skip. The tile body
  // already said so, but the corner chip contradicted it (2026-08-12:
  // "can't find any leg labels").
  if (leg && tier?.label === 'Skip') {
    tier = { label: 'Leg', subtitle: 'parlay material', color: 'text-ink-200', bg: 'bg-ink-850 shadow-hairline' }
  }
  // A shadow sport's read never wears bet-tier language: a preseason
  // "Sharp Take" chip on a game that will never publish contradicts the
  // hero and misleads the reader about what is bettable.
  if (shadow) {
    tier = { label: 'Shadow', subtitle: 'publishes at go-live', color: 'text-ink-300', bg: 'bg-ink-850 shadow-hairline' }
  }
  const pp = formatPp(signedPp)
  const isNeg = signedPp != null && signedPp < 0
  const isPos = signedPp != null && signedPp > 0
  const arrow = isPos ? '▲' : isNeg ? '▼' : '·'
  const padding = size === 'sm' ? 'px-2 py-1' : 'px-2.5 py-1.5'
  const ppSize = size === 'sm' ? 'text-[11px]' : 'text-sm'
  const ppTooltip = pp == null
    ? 'No model edge available for this side'
    : shadow
      ? `${pp} · Shadow read. This sport is in shadow mode: the model's edge shows for transparency, but nothing publishes or grades until go-live`
      : `${pp} · ${tier.label}. The gap between the model's win-probability and the book's implied probability, in percentage points`
  return (
    <div
      className={`rounded-sharp ${tier.bg} ${padding} flex flex-col items-end leading-tight flex-shrink-0`}
      title={ppTooltip}
    >
      <div className={`font-mono font-semibold ${ppSize} ${tier.color} tabular-nums tracking-tight`}>
        <span className="mr-0.5">{arrow}</span>{pp ?? '-'}
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
              {s.calMuted ? (
                // The model graded this side, but weekly calibration measured
                // this market's edge at zero predictive value for this sport,
                // so it carries no weight. A flat +0.0pp read as a bug
                // (Vince, 2026-08-06); the word reads as intent.
                <span
                  className="flex-shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-500 italic"
                  title="Edge computed, but this market currently carries zero calibration weight for this sport. It re-earns its vote through the weekly review. See How edges work."
                >
                  muted
                </span>
              ) : (
                <span
                  className={`flex-shrink-0 font-mono text-[11px] tabular-nums ${muted ? 'text-ink-500' : tier.color}`}
                  title={s.signedPp != null ? `${formatPp(s.signedPp)} · ${tier.label}` : 'No model edge for this side'}
                >
                  {hasAnyEdge ? (formatPp(s.signedPp) ?? '-') : '-'}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MarketTabs({ game }) {
  const { edges, edges_raw: edgesRaw, recommended_side } = game
  // Calibration-muted: the raw model computed a real edge but the
  // calibrated value is exactly zero, meaning the market's multiplier is
  // zeroed for this sport (for example MLB spreads and totals, Aug 2026).
  const calMutedFor = (side) => {
    const cal = edgePpForSide(edges, side)
    const raw = edgePpForSide(edgesRaw, side)
    return cal === 0 && raw != null && raw !== 0
  }
  const sideEntry = (side) => ({
    side,
    text: sidePickText(game, side),
    signedPp: edgePpForSide(edges, side),
    calMuted: calMutedFor(side),
  })
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
    ml: [sideEntry('home_ml'), sideEntry('away_ml')],
    spread: [sideEntry('home_spread'), sideEntry('away_spread')],
    total: [sideEntry('over'), sideEntry('under')],
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

// Tiers revise all day as prices and data move, promotions included
// (owner call 2026-08-22: a bet climbing to Sharp Take is a feature).
// What must never happen again is the 2026-08-21 silent swap, where the
// Rays left Sharp Take at 12:45 and the Padres entered at 15:45 with no
// trace for a morning reader. When a published pick's tier has changed,
// the card says so.
function TierPathNote({ published }) {
  const hist = published?.tier_history
  if (!Array.isArray(hist) || hist.length < 2) return null
  const prev = hist[hist.length - 2]
  const curr = hist[hist.length - 1]
  if (!prev?.tier || !curr?.tier || !curr.at) return null
  const order = ['Lean', 'Play', 'Strong Play', 'Sharp Take']
  const up = order.indexOf(curr.tier) > order.indexOf(prev.tier)
  const when = new Date(curr.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return (
    <div className={`font-mono text-[10px] mt-0.5 ${up ? 'text-signal-pos' : 'text-ink-400'}`}>
      {up ? 'Promoted' : 'Demoted'} from {prev.tier} at {when}
    </div>
  )
}

function GameCard({ game, gameKey, sport, onDeepResearch }) {
  const [expanded, setExpanded] = useState(false)

  // Signed edge in pp for the recommended side. When the math returned a real
  // pick, this reflects that bet's edge. When it didn't (no-edge game), we
  // fall back to null so the chip renders "-".
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
              <div className="font-mono text-[11px] text-ink-500 mt-0.5 tabular-nums">{fmtGameDateTime(game.game_date)}</div>
            )}
          </div>
          <EdgeChip
            signedPp={signedPp}
            odds={lockOddsFor(game)}
            shadow={SHADOW_DISPLAY.has(sport)}
            leg={signedPp != null && signedPp < 2 && signedPp > -2
              && Math.max(game.calc_home_prob ?? 0, game.calc_away_prob ?? 0) >= 0.65}
          />
        </div>

        {/* Recommended read. A trap read (negative edge) must never render
            in pick-green: the text names the side NOT to bet. The 0-2pp
            band is a Skip, not a pick, and when the model makes one side
            70%+ to win it is labeled a Leg: high hit rate, thin payout,
            parlay material only. */}
        {(() => {
          const legProb = Math.max(game.calc_home_prob ?? 0, game.calc_away_prob ?? 0)
          const isLegGame = signedPp != null && signedPp < 2 && signedPp > -2 && legProb >= 0.65
          if (game.recommended_pick && signedPp != null && signedPp <= -2) return (
            <div className="bg-signal-neg-dim/30 rounded-sharp shadow-hairline px-3 py-2 mb-3 border border-signal-neg/40">
              <div className="font-mono text-[9px] text-signal-neg uppercase tracking-[0.14em] mb-0.5">Trap · fade this side</div>
              <div className="text-signal-neg font-mono font-medium text-sm tabular-nums">{game.recommended_pick}</div>
            </div>
          )
          if (game.recommended_pick && signedPp != null && signedPp >= 2) return (
            <div className="bg-ink-850 rounded-sharp shadow-hairline px-3 py-2 mb-3">
              <div className="font-mono text-[9px] text-ink-400 uppercase tracking-[0.14em] mb-0.5">Model Pick</div>
              <div className="text-signal-pos font-mono font-medium text-sm tabular-nums">{game.recommended_pick}</div>
              {(() => {
                {/* Break-even = risk / (risk + win). Teaches the price: a
                    -180 pick must win 64.3% just to tread water, +122 only
                    45%. The number that explains why chalk is fenced. */}
                const be = breakEvenPct(lockOddsFor(game))
                return be != null ? (
                  <div className="font-mono text-[10px] text-ink-400 mt-0.5 tabular-nums">
                    break-even {be.toFixed(1)}% at this price
                  </div>
                ) : null
              })()}
              <TierPathNote published={game.published_pick} />
            </div>
          )
          if (game.recommended_pick && isLegGame) {
            // The leg is the HIGH-PROBABILITY side, which is not always the
            // recommended-pick side (2026-08-15: a UFC tile said "83% to
            // hit" above Barboza ML +500, the 83% belonged to Ribovics).
            // Name the side the probability belongs to, never the other one.
            const legIsHome = (game.calc_home_prob ?? 0) >= (game.calc_away_prob ?? 0)
            const legTeam = legIsHome ? game.home_team : game.away_team
            const legMl = legIsHome ? game.moneyline_home : game.moneyline_away
            const legText = legTeam
              ? `${legTeam} ML${legMl != null ? ` ${legMl > 0 ? '+' : ''}${legMl}` : ''}`
              : game.recommended_pick
            return (
              <div className="bg-ink-850/60 rounded-sharp shadow-hairline px-3 py-2 mb-3 border border-ink-500">
                <div className="font-mono text-[9px] text-ink-300 uppercase tracking-[0.14em] mb-0.5">Leg · {Math.round(legProb * 100)}% to hit, thin payout</div>
                <div className="text-ink-200 font-mono font-medium text-sm tabular-nums">{legText}</div>
              </div>
            )
          }
          if (game.recommended_pick) return (
            <div className="bg-ink-850/40 rounded-sharp px-3 py-2 mb-3 border border-dashed border-ink-600">
              <div className="font-mono text-[9px] text-ink-400 uppercase tracking-[0.14em] mb-0.5">Skip · best side below the 2pp floor</div>
              <div className="text-ink-300 font-mono font-medium text-sm tabular-nums">{game.recommended_pick}</div>
            </div>
          )
          return (
            <div className="bg-ink-850/40 rounded-sharp px-3 py-2 mb-3 border border-dashed border-ink-600">
              <div className="font-mono text-[11px] text-ink-400">No model edge. Every market &lt; 2pp</div>
            </div>
          )
        })()}

        {/* Spotlight picks from the other markets: a spread or total that
            cleared the publish gate on its own gets its own banner under
            the headline instead of hiding in the market tabs (owner
            approved 2026-08-24). */}
        {Array.isArray(game.published_alts) && game.published_alts.map((alt) => (
          <div key={alt.pick} className="bg-ink-850 rounded-sharp shadow-hairline px-3 py-2 mb-3 border-l-2 border-signal-pos/50">
            <div className="font-mono text-[9px] text-ink-400 uppercase tracking-[0.14em] mb-0.5">
              {alt.bet_type} spotlight{alt.tier ? ` · ${alt.tier}` : ''}
            </div>
            <div className="text-signal-pos font-mono font-medium text-sm tabular-nums">{alt.pick}</div>
            {alt.edge_pp != null && (
              <div className="font-mono text-[10px] text-ink-400 mt-0.5 tabular-nums">{formatPp(Number(alt.edge_pp))} on this market alone</div>
            )}
            <TierPathNote published={alt} />
          </div>
        ))}

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
                {expanded ? '- show less' : '+ read more'}
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

      {/* Action row for Deep Research. The pick itself is information, not a
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

// ─── TrapCard ────────────────────────────────────────────────────────────────
// One tile per detector trap call, independent of the game's pick tile. The
// trap names the side the casual bettor is drawn to (lure signals) that the
// model prices 2pp or more below fair. Fading it is the advice.

function TrapCard({ game, trap, gameKey, onDeepResearch }) {
  const side = trap.side
  const baitText = sidePickText(game, side)
  const edgePp = trap.edge_pp != null ? Number(trap.edge_pp) : edgePpForSide(game.edges, side)
  const signals = Array.isArray(trap.signals) ? trap.signals : []

  return (
    <div className="bg-ink-900 rounded-sharp overflow-hidden flex flex-col border border-signal-neg/40 shadow-hairline">
      <div className="flex items-center justify-between px-3 py-1.5 bg-signal-neg-dim/30 border-b border-signal-neg/30">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-neg font-semibold">🪤 Trap</span>
        <span className="font-mono text-[11px] text-signal-neg tabular-nums font-semibold">{edgePp != null ? `${edgePp.toFixed(1)}pp` : ''}</span>
      </div>
      <div className="p-4 flex-1">
        <div className="font-mono font-medium text-ink-100 text-sm leading-tight tracking-tight mb-0.5">
          {game.away_team} <span className="text-ink-500">@</span> {game.home_team}
        </div>
        {game.game_date && (
          <div className="font-mono text-[11px] text-ink-500 mb-3 tabular-nums">{fmtGameDateTime(game.game_date)}</div>
        )}
        <div className="bg-signal-neg-dim/20 rounded-sharp px-3 py-2 mb-3 border border-signal-neg/30">
          <div className="font-mono text-[9px] text-signal-neg uppercase tracking-[0.14em] mb-0.5">The bait · fade it</div>
          <div className="text-signal-neg font-mono font-medium text-sm tabular-nums">{baitText || side}</div>
        </div>
        {signals.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {signals.map((s, i) => (
              <span key={i} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-ink-850 text-ink-300 shadow-hairline">
                {s.label || s.key}
              </span>
            ))}
          </div>
        )}
      </div>
      {gameKey && (
        <div className="px-4 pb-4 pt-0">
          <button
            onClick={() => onDeepResearch(game, gameKey)}
            className="w-full py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-300 hover:text-ink-100 bg-ink-850 hover:bg-ink-800 rounded-sharp shadow-hairline transition-all active:scale-[0.98]"
          >
            <span className="text-signal-neg">+</span> Research
          </button>
        </div>
      )}
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

function SportSection({ sport, games, injuries, isDefaultExpanded, onDeepResearch, upcomingCount, filter = 'All' }) {
  const [expanded, setExpanded] = useState(isDefaultExpanded)
  // A narrowed board auto-expands: the user asked to SEE that read type,
  // a row of collapsed headers is not an answer.
  useEffect(() => {
    if (filter !== 'All') setExpanded(true)
  }, [filter])
  const meta = getSportMeta(sport)

  // Split games by whether the math returned an actionable pick. "On the
  // bubble" surfaces games where the model considered the matchup but every
  // market sat below the +2pp threshold. Every graded game renders: the
  // work is done and the data exists, so the user gets it all (Vince,
  // 2026-08-02). Traps are detector calls rendered as their OWN tiles,
  // independent of the pick, since one game can carry both.
  const ppFor = (g) => edgePpForSide(g.edges, g.recommended_side)
  // Best edge first, everywhere. Unsorted, the collapsed preview showed
  // the first three games by schedule and the section's headline chip
  // came from whichever game the API returned first (2026-08-12: a Lean
  // fronted a section that held a Sharp Take).
  const allPickGames = games
    .filter(g => g.recommended_pick && (ppFor(g) ?? 0) >= 2)
    .sort((a, b) => (ppFor(b) ?? 0) - (ppFor(a) ?? 0))
  // Tier-narrowed view when a tier chip is active.
  const pickGames = (filter === 'All' || filter === 'Legs' || filter === 'Traps')
    ? allPickGames
    : allPickGames.filter(g => edgeTier(ppFor(g), lockOddsFor(g))?.label === filter)
  const legOf = (g) => {
    const prob = Math.max(g.calc_home_prob ?? 0, g.calc_away_prob ?? 0)
    const pp = ppFor(g)
    return pp != null && pp < 2 && pp > -2 && prob >= 0.65 ? prob : null
  }
  // Legs get their own SECTION now, ranked by hit probability. They used
  // to render only as a count line in the collapsed preview while the
  // tiles drowned unsorted in the bubble pile (owner, 2026-08-18: "I
  // want legs on there, I can't find them anywhere").
  const legGames = games
    .filter(g => g.recommended_pick && legOf(g) != null)
    .sort((a, b) => legOf(b) - legOf(a))
  const bubbleGames = games
    .filter(g => !allPickGames.includes(g) && !legGames.includes(g))
    .sort((a, b) => (ppFor(b) ?? -99) - (ppFor(a) ?? -99))
  const trapEntries = games.flatMap(g =>
    (Array.isArray(g.trap_calls) ? g.trap_calls : []).map(trap => ({ game: g, trap }))
  )

  // What this section contributes under the active filter. An empty
  // section hides entirely instead of rendering a dead header.
  const showPicks = filter === 'All' || !['Legs', 'Traps'].includes(filter)
  const showLegs = filter === 'All' || filter === 'Legs'
  const showTraps = filter === 'All' || filter === 'Traps'
  const showBubble = filter === 'All'
  const visibleCount = (showPicks ? pickGames.length : 0)
    + (showLegs ? legGames.length : 0)
    + (showTraps ? trapEntries.length : 0)
    + (showBubble ? bubbleGames.length : 0)
  if (visibleCount === 0) return null

  // Top 3 actionable picks for the collapsed preview / top tile grid.
  const topGames = pickGames.slice(0, 3)
  const extraGames = pickGames.slice(3)
  const injuryCode = ANALYSIS_SPORT_TO_CODE[sport] || sport
  const injuryEntry = injuries[injuryCode]
  const topSignedPp = pickGames[0] ? ppFor(pickGames[0]) : null
  const topTier = edgeTier(topSignedPp, pickGames[0] ? lockOddsFor(pickGames[0]) : null)

  // Use game_key from the DB directly (returned by /api/digest)
  function getGameKey(game) {
    return game.game_key || null
  }

  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline overflow-hidden">
      {/* Sport header bar, clickable to collapse/expand */}
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
                {games.length} graded
                {SHADOW_DISPLAY.has(sport) && <span className="text-ink-500"> · shadow, publishes at go-live</span>}
                <span className="text-ink-500"> · {pickGames.length} pick{pickGames.length !== 1 ? 's' : ''}</span>
                {trapEntries.length > 0 && <span className="text-signal-neg"> · {trapEntries.length} trap{trapEntries.length !== 1 ? 's' : ''}</span>}
                {bubbleGames.length > 0 && <span className="text-ink-500"> · {bubbleGames.length} on the bubble</span>}
                {upcomingCount > 0 && <span className="text-ink-500"> · {upcomingCount} next 24h</span>}
                {!expanded && topSignedPp != null && (
                  <span className="ml-2 text-ink-500">
                    · Top: {SHADOW_DISPLAY.has(sport)
                      ? <span className="font-semibold text-ink-300">{formatPp(topSignedPp)} shadow read</span>
                      : <span className={`font-semibold ${topTier.color}`}>{formatPp(topSignedPp)} {topTier.label}</span>}
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

      {/* Collapsed preview, top 3 actionable picks as compact rows */}
      {!expanded && topGames.length > 0 && (
        <div
          onClick={() => setExpanded(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(true) } }}
          className="px-6 py-3 space-y-2 cursor-pointer hover:bg-ink-850/50 transition-colors"
        >
          {topGames.map((game, i) => {
            const pp = ppFor(game)
            const rawTier = edgeTier(pp, lockOddsFor(game))
            const tier = SHADOW_DISPLAY.has(sport)
              ? { ...rawTier, bg: 'bg-ink-850 shadow-hairline', color: 'text-ink-300' }
              : rawTier
            return (
              /* Phones: matchup and pick stack on two lines instead of
                 fighting for one row, where both ended up double-truncated
                 ("New York M... Chicago White Sox ...", 2026-08-22 mobile
                 audit). From sm: up the original single row returns. */
              <div key={i} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-y-0.5 gap-x-3 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`px-1.5 py-0.5 rounded-sharp font-mono text-[10px] font-semibold flex-shrink-0 tabular-nums ${tier.bg} ${tier.color}`}>
                    {formatPp(pp) ?? '-'}
                  </span>
                  <span className="text-ink-200 truncate">{game.away_team} @ {game.home_team}</span>
                </div>
                <span className="font-mono text-signal-pos text-xs font-medium flex-shrink-0 truncate sm:max-w-[140px] tabular-nums pl-9 sm:pl-0">
                  {game.recommended_pick || '-'}
                </span>
              </div>
            )
          })}
          {legGames.length > 0 && (
            <div className="flex items-center gap-2 text-xs pt-0.5">
              <span className="px-1.5 py-0.5 rounded-sharp font-mono text-[10px] font-semibold flex-shrink-0 bg-ink-850 shadow-hairline text-ink-200">
                Leg
              </span>
              <span className="text-ink-400 font-mono text-[11px]">
                {legGames.length} parlay {legGames.length === 1 ? 'leg' : 'legs'} · 65%+ to hit, thin payout
              </span>
            </div>
          )}
          {(pickGames.length > 3 || legGames.length > 0) && (
            <p className="font-mono text-[10px] text-ink-500 text-center pt-1 uppercase tracking-[0.14em]">Tap to see all grades</p>
          )}
        </div>
      )}

      {/* Expanded body, full tiles */}
      {expanded && (
        <div className="p-6">
          {showPicks && pickGames.length > 0 ? (
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
          ) : null}
          {/* No-picks banner removed (Vince, 2026-08-06): the graded game
              tiles below already tell the story, the banner was noise. */}

          {/* Parlay legs: the 65%+ hit-probability sides on no-edge games.
              Their record runs hot precisely because they are chalk, so
              they earn their own section instead of drowning in the
              bubble pile. */}
          {showLegs && legGames.length > 0 && (
            <div className={showPicks && pickGames.length > 0 ? 'mt-6' : ''}>
              <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-300 mb-3 font-medium">
                Parlay legs · 65%+ to hit, thin payout
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {legGames.map((game, i) => (
                  <GameCard
                    key={`${game.home_team}-${game.away_team}-leg-${i}`}
                    game={game}
                    gameKey={getGameKey(game)}
                    sport={sport}
                    onDeepResearch={onDeepResearch}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Traps: detector calls rendered as their own highlighted tiles,
              independent of the pick grid. Knowing what NOT to bet is half
              the product, so these never hide behind a collapsed section. */}
          {showTraps && trapEntries.length > 0 && (
            <div className="mt-6">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-neg mb-3 font-medium">
                Traps · the bait the public wants
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {trapEntries.map(({ game, trap }, i) => (
                  <TrapCard
                    key={`${game.home_team}-${game.away_team}-trap-${i}`}
                    game={game}
                    trap={trap}
                    gameKey={getGameKey(game)}
                    onDeepResearch={onDeepResearch}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Every other graded game, open by default: the research exists
              for all of them, so all of them show. */}
          {showBubble && bubbleGames.length > 0 && (
            <details className="mt-6 group" open>
              <summary className="cursor-pointer list-none flex items-center gap-2 select-none">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400 font-medium">
                  On the bubble
                </span>
                <span className="font-mono text-[10px] text-ink-500 tabular-nums">{bubbleGames.length} more graded game{bubbleGames.length !== 1 ? 's' : ''} · below the 2pp pick floor</span>
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

// ─── GolfLeaderboard ─────────────────────────────────────────────────────────

function fmtGolfPrice(price) {
  if (price == null) return '-'
  const n = Number(price)
  return n > 0 ? `+${n}` : String(n)
}

function OnDeckRail({ onDeck }) {
  const [open, setOpen] = useState(false)
  const sports = Object.entries(onDeck || {}).filter(([, games]) => games.length > 0)
  if (sports.length === 0) return null
  const total = sports.reduce((s, [, g]) => s + g.length, 0)
  const fmtMl = (v) => v == null ? '-' : v > 0 ? `+${v}` : String(v)
  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-ink-850 transition-colors text-left"
      >
        <span className="text-sm font-semibold text-ink-100">On deck</span>
        <span className="text-xs text-ink-400 truncate">
          {total} games with live lines · {sports.map(([s, g]) => `${s} ${g.length}`).join(' · ')}
        </span>
        <span className="ml-auto text-ink-500 text-xs flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-ink-800 max-h-[420px] overflow-y-auto">
          {sports.map(([sport, games]) => (
            <div key={sport}>
              <div className="px-4 py-1.5 bg-ink-950 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-500">{sport}</div>
              {games.map((g, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2 border-t border-ink-800/50">
                  <span className="text-sm text-ink-100 truncate flex-1">{g.away_team} @ {g.home_team}</span>
                  <span className="font-mono text-xs text-ink-400 tabular-nums flex-shrink-0">{fmtMl(g.ml_away)} / {fmtMl(g.ml_home)}</span>
                  <span className="font-mono text-[10px] text-ink-500 flex-shrink-0 w-24 text-right">{fmtGameDay(g.commence_time)}</span>
                </div>
              ))}
            </div>
          ))}
          <p className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-600 border-t border-ink-800/50">
            lines live now · full analysis begins 3 days before each game
          </p>
        </div>
      )}
    </div>
  )
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
              <span className="w-14 text-right font-mono text-xs text-ink-400 tabular-nums">{p.consensus_prob != null ? `${(p.consensus_prob * 100).toFixed(1)}%` : '-'}</span>
              <span className={`w-16 text-right font-mono text-xs tabular-nums ${p.value_pp > 0 ? 'text-signal-pos' : p.value_pp < 0 ? 'text-signal-neg' : 'text-ink-500'}`}>
                {p.value_pp != null ? `${p.value_pp > 0 ? '+' : ''}${p.value_pp.toFixed(1)}pp` : ''}
              </span>
            </button>
            {openNote === i && p.note && (
              <p className="px-2 pb-2 pt-1 text-xs text-ink-300 leading-relaxed">{p.note}</p>
            )}
            {openNote === i && !p.note && (
              <p className="px-2 pb-2 pt-1 text-xs text-ink-500">No research note for this player yet, deeper in the field than the analysis covers.</p>
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
  const [open, setOpen] = useState(false)
  const [showFullBoard, setShowFullBoard] = useState(false)
  if (!golf) return null

  const full = golf.leaderboard || []
  const shown = showFullBoard ? full : full.slice(0, 5)
  const fields = golf.fields || []
  const fieldSummary = fields.map(f => f.name).join(' · ')

  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-ink-850 transition-colors text-left"
      >
        <span className="text-lg">⛳</span>
        {/* Baseline flex so truncate actually clips: an inline span never
            truncates, and this line was 598px wide on phones, one of the
            elements that forced the page into horizontal overflow. */}
        <div className="min-w-0 flex-1 flex items-baseline gap-2">
          <span className="text-sm font-semibold text-ink-100 flex-shrink-0">Golf</span>
          <span className="text-xs text-ink-400 truncate min-w-0">
            {golf.tournament} · {golf.status}{fieldSummary ? ` · odds boards: ${fieldSummary}` : ''}
          </span>
        </div>
        <span className="text-ink-500 text-xs flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-ink-800">
          {/* Live leaderboard */}
          {full.length > 0 && (
            <div className="space-y-1 mt-3">
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
                  onClick={() => setShowFullBoard(!showFullBoard)}
                  className="w-full mt-1 text-center text-xs font-mono text-signal-pos/80 hover:text-signal-pos"
                >
                  {showFullBoard ? 'Show less' : `Show all ${full.length} players`}
                </button>
              )}
            </div>
          )}

          {/* Researched field boards, one per tournament with live outright odds */}
          {fields.map(f => <GolfFieldBoard key={f.key} field={f} />)}
        </div>
      )}
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

  // Sections rank by their STRONGEST pick, not by volume. Count ordering
  // put a 56-match tennis wall above the day's only Sharp Take (owner,
  // 2026-08-18: "board sort is still buggy"). Volume breaks ties.
  const bestPickPp = (games) => games.reduce((best, g) => {
    if (!g.recommended_pick) return best
    const pp = edgePpForSide(g.edges, g.recommended_side)
    return pp != null && pp > best ? pp : best
  }, -Infinity)
  const sportSections = data
    ? Object.entries(data.gamesBySport)
        .filter(([, games]) => games.length > 0)
        .sort((a, b) => (bestPickPp(b[1]) - bestPickPp(a[1])) || (b[1].length - a[1].length))
    : []

  const totalGames = sportSections.reduce((sum, [, games]) => sum + games.length, 0)
  const totalSports = sportSections.length

  // Board filter: one chip row narrows every section to a single read
  // type. Legs got their own chip because they were invisible on the
  // board despite hitting 78 percent (owner, 2026-08-18).
  const BOARD_FILTERS = ['All', 'Sharp Take', 'Strong Play', 'Play', 'Lean', 'Legs', 'Traps']
  const [boardFilter, setBoardFilter] = useState('All')

  // Count tiles by tier so we can render a count-first hero ("12 Sharp Takes today").
  // Cheaper than rendering every tile twice, derived once per data refresh.
  const tierCounts = useMemo(() => {
    const c = { sharpTakes: 0, strongPlays: 0, plays: 0, leans: 0, legs: 0, traps: 0 }
    if (!data?.gamesBySport) return c
    // Shadow sports stay OUT of the hero counts: on 2026-08-26 five NFL
    // preseason shadow tiles headlined as "5 Sharp Takes" while the
    // actual published board was seven MLB Leans nobody could find.
    for (const [sportKey, games] of Object.entries(data.gamesBySport)) {
      if (SHADOW_DISPLAY.has(sportKey)) continue
      for (const g of games) {
        // Traps are detector calls (lure + negative edge), not any tile
        // whose recommended side happens to be negative.
        c.traps += Array.isArray(g.trap_calls) ? g.trap_calls.length : 0
        // Alt spotlight rows are real published bet signals with their own
        // tier, and the cards render them as such, so the hero counts them
        // too. One game can legally contribute two signals (owner report
        // 2026-08-31: the Yankees ML and spread were both Sharps while the
        // hero, counting games, said 2).
        for (const alt of (Array.isArray(g.published_alts) ? g.published_alts : [])) {
          if (alt?.tier === 'Sharp Take') c.sharpTakes++
          else if (alt?.tier === 'Strong Play') c.strongPlays++
          else if (alt?.tier === 'Play') c.plays++
          else if (alt?.tier === 'Lean') c.leans++
        }
        const pp = edgePpForSide(g.edges, g.recommended_side)
        if (pp == null) continue
        // Four actionable tiers since the 2026-08-16 Strong Play restore:
        // Sharp Take 10+, Strong Play 7-10, Play 4-7, Lean 2-4. The count
        // applies the same chalk fence as the tier chips. Legs mirror the
        // SportSection legOf rule: no-edge games with a 65%+ side.
        const label = edgeTier(pp, lockOddsFor(g))?.label
        if (label === 'Sharp Take') c.sharpTakes++
        else if (label === 'Strong Play') c.strongPlays++
        else if (label === 'Play') c.plays++
        else if (label === 'Lean') c.leans++
        else if (g.recommended_pick && pp < 2 && pp > -2
          && Math.max(g.calc_home_prob ?? 0, g.calc_away_prob ?? 0) >= 0.65) c.legs++
      }
    }
    return c
  }, [data])

  // Pick of the Day left the digest on 2026-08-06 (Vince): the free
  // landing tile owns the single-pick tease, the digest IS the full
  // board. Removing it also killed a class of digest-vs-landing
  // disagreements about which pick headlines.

  // Hero trust anchor reads Sharp Take, the ticket, and is CLICKABLE:
  // tapping cycles 3d, 7d, 30d, all-time so a heater is visible at a
  // glance. Every number comes from mv_public_record via /api/digest, the
  // SAME rollup the ledger shows, so the page can never disagree with
  // itself. Falls back to the overall record only if tier data is absent.
  const HERO_PERIODS = [['last_3d', '3d'], ['last_7d', '7d'], ['last_30d', '30d'], ['all', 'all-time']]
  const [heroPeriodIdx, setHeroPeriodIdx] = useState(2) // default 30d
  const heroHitRate = (() => {
    const [period, label] = HERO_PERIODS[heroPeriodIdx]
    const st = data?.modelAccuracy?.[period]?.byTier?.['Sharp Take']
    const o = data?.modelAccuracy?.[period]?.overall
    // Both populations, fixed, side by side. The old design swapped a
    // single slot between Sharp Take and Model depending on the window's
    // ST sample, so cycling 3d to 7d could show a 30-pick record next to
    // an 8-pick record under the same tile and read as corrupt counts
    // (owner report 2026-08-18: "the 3 day record has 3x the count of
    // the 7 day"). Populations never swap now, each series is monotone
    // across windows on its own.
    return {
      label,
      st: st?.winRate != null ? { rate: st.winRate, won: st.won, lost: st.lost } : null,
      overall: o?.winRate != null ? { rate: o.winRate, won: o.won, lost: o.lost } : null,
    }
  })()

  const handleOpenDeepResearch = useCallback((game, gameKey) => {
    setDeepResearchTarget({ game, gameKey })
  }, [])

  const handleCloseDeepResearch = useCallback(() => {
    setDeepResearchTarget(null)
  }, [])

  return (
    <div className="min-h-screen bg-ink-950 text-white font-sans">
      {/* Top nav bar. The digest is the authenticated home, so there is no
          "Back". Other surfaces are forward navigation. */}
      <div className="sticky top-0 z-30 bg-ink-950/95 border-b border-ink-800 backdrop-blur px-4 py-3 flex items-center gap-3">
        <BrandMark />
        <span className="text-sm font-semibold text-ink-200 hidden sm:inline">Daily Digest</span>
        {/* px-2 below 640px: at px-3 the four nav controls need ~590px and
            push the page into horizontal overflow on phones (2026-08-22
            mobile audit: the whole digest rendered 591px wide on a 390px
            screen, the "congested" report). Same fix for the Refresh label:
            icon only on phones. */}
        <button
          onClick={() => { window.location.hash = '#/ledger' }}
          className="ml-auto px-2 sm:px-3 py-1.5 text-xs font-semibold bg-ink-900 hover:bg-ink-800 text-ink-200 rounded-sharp border border-ink-700 transition-colors active:scale-95"
        >
          Ledger
        </button>
        <button
          onClick={onBack}
          className="px-2 sm:px-3 py-1.5 text-xs font-semibold bg-ink-900 hover:bg-ink-800 text-ink-200 rounded-sharp border border-ink-700 transition-colors active:scale-95"
        >
          The Board
        </button>
        <button
          onClick={fetchDigest}
          className="px-2 sm:px-3 py-1.5 text-xs font-semibold bg-ink-900 hover:bg-ink-800 text-ink-200 rounded-sharp border border-ink-700 transition-colors active:scale-95"
          aria-label="Refresh"
        >
          {loading ? '...' : <><span aria-hidden="true">↻</span><span className="hidden sm:inline"> Refresh</span></>}
        </button>
        <SignOutButton />
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Hero header */}
        <div className="bg-ink-900 rounded-sharp shadow-hairline p-6 md:p-8">
          {/* Top meta row: today's date + 30d model hit-rate (trust anchor) + edge legend trigger */}
          {/* flex-wrap + no flex-shrink-0: this row (records, period pills,
              legend trigger) is ~540px wide and was the main driver of the
              phone horizontal overflow. On small screens it wraps under the
              date instead of widening the page. */}
          <div className="flex flex-wrap items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400 mb-3 gap-x-3 gap-y-1.5">
            <span className="truncate">{data ? formatFullDate(null) : 'Loading...'}</span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 min-w-0">
              {heroHitRate && (
                <span
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0"
                  title="Sharp Take record and the all-tiers Model record for the selected window. Same numbers as The House Ledger."
                >
                  <span>
                    {'Sharp '}
                    {heroHitRate.st ? (
                      <>
                        <span className="tabular-nums text-ink-300">{heroHitRate.st.won}-{heroHitRate.st.lost}</span>
                        {' '}<span className={`tabular-nums ${winRateColor(heroHitRate.st.rate)}`}>{heroHitRate.st.rate}%</span>
                      </>
                    ) : (
                      <span className="text-ink-500">none</span>
                    )}
                    <span className="text-ink-600">{' · '}</span>
                    {'All '}
                    {heroHitRate.overall ? (
                      <>
                        <span className="tabular-nums text-ink-300">{heroHitRate.overall.won}-{heroHitRate.overall.lost}</span>
                        {' '}<span className={`tabular-nums ${winRateColor(heroHitRate.overall.rate)}`}>{heroHitRate.overall.rate}%</span>
                      </>
                    ) : (
                      <span className="text-ink-500">none</span>
                    )}
                  </span>
                  {/* Period bubbles: each window is its own visible pill so
                      switching is obvious and a heater is one tap away. */}
                  <span className="flex items-center gap-1">
                    {HERO_PERIODS.map(([period, label], i) => (
                      <button
                        key={period}
                        onClick={() => setHeroPeriodIdx(i)}
                        className={`px-1.5 py-0.5 rounded-full font-mono text-[9px] uppercase tracking-[0.08em] transition-colors ${
                          i === heroPeriodIdx
                            ? 'bg-signal-pos-dim/60 text-signal-pos font-semibold'
                            : 'bg-ink-850 text-ink-400 hover:text-ink-200'
                        }`}
                      >
                        {label === 'all-time' ? 'all' : label}
                      </button>
                    ))}
                  </span>
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
            {/* Count-first headline, math-derived, instantly tells you what's actionable today */}
              {data ? (
                tierCounts.sharpTakes > 0 ? (
                  <h1 className="font-mono text-3xl md:text-4xl font-bold tracking-tight tabular-nums text-ink-100 leading-tight">
                    <span className="text-signal-pos">{tierCounts.sharpTakes}</span> Sharp Take{tierCounts.sharpTakes !== 1 ? 's' : ''}
                  </h1>
                ) : tierCounts.strongPlays > 0 ? (
                  <h1 className="font-mono text-3xl md:text-4xl font-bold tracking-tight tabular-nums text-ink-100 leading-tight">
                    <span className="text-signal-pos">{tierCounts.strongPlays}</span> Strong Play{tierCounts.strongPlays !== 1 ? 's' : ''}
                  </h1>
                ) : tierCounts.plays > 0 ? (
                  <h1 className="font-mono text-3xl md:text-4xl font-bold tracking-tight tabular-nums text-ink-100 leading-tight">
                    <span className="text-signal-pos">{tierCounts.plays}</span> Play{tierCounts.plays !== 1 ? 's' : ''}
                  </h1>
                ) : (
                  <h1 className="font-mono text-2xl md:text-3xl font-bold tracking-tight text-ink-100 leading-tight">
                    Quiet board. No tiles cleared 4pp today
                  </h1>
                )
              ) : (
                <h1 className="font-mono text-3xl md:text-4xl font-bold text-ink-300">…</h1>
              )}

              {/* Secondary tier counts + traps to fade */}
              {data && (
                <p className="text-sm mt-2 font-mono tabular-nums text-ink-300">
                  {tierCounts.strongPlays > 0 && <span><span className="text-signal-pos">{tierCounts.strongPlays}</span> Strong Play{tierCounts.strongPlays !== 1 ? 's' : ''}</span>}
                  {tierCounts.strongPlays > 0 && tierCounts.plays > 0 && <span className="text-ink-600"> · </span>}
                  {tierCounts.plays > 0 && <span><span className="text-signal-pos">{tierCounts.plays}</span> Play{tierCounts.plays !== 1 ? 's' : ''}</span>}
                  {(tierCounts.strongPlays > 0 || tierCounts.plays > 0) && tierCounts.leans > 0 && <span className="text-ink-600"> · </span>}
                  {tierCounts.leans > 0 && <span><span className="text-signal-pos/70">{tierCounts.leans}</span> Lean{tierCounts.leans !== 1 ? 's' : ''}</span>}
                  {(tierCounts.strongPlays > 0 || tierCounts.plays > 0 || tierCounts.leans > 0) && tierCounts.legs > 0 && <span className="text-ink-600"> · </span>}
                  {tierCounts.legs > 0 && <span><span className="text-ink-200">{tierCounts.legs}</span> Leg{tierCounts.legs !== 1 ? 's' : ''}</span>}
                  {(tierCounts.strongPlays > 0 || tierCounts.plays > 0 || tierCounts.leans > 0 || tierCounts.legs > 0) && tierCounts.traps > 0 && <span className="text-ink-600"> · </span>}
                  {tierCounts.traps > 0 && <span><span className="text-signal-neg">{tierCounts.traps}</span> Trap{tierCounts.traps !== 1 ? 's' : ''} to fade</span>}
                </p>
              )}

              {/* System explainer for first-time users */}
              {data && (
                <p className="text-ink-400 text-xs mt-3 font-mono leading-relaxed">
                  {totalGames} game{totalGames !== 1 ? 's' : ''} graded across {totalSports} sport{totalSports !== 1 ? 's' : ''}. Math picks the side. De-Genny narrates.
                  {' '}Tiers revise with prices until lock. A pick that moved says so on its card.
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
            {/* House parlays left, yesterday's board right (owner order
                2026-08-25). Expanded panels take the full row via w-full
                so the flex wrap drops them under the button strip. */}
            {sportSections.length > 0 && (
              <div className="-mt-2 flex flex-wrap items-start gap-x-3">
                <HouseParlays />
                <YesterdayBoard />
              </div>
            )}

            {/* Sport sections. All start collapsed, show 3 game preview */}
            {sportSections.length === 0 ? (
              <div className="bg-ink-900 rounded-sharp shadow-hairline p-6 md:p-8">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400 mb-3">
                  Slate status
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-ink-100 leading-tight">The slate is dark.</h2>
                <p className="text-sm text-ink-300 mt-2 leading-relaxed max-w-2xl">
                  Every game on the board has started or settled, and the books haven't
                  posted the next slate yet. Nothing is broken. There's just nothing
                  to grade until new games go up.
                </p>
                {data.firstGameTime && (
                  <p className="mt-4 font-mono text-sm text-signal-pos">
                    Next slate: {fmtGameDateTime(data.firstGameTime)}
                  </p>
                )}
                {Object.entries(data.upcomingCounts || {}).filter(([, n]) => n > 0).length > 0 && (
                  <p className="mt-1 font-mono text-xs text-ink-400">
                    On deck: {Object.entries(data.upcomingCounts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s, n]) => `${s} ${n}`).join(' · ')}
                  </p>
                )}
                <div className="flex flex-wrap items-start gap-x-3">
                  <HouseParlays />
                  <YesterdayBoard />
                </div>
                <p className="text-xs text-ink-500 mt-4">
                  Meanwhile, every settled pick is on <button onClick={() => { window.location.hash = '#/ledger' }} className="text-signal-pos hover:underline">The House Ledger</button>.
                </p>
              </div>
            ) : (
              <>
                {/* Board filter chips */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500 mr-1">Show</span>
                  {BOARD_FILTERS.map((f) => (
                    <button
                      key={f}
                      onClick={() => setBoardFilter(f)}
                      className={`px-2.5 py-1 rounded-full font-mono text-[11px] uppercase tracking-[0.06em] transition-colors ${
                        boardFilter === f
                          ? 'bg-signal-pos-dim/60 text-signal-pos font-semibold'
                          : 'bg-ink-900 text-ink-400 hover:text-ink-200 shadow-hairline'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                {sportSections.map(([sport, games]) => (
                  <SportSection
                    key={sport}
                    sport={sport}
                    games={games}
                    injuries={data.injuries}
                    isDefaultExpanded={boardFilter !== 'All'}
                    onDeepResearch={handleOpenDeepResearch}
                    upcomingCount={data.upcomingCounts?.[sport] || 0}
                    filter={boardFilter}
                  />
                ))}
              </>
            )}

            {/* Golf is a side dish, not the main course. One collapsed line at
                the bottom of the sports list; the field boards live inside. */}
            {data.golf && <GolfLeaderboard golf={data.golf} />}

            {/* On deck, the wall of future games the books already price.
                The board is never "thin", the window is just honest. */}
            <OnDeckRail onDeck={data.onDeck} />

            {/* Bottom CTA. Primary action (Chat) gets the amber fill; secondary (Generator) stays ghost so the eye lands on the primary */}
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
                The Board, filter every pick
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

      {/* Edge legend modal, a teach-once explainer for pp + tier ladder. */}
      <EdgeLegendModal open={legendOpen} onClose={() => setLegendOpen(false)} />

      {/* Sticky locked-picks bar, visible whenever the user has staged ≥ 1 pick.
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
    { range: '7-10pp', label: 'Strong Play', sub: 'strong play', cls: 'text-signal-pos font-semibold' },
    { range: '4-7pp',  label: 'Play',        sub: 'play it',     cls: 'text-signal-pos' },
    { range: '2-4pp',  label: 'Lean',        sub: 'lean it',     cls: 'text-signal-pos/70' },
    { range: '-2-2pp', label: 'Skip',        sub: 'pass on it',  cls: 'text-ink-300' },
    { range: 'baited', label: 'Trap',        sub: 'fade it',     cls: 'text-signal-neg font-semibold' },
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
              Example: <span className="tabular-nums text-signal-pos">+8.2pp</span> on a Strong Play means the model thinks that side wins 8.2 percentage points more often than the −110 line implies.
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

          <div>
            <div className="font-mono text-[10px] text-signal-pos uppercase tracking-[0.18em] mb-2">
              What feeds the number
            </div>
            <p className="text-ink-300 text-xs leading-relaxed mb-2.5">
              Every edge is built from the same stack of inputs, each carrying its own weight in the blend:
            </p>
            <ul className="text-ink-300 text-xs leading-relaxed space-y-1.5 list-none">
              <li><span className="text-ink-100">Market prices</span> · every book's line, devigged to a fair consensus probability</li>
              <li><span className="text-ink-100">Season records</span> · verified standings, not vibes</li>
              <li><span className="text-ink-100">Recent form</span> · last-10 results and active win or loss streaks</li>
              <li><span className="text-ink-100">Scoring margin</span> · run and point differential over the recent window</li>
              <li><span className="text-ink-100">Home and road splits</span> · including the home-field baseline</li>
              <li><span className="text-ink-100">Strength of schedule</span> · who those wins actually came against</li>
              <li><span className="text-ink-100">Injuries</span> · web-verified reports swept twice daily, returns included</li>
              <li><span className="text-ink-100">Weather</span> · game-time wind, temperature, and precipitation at the stadium for outdoor games</li>
              <li><span className="text-ink-100">Head-to-head</span> · prior meetings where the sport keeps them meaningful</li>
              <li><span className="text-ink-100">Player-sport form</span> · tour rankings, 30-day match records, fight records and layoffs</li>
              <li><span className="text-ink-100">Line value</span> · the best available price measured against that fair consensus</li>
            </ul>
            <p className="text-ink-400 text-xs leading-relaxed mt-2.5">
              The weights are re-measured against settled results every week, so a signal that stops predicting loses its vote. The exact weights and the blend are the house recipe.
            </p>
            <p className="text-ink-400 text-xs leading-relaxed mt-2.5">
              <span className="text-ink-200 italic">muted</span> on a market means exactly that: the model still computes an edge there every run, but the weekly calibration measured that market's edge against settled results and found it predicting nothing for that sport, so it carries zero weight until it re-earns its vote. We would rather show you nothing than a number that does not win.
            </p>
          </div>

          <div className="pt-3 border-t border-ink-700">
            <p className="text-ink-300 text-xs leading-relaxed font-mono">
              Math picks the side. De-Genny narrates. A <span className="text-signal-neg">Trap</span> is a side the casual bettor wants, priced 2pp or more below fair. We name the bait so you don't take it.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

