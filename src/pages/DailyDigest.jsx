import React, { useState, useEffect, useCallback, useRef } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://craycrayparlayapp-production.up.railway.app'

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

// Note: function name is now misleading — kept stable to avoid touching every
// call site. Renders in the user's local timezone (no timeZone option) so a
// New York user sees Eastern, a London user sees BST, etc.
function toMountainTime(isoString) {
  if (!isoString) return null
  return new Date(isoString).toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatFullDate(isoString) {
  const d = isoString ? new Date(isoString) : new Date()
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function edgeBadgeClass(score) {
  if (score == null) return 'bg-gray-700 text-gray-400'
  if (score >= 8) return 'bg-green-700 text-green-200 border border-green-600'
  if (score >= 6) return 'bg-yellow-700 text-yellow-200 border border-yellow-600'
  return 'bg-gray-700 text-gray-400 border border-gray-600'
}

function winRateColor(rate) {
  if (rate == null) return 'text-gray-400'
  if (rate >= 60) return 'text-green-400'
  if (rate >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

function winRateBarColor(rate) {
  if (rate == null) return 'bg-gray-600'
  if (rate >= 60) return 'bg-green-500'
  if (rate >= 50) return 'bg-yellow-500'
  return 'bg-red-500'
}

function edgeMovementIcon(movement) {
  if (!movement) return null
  const m = String(movement).toLowerCase()
  if (m === 'up' || m === 'rising') return <span className="text-green-400 font-bold">↑</span>
  if (m === 'down' || m === 'falling') return <span className="text-red-400 font-bold">↓</span>
  return <span className="text-gray-400">→</span>
}

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-gray-700 rounded ${className}`} />
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
        <Skeleton className="h-10 w-64 mb-3" />
        <Skeleton className="h-5 w-40 mb-2" />
        <Skeleton className="h-4 w-32" />
      </div>
      {[1, 2].map(i => (
        <div key={i} className="bg-gray-800 rounded-2xl p-6 border border-gray-700 space-y-4">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map(j => (
              <div key={j} className="bg-gray-900 rounded-xl p-4 space-y-2">
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
    <div className="flex items-center gap-2 text-sm text-gray-400 mt-1">
      <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
      <span>First game in <span className="font-mono text-green-400 font-semibold">{remaining}</span></span>
    </div>
  )
}

// ─── Deep Research Modal ────────────────────────────────────────────────────

function DeepResearchModal({ gameKey, game, onClose, onLockPick }) {
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

  const handleLockPick = () => {
    const pick = {
      sport: game.sport || 'Unknown',
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      pick: game.recommended_pick,
      betType: game.recommended_side || 'Moneyline/Spread',
      odds: -110,
      confidence: game.edge_score || 7,
      reasoning: game.analysis_snippet || '',
      gameDate: game.game_date,
      id: `${game.home_team}-${game.away_team}-deep`,
    }
    try {
      const existing = JSON.parse(localStorage.getItem('digest_parlay_picks') || '[]')
      const deduped = existing.filter(p => p.id !== pick.id)
      localStorage.setItem('digest_parlay_picks', JSON.stringify([...deduped, pick]))
    } catch (e) { /* storage unavailable */ }
    onLockPick && onLockPick(pick)
    onClose()
  }

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
      <div className="relative w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[88vh] bg-gray-900 sm:rounded-2xl border border-gray-700 shadow-2xl flex flex-col overflow-hidden">

        {/* Modal header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-700 bg-gray-800 flex-shrink-0">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Deep Research</div>
            <h2 className="text-base font-bold text-white leading-tight">
              {game.away_team} <span className="text-gray-500">@</span> {game.home_team}
            </h2>
            {game.game_date && (
              <div className="text-xs text-gray-500 mt-0.5">{toMountainTime(game.game_date)}</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 text-gray-500 hover:text-white text-xl leading-none p-1 -mr-1 mt-0.5 transition-colors"
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
            <div className="bg-red-900/40 border border-red-700 rounded-xl p-4 text-center">
              <p className="text-red-300 text-sm font-medium">Failed to load deep research data</p>
              <p className="text-red-400 text-xs mt-1">{error}</p>
              <p className="text-xs text-gray-500 mt-2">Showing available card data below.</p>
            </div>
          )}

          {/* Edge score + movement */}
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Edge Analysis</span>
              {version && (
                <span className="text-xs bg-gray-700 text-gray-300 rounded-full px-2 py-0.5">
                  Pass #{version}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {analysis.edge_score != null && (
                <span className={`px-3 py-1.5 rounded-lg text-sm font-bold ${edgeBadgeClass(analysis.edge_score)}`}>
                  Edge {Number(analysis.edge_score).toFixed(1)}
                </span>
              )}
              {analysis.edge_movement && (
                <span className="text-sm flex items-center gap-1 text-gray-400">
                  Movement: {edgeMovementIcon(analysis.edge_movement)}
                  <span className="capitalize">{analysis.edge_movement}</span>
                </span>
              )}
            </div>
          </div>

          {/* Analysis snippet + key factors */}
          {(analysis.analysis_snippet || keyFactors.length > 0) && (
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 space-y-3">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Analysis</div>
              {analysis.analysis_snippet && (
                <p className="text-sm text-gray-300 leading-relaxed">{analysis.analysis_snippet}</p>
              )}
              {keyFactors.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1.5 font-medium">Key Factors</div>
                  <ul className="space-y-1">
                    {keyFactors.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                        <span className="text-blue-500 flex-shrink-0 mt-0.5">•</span>
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
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">What Changed</div>
              <p className="text-xs text-gray-400 leading-relaxed italic">{analysis.what_changed}</p>
            </div>
          )}

          {/* Current lines */}
          {(() => {
            const odds = data?.odds || []
            const hasOdds = odds.length > 0
            const hasCardLines = analysis.spread != null || analysis.total != null || analysis.moneyline_home != null
            if (!hasOdds && !hasCardLines) return null
            return (
              <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Current Lines</div>
                {hasOdds ? (
                  <div className="space-y-2">
                    {odds.map((line, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-gray-500 capitalize">{line.market_type || 'Line'}</span>
                        <div className="flex gap-3 text-gray-300">
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
                      <span className="text-xs bg-gray-700 rounded px-2 py-1 text-gray-300">
                        Spread: {analysis.spread > 0 ? '+' : ''}{analysis.spread}
                      </span>
                    )}
                    {analysis.total != null && (
                      <span className="text-xs bg-gray-700 rounded px-2 py-1 text-gray-300">
                        O/U: {analysis.total}
                      </span>
                    )}
                    {analysis.moneyline_home != null && (
                      <span className="text-xs bg-gray-700 rounded px-2 py-1 text-gray-300">
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
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <div className="text-xs text-orange-400 uppercase tracking-wider font-semibold mb-3">Injury Report</div>
              <div className="space-y-3">
                {data.injuries.map((entry, i) => {
                  const lines = typeof entry.content === 'string'
                    ? entry.content.split('\n').filter(l => l.trim())
                    : []
                  return (
                    <div key={i}>
                      <div className="text-xs text-gray-500 font-medium mb-1">{entry.team_name}</div>
                      <ul className="space-y-0.5">
                        {lines.slice(0, 6).map((line, j) => (
                          <li key={j} className="flex items-start gap-2 text-xs text-gray-400">
                            <span className="text-orange-500 flex-shrink-0 mt-0.5">•</span>
                            {line}
                          </li>
                        ))}
                        {lines.length === 0 && (
                          <li className="text-xs text-gray-600 italic">No injury data.</li>
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
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Recent News</div>
              <div className="space-y-3">
                {data.articles.map((article, i) => (
                  <div key={i} className="border-b border-gray-700 last:border-0 pb-3 last:pb-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-xs text-gray-300 font-medium leading-snug">{article.title}</p>
                      {article.sentiment && (
                        <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${
                          article.sentiment === 'positive' ? 'bg-green-900/60 text-green-400' :
                          article.sentiment === 'negative' ? 'bg-red-900/60 text-red-400' :
                          'bg-gray-700 text-gray-400'
                        }`}>
                          {article.sentiment}
                        </span>
                      )}
                    </div>
                    {article.betting_summary && (
                      <p className="text-xs text-gray-500 leading-relaxed">{article.betting_summary}</p>
                    )}
                    {article.published_at && (
                      <p className="text-xs text-gray-700 mt-1">
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
                    won === false ? 'bg-red-900 text-red-300' :
                    'bg-gray-700 text-gray-400'
                  }`}>
                    {won === true ? 'W' : won === false ? 'L' : '?'}
                  </span>
                  <span className="text-gray-400 truncate">
                    {isHome ? 'vs' : '@'} {opponent}
                    {teamScore != null && ` ${teamScore}-${oppScore}`}
                  </span>
                  {r.date && (
                    <span className="text-gray-700 flex-shrink-0 ml-auto">
                      {new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              )
            }

            return (
              <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Recent Form</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {homeResults.length > 0 && (
                    <div>
                      <div className="text-xs text-gray-400 font-medium mb-2">{game.home_team}</div>
                      <div className="space-y-1.5">
                        {homeResults.map(r => renderResult(r, game.home_team))}
                      </div>
                    </div>
                  )}
                  {awayResults.length > 0 && (
                    <div>
                      <div className="text-xs text-gray-400 font-medium mb-2">{game.away_team}</div>
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

        {/* Modal footer — Lock Pick */}
        {game.recommended_pick && (
          <div className="flex-shrink-0 px-5 py-4 border-t border-gray-700 bg-gray-800">
            <button
              onClick={handleLockPick}
              className="w-full py-3 rounded-xl font-bold text-gray-900 text-sm bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 shadow-lg transition-all active:scale-95"
            >
              Lock This Pick — {game.recommended_pick}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── GameCard ───────────────────────────────────────────────────────────────

function GameCard({ game, gameKey, onDeepResearch }) {
  const [expanded, setExpanded] = useState(false)
  const edge = game.edge_score != null ? Number(game.edge_score).toFixed(1) : null

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden flex flex-col">
      <div className="p-4 flex-1">
        {/* Matchup header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="font-semibold text-white text-sm leading-tight">
              {game.away_team} <span className="text-gray-500">@</span> {game.home_team}
            </div>
            {(game.away_record || game.home_record) && (
              <div className="text-xs text-gray-500 mt-0.5">
                {game.away_record && <span>{game.away_record}</span>}
                {game.away_record && game.home_record && <span className="text-gray-600"> vs </span>}
                {game.home_record && <span>{game.home_record}</span>}
              </div>
            )}
            {game.game_date && (
              <div className="text-xs text-gray-600 mt-0.5">{toMountainTime(game.game_date)}</div>
            )}
          </div>
          {edge != null && (
            <span className={`px-2 py-1 rounded-lg text-xs font-bold flex-shrink-0 ${edgeBadgeClass(game.edge_score)}`}>
              Edge {edge}
            </span>
          )}
        </div>

        {/* Recommended pick */}
        {game.recommended_pick && (
          <div className="bg-gray-800 rounded-lg px-3 py-2 mb-3">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Top Pick</div>
            <div className="text-yellow-400 font-semibold text-sm">{game.recommended_pick}</div>
            {game.recommended_side && (
              <div className="text-xs text-gray-400 mt-0.5">{game.recommended_side}</div>
            )}
          </div>
        )}

        {/* Lines */}
        <div className="flex flex-wrap gap-2 mb-3">
          {game.spread != null && (
            <span className="text-xs bg-gray-800 rounded px-2 py-1 text-gray-300">
              Spread: {game.spread > 0 ? '+' : ''}{game.spread}
            </span>
          )}
          {game.total != null && (
            <span className="text-xs bg-gray-800 rounded px-2 py-1 text-gray-300">
              O/U: {game.total}
            </span>
          )}
          {game.moneyline_home != null && (
            <span className="text-xs bg-gray-800 rounded px-2 py-1 text-gray-300">
              ML: {game.moneyline_home > 0 ? '+' : ''}{game.moneyline_home} / {game.moneyline_away > 0 ? '+' : ''}{game.moneyline_away}
            </span>
          )}
        </div>

        {/* Analysis snippet (expandable) */}
        {game.analysis_snippet && (
          <div>
            <p className={`text-xs text-gray-400 leading-relaxed ${!expanded ? 'line-clamp-2' : ''}`}>
              {game.analysis_snippet}
            </p>
            {game.analysis_snippet.length > 120 && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="text-xs text-blue-400 hover:text-blue-300 mt-1"
              >
                {expanded ? 'Show less' : 'Read more'}
              </button>
            )}
          </div>
        )}

        {/* Key factors */}
        {expanded && game.key_factors && (
          <div className="mt-3 pt-3 border-t border-gray-700">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Key Factors</div>
            <p className="text-xs text-gray-400 leading-relaxed">
              {Array.isArray(game.key_factors)
                ? game.key_factors.join(' · ')
                : String(game.key_factors)}
            </p>
          </div>
        )}
      </div>

      {/* Deep Research button */}
      {gameKey && (
        <div className="px-4 pb-4 pt-0">
          <button
            onClick={() => onDeepResearch(game, gameKey)}
            className="w-full py-1.5 text-xs font-semibold text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-600 rounded-lg transition-all active:scale-95 flex items-center justify-center gap-1.5"
          >
            <span>🔬</span> Deep Research
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
    <div className="mt-4 border-t border-gray-700 pt-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm font-semibold text-orange-400 hover:text-orange-300 w-full text-left"
      >
        <span>🩹 Injury Report</span>
        <span className="text-gray-500 text-xs ml-auto">{open ? '▲ Hide' : '▼ Show'}</span>
      </button>
      {open && (
        <ul className="mt-3 space-y-1">
          {lines.length > 0
            ? lines.map((line, i) => (
                <li key={i} className="text-xs text-gray-400 flex items-start gap-2">
                  <span className="text-orange-500 flex-shrink-0 mt-0.5">•</span>
                  {line}
                </li>
              ))
            : (
              <li className="text-xs text-gray-500 italic">No injury data available.</li>
            )}
        </ul>
      )}
    </div>
  )
}

// ─── SportSection ────────────────────────────────────────────────────────────

function SportSection({ sport, games, injuries, isDefaultExpanded, onDeepResearch }) {
  const [expanded, setExpanded] = useState(isDefaultExpanded)
  const meta = getSportMeta(sport)
  // Top 3 by edge score (already sorted desc from API)
  const topGames = games.slice(0, 3)
  const extraGames = games.slice(3)
  const injuryCode = ANALYSIS_SPORT_TO_CODE[sport] || sport
  const injuryEntry = injuries[injuryCode]
  const topEdge = games[0]?.edge_score != null ? Number(games[0].edge_score).toFixed(1) : null

  // Use game_key from the DB directly (returned by /api/digest)
  function getGameKey(game) {
    return game.game_key || null
  }

  const buildQuickParlay = (e) => {
    e.stopPropagation()
    const picks = topGames
      .filter(g => g.recommended_pick)
      .map(g => ({
        sport,
        homeTeam: g.home_team,
        awayTeam: g.away_team,
        pick: g.recommended_pick,
        betType: g.recommended_side || 'Moneyline/Spread',
        odds: -110,
        confidence: g.edge_score || 7,
        reasoning: g.analysis_snippet || '',
        gameDate: g.game_date,
        id: `${g.home_team}-${g.away_team}-digest`,
      }))
    if (picks.length === 0) return
    try {
      localStorage.setItem('digest_parlay_picks', JSON.stringify(picks))
    } catch (e) { /* storage unavailable */ }
    window.location.hash = '/'
  }

  return (
    <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
      {/* Sport header bar — clickable to collapse/expand */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left bg-gradient-to-r from-gray-800 to-gray-750 px-6 py-4 border-b border-gray-700 hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{meta.emoji}</span>
            <div>
              <h2 className="text-lg font-bold text-white">{meta.label}</h2>
              <p className="text-xs text-gray-400">
                {games.length} game{games.length !== 1 ? 's' : ''} with analysis
                {!expanded && topEdge && (
                  <span className="ml-2 text-gray-500">
                    · Top edge: <span className={`font-semibold ${Number(topEdge) >= 8 ? 'text-green-400' : Number(topEdge) >= 6 ? 'text-yellow-400' : 'text-gray-400'}`}>{topEdge}</span>
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Quick Parlay button — only when expanded */}
            {expanded && topGames.some(g => g.recommended_pick) && (
              <button
                onClick={buildQuickParlay}
                className="px-4 py-2 text-sm font-bold rounded-xl bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 text-gray-900 shadow-lg transition-all hover:shadow-xl active:scale-95"
              >
                Quick Parlay
              </button>
            )}
            {/* Chevron */}
            <span className="text-gray-500 text-lg select-none">
              {expanded ? '▲' : '▼'}
            </span>
          </div>
        </div>
      </button>

      {/* Collapsed preview — top 3 picks as compact rows */}
      {!expanded && topGames.length > 0 && (
        <div className="px-6 py-3 space-y-2">
          {topGames.map((game, i) => (
            <div key={i} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${edgeBadgeClass(game.edge_score)}`}>
                  {Number(game.edge_score).toFixed(1)}
                </span>
                <span className="text-gray-300 truncate">{game.away_team} @ {game.home_team}</span>
              </div>
              <span className="text-yellow-400 text-xs font-semibold flex-shrink-0 truncate max-w-[140px]">
                {game.recommended_pick || '—'}
              </span>
            </div>
          ))}
          {games.length > 3 && (
            <p className="text-[11px] text-gray-600 text-center pt-1">Tap to see all {games.length} games</p>
          )}
        </div>
      )}

      {/* Expanded body — full tiles */}
      {expanded && (
        <div className="p-6">
          <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-3 font-semibold">
            Top Picks by Edge Score
          </h3>

          {/* Top 3 tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {topGames.map((game, i) => (
              <GameCard
                key={`${game.home_team}-${game.away_team}-${i}`}
                game={game}
                gameKey={getGameKey(game)}
                onDeepResearch={onDeepResearch}
              />
            ))}
          </div>

          {/* Additional games (beyond top 3) */}
          {extraGames.length > 0 && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 border-t border-gray-700" />
                <span className="text-xs text-gray-600 font-medium whitespace-nowrap">
                  {extraGames.length} more {meta.label} game{extraGames.length !== 1 ? 's' : ''}
                </span>
                <div className="flex-1 border-t border-gray-700" />
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

          {/* Injuries */}
          <InjurySection content={injuryEntry?.content} />
        </div>
      )}
    </div>
  )
}

// ─── GolfLeaderboard ─────────────────────────────────────────────────────────

function GolfLeaderboard({ golf }) {
  const [expanded, setExpanded] = useState(false)
  if (!golf) return null

  const preview = golf.leaderboard?.slice(0, 5) || []
  const full = golf.leaderboard || []
  const shown = expanded ? full : preview

  return (
    <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">⛳</span>
          <div className="text-left">
            <h3 className="text-lg font-bold text-white">{golf.tournament}</h3>
            <p className="text-sm text-gray-400">{golf.status}{golf.venue ? ` — ${golf.venue}` : ''}</p>
          </div>
        </div>
        <span className="text-gray-400 text-sm">{expanded ? '▲' : '▼'}</span>
      </button>

      <div className="px-4 pb-4">
        {/* Leaderboard */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-500 px-2 mb-1">
            <span>Pos</span>
            <span className="flex-1 ml-3">Player</span>
            <span className="w-16 text-right">Score</span>
            {golf.outrightOdds && <span className="w-16 text-right">Odds</span>}
          </div>
          {shown.map((p, i) => {
            const odds = golf.outrightOdds?.find(o =>
              o.name.toLowerCase().includes(p.name.split(' ').slice(-1)[0].toLowerCase())
            )
            return (
              <div key={i} className={`flex items-center justify-between px-2 py-1.5 rounded ${i < 3 ? 'bg-gray-750' : ''}`}>
                <span className={`w-6 text-sm font-bold ${i < 3 ? 'text-yellow-400' : 'text-gray-400'}`}>{p.position}</span>
                <span className="flex-1 ml-2 text-sm text-white font-medium">{p.name}</span>
                <span className={`w-16 text-right text-sm font-bold ${
                  p.score?.toString().startsWith('-') ? 'text-green-400' : p.score === 'E' ? 'text-gray-300' : 'text-red-400'
                }`}>{p.score}</span>
                {golf.outrightOdds && (
                  <span className="w-16 text-right text-xs text-gray-400">
                    {odds ? `+${odds.odds}` : ''}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {full.length > 5 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full mt-2 text-center text-sm text-purple-400 hover:text-purple-300"
          >
            {expanded ? 'Show less' : `Show all ${full.length} players`}
          </button>
        )}
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
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-700">
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
                ? 'bg-green-900 text-green-300 border border-green-700'
                : 'bg-red-900 text-red-300 border border-red-700'
            }`}>
              {p.outcome === 'won' ? 'W' : 'L'}
            </span>
            <span className="text-xs text-gray-400 truncate">
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
    <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-700">
        <h2 className="text-lg font-bold text-white">Recent Results</h2>
        <p className="text-xs text-gray-400 mt-0.5">Picks settled in the last 3 days</p>
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
    <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Model Performance</h2>
          <p className="text-xs text-gray-400 mt-0.5">{overall.total} picks settled {periodLabel}</p>
        </div>
        <div className="flex bg-gray-900 rounded-lg p-0.5">
          {pills.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${period === p.key ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >{p.label}</button>
          ))}
        </div>
      </div>
      <div className="p-6">
        {/* Overall rate */}
        {overall.winRate != null && (
          <div className="text-center mb-6 pb-6 border-b border-gray-700">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Overall Win Rate</div>
            <div className={`text-5xl font-extrabold ${winRateColor(overall.winRate)}`}>
              {overall.winRate}%
            </div>
            <div className="text-sm text-gray-500 mt-1">
              {overall.won}W — {overall.lost}L
            </div>
          </div>
        )}

        {/* Per-sport bars */}
        {sports.length > 0 && (
          <>
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">By Sport</div>
            <div className="space-y-3 mb-6">
              {sports.map(([sport, stats]) => {
                const meta = getSportMeta(sport)
                return (
                  <div key={sport}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{meta.emoji}</span>
                        <span className="text-sm text-gray-300 font-medium">{meta.label}</span>
                        <span className="text-xs text-gray-600">({stats.won}W-{stats.lost}L)</span>
                      </div>
                      <span className={`text-sm font-bold ${winRateColor(stats.winRate)}`}>
                        {stats.winRate != null ? `${stats.winRate}%` : 'N/A'}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
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
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">By Bet Type</div>
            <div className="space-y-3">
              {betTypes.map(([betType, stats]) => (
                <div key={betType}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-300 font-medium">{betType}</span>
                      <span className="text-xs text-gray-600">({stats.won}W-{stats.lost}L)</span>
                    </div>
                    <span className={`text-sm font-bold ${winRateColor(stats.winRate)}`}>
                      {stats.winRate != null ? `${stats.winRate}%` : 'N/A'}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
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

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function DailyDigest({ onBack }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deepResearchTarget, setDeepResearchTarget] = useState(null) // { game, gameKey }

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

  const sportSections = data
    ? Object.entries(data.gamesBySport)
        .filter(([, games]) => games.length > 0)
        .sort((a, b) => b[1].length - a[1].length)
    : []

  const totalGames = sportSections.reduce((sum, [, games]) => sum + games.length, 0)
  const totalSports = sportSections.length

  const handleOpenDeepResearch = useCallback((game, gameKey) => {
    setDeepResearchTarget({ game, gameKey })
  }, [])

  const handleCloseDeepResearch = useCallback(() => {
    setDeepResearchTarget(null)
  }, [])

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans">
      {/* Top nav bar */}
      <div className="sticky top-0 z-30 bg-gray-950/95 border-b border-gray-800 backdrop-blur px-4 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-white flex items-center gap-1.5 transition-colors"
        >
          ← Back
        </button>
        <span className="text-gray-700">|</span>
        <span className="text-sm font-semibold text-gray-300">Daily Digest</span>
        <button
          onClick={fetchDigest}
          className="ml-auto px-3 py-1.5 text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-700 transition-colors active:scale-95"
        >
          {loading ? '...' : '↻ Refresh'}
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Hero header */}
        <div className="bg-gradient-to-br from-gray-800 via-gray-850 to-gray-900 rounded-2xl border border-gray-700 p-6 md:p-8 shadow-2xl">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 leading-tight">
                Daily Digest
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                {data ? formatFullDate(null) : 'Loading...'}
              </p>
              {data && (
                <p className="text-gray-300 mt-2 font-medium">
                  {totalGames} analyzed game{totalGames !== 1 ? 's' : ''} across {totalSports} sport{totalSports !== 1 ? 's' : ''} today
                </p>
              )}
              {data?.firstGameTime && <Countdown targetIso={data.firstGameTime} />}
            </div>

            {/* Upcoming game counts */}
            {data && Object.keys(data.upcomingCounts).length > 0 && (
              <div className="bg-gray-900/60 rounded-xl border border-gray-700 px-4 py-3">
                <div className="text-xs text-gray-500 uppercase tracking-widest mb-2 font-semibold">De-Genny's 24-Hr Game Analysis</div>
                <div className="space-y-1">
                  {Object.entries(data.upcomingCounts).map(([sport, count]) => {
                    const meta = getSportMeta(sport)
                    return (
                      <div key={sport} className="flex items-center justify-between gap-6 text-sm">
                        <span className="text-gray-300">{meta.emoji} {meta.label}</span>
                        <span className="font-bold text-white">{count}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Loading state */}
        {loading && <LoadingSkeleton />}

        {/* Error state */}
        {!loading && error && (
          <div className="bg-red-900/40 border border-red-700 rounded-xl p-6 text-center">
            <p className="text-red-300 font-medium">Failed to load digest</p>
            <p className="text-red-400 text-sm mt-1">{error}</p>
            <button
              onClick={fetchDigest}
              className="mt-4 px-4 py-2 bg-red-800 hover:bg-red-700 rounded-lg text-sm text-white"
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

            {/* Golf tournament leaderboard */}
            {data.golf && <GolfLeaderboard golf={data.golf} />}

            {/* Sport sections — all start collapsed, show 3 game preview */}
            {sportSections.length === 0 ? (
              <div className="bg-gray-800 rounded-2xl border border-gray-700 p-8 text-center">
                <p className="text-gray-400 text-lg font-medium">No fresh game analysis available today.</p>
                <p className="text-gray-600 text-sm mt-2">Check back later or run the Pick Generator to generate analysis.</p>
              </div>
            ) : (
              sportSections.map(([sport, games]) => (
                <SportSection
                  key={sport}
                  sport={sport}
                  games={games}
                  injuries={data.injuries}
                  isDefaultExpanded={false}
                  onDeepResearch={handleOpenDeepResearch}
                />
              ))
            )}

            {/* Bottom CTA */}
            <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6 flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={() => {
                  window.location.hash = '#/chat'
                }}
                className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 hover:opacity-90 rounded-xl font-bold text-white shadow-lg transition-all"
              >
                Chat with De-Genny
              </button>
              <button
                onClick={onBack}
                className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-green-600 to-yellow-500 hover:opacity-90 rounded-xl font-bold text-white shadow-lg transition-all"
              >
                Full Pick Generator
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
          onLockPick={() => {}}
        />
      )}
    </div>
  )
}
