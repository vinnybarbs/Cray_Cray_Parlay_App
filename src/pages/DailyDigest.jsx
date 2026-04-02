import React, { useState, useEffect, useCallback } from 'react'

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

function GameCard({ game, onQuickParlay }) {
  const [expanded, setExpanded] = useState(false)
  const edge = game.edge_score != null ? Number(game.edge_score).toFixed(1) : null

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      <div className="p-4">
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
              <div className="text-xs text-gray-600 mt-0.5">{toMountainTime(game.game_date)} MT</div>
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
    </div>
  )
}

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

function SportSection({ sport, games, injuries, onQuickParlay }) {
  const meta = getSportMeta(sport)
  const topGames = games.slice(0, 3)
  const injuryCode = ANALYSIS_SPORT_TO_CODE[sport] || sport
  const injuryEntry = injuries[injuryCode]

  const buildQuickParlay = () => {
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
    } catch (e) {
      // storage not available
    }

    window.location.hash = '/'
  }

  return (
    <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
      {/* Sport header bar */}
      <div className="bg-gradient-to-r from-gray-800 to-gray-750 px-6 py-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{meta.emoji}</span>
            <div>
              <h2 className="text-lg font-bold text-white">{meta.label}</h2>
              <p className="text-xs text-gray-400">
                {games.length} game{games.length !== 1 ? 's' : ''} with analysis today
              </p>
            </div>
          </div>
          {/* Quick Parlay button */}
          {topGames.some(g => g.recommended_pick) && (
            <button
              onClick={buildQuickParlay}
              className="px-4 py-2 text-sm font-bold rounded-xl bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 text-gray-900 shadow-lg transition-all hover:shadow-xl active:scale-95"
            >
              Quick Parlay
            </button>
          )}
        </div>
      </div>

      <div className="p-6">
        {/* Top picks grid */}
        <div className="mb-2">
          <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-3 font-semibold">Top Picks by Edge Score</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {topGames.map((game, i) => (
              <GameCard key={`${game.home_team}-${game.away_team}-${i}`} game={game} />
            ))}
          </div>
          {games.length > 3 && (
            <p className="text-xs text-gray-600 mt-2 text-center">
              + {games.length - 3} more {meta.label} games in the system
            </p>
          )}
        </div>

        {/* Injuries */}
        <InjurySection content={injuryEntry?.content} />
      </div>
    </div>
  )
}

function YesterdayRecap({ results }) {
  const sports = Object.keys(results)
  if (sports.length === 0) return null

  return (
    <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-700">
        <h2 className="text-lg font-bold text-white">Yesterday's Results</h2>
        <p className="text-xs text-gray-400 mt-0.5">Picks settled in the last 24 hours</p>
      </div>
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sports.map(sport => {
          const { won, lost, picks } = results[sport]
          const total = won + lost
          const rate = total > 0 ? Math.round((won / total) * 100) : null
          const meta = getSportMeta(sport)

          return (
            <div key={sport} className="bg-gray-900 rounded-xl p-4 border border-gray-700">
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
                {picks.slice(0, 4).map((p, i) => (
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
                {picks.length > 4 && (
                  <p className="text-xs text-gray-600">+ {picks.length - 4} more</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ModelPerformance({ sevenDay, allTime }) {
  const [view, setView] = React.useState('7day')
  const data = view === '7day' ? sevenDay : allTime
  if (!data || !data.overall) return null

  const { overall, bySport } = data
  const sports = Object.entries(bySport).sort((a, b) => (b[1].winRate || 0) - (a[1].winRate || 0))

  return (
    <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Model Performance</h2>
          <p className="text-xs text-gray-400 mt-0.5">{overall.total} picks settled {view === '7day' ? 'in the last 7 days' : 'all time'}</p>
        </div>
        <div className="flex bg-gray-900 rounded-lg p-0.5">
          <button
            onClick={() => setView('7day')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${view === '7day' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >7 Day</button>
          <button
            onClick={() => setView('alltime')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${view === 'alltime' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >All Time</button>
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
        <div className="space-y-3">
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
      </div>
    </div>
  )
}

export default function DailyDigest({ onBack }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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
          className="ml-auto text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Refresh
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
                <div className="text-xs text-gray-500 uppercase tracking-widest mb-2 font-semibold">Games Next 24h</div>
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
                />
              ))
            )}

            {/* Yesterday's Recap */}
            {Object.keys(data.yesterdayResults).length > 0 && (
              <YesterdayRecap results={data.yesterdayResults} />
            )}

            {/* Model Performance (7-day / All-time toggle) */}
            {(data.sevenDayAccuracy?.overall || data.allTimeAccuracy?.overall) && (
              <ModelPerformance sevenDay={data.sevenDayAccuracy} allTime={data.allTimeAccuracy} />
            )}

            {/* Bottom CTA */}
            <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6 flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={() => {
                  window.location.hash = '#/chat'
                  onBack()
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
    </div>
  )
}
