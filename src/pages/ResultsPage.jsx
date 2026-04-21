import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://craycrayparlayapp-production.up.railway.app'

function StatCard({ label, value, sub, color = 'yellow' }) {
  const colorMap = {
    yellow: 'from-yellow-500 to-orange-500',
    green: 'from-green-500 to-emerald-500',
    red: 'from-red-500 to-pink-500',
    blue: 'from-blue-500 to-cyan-500',
    gray: 'from-gray-500 to-gray-600'
  }
  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
      <p className="text-gray-400 text-xs uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold bg-gradient-to-r ${colorMap[color]} bg-clip-text text-transparent`}>
        {value}
      </p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  )
}

function ParlayRow({ parlay, legs }) {
  const [expanded, setExpanded] = useState(false)
  const outcomeColor = {
    won: 'text-green-400',
    lost: 'text-red-400',
    push: 'text-yellow-400',
    pending: 'text-gray-400'
  }
  const outcome = parlay.final_outcome || parlay.status || 'pending'

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 mb-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`font-bold text-sm uppercase ${outcomeColor[outcome]}`}>
              {outcome === 'pending' ? '⏳' : outcome === 'won' ? '✅' : outcome === 'lost' ? '❌' : '🔄'} {outcome}
            </span>
            <span className="text-gray-500 text-xs">{parlay.total_legs} legs</span>
            <span className="text-gray-500 text-xs">{parlay.generate_mode || ''}</span>
          </div>
          <p className="text-gray-400 text-xs mt-1">
            {new Date(parlay.created_at).toLocaleDateString()} &middot; {parlay.combined_odds} odds &middot; ${parlay.potential_payout?.toFixed(0) || '?'} payout
          </p>
        </div>
        <span className="text-gray-500">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && legs && (
        <div className="px-4 pb-3 space-y-2">
          {legs.map((leg, i) => (
            <div key={i} className="flex items-center justify-between text-sm border-t border-gray-700 pt-2">
              <div>
                <span className="text-gray-300">{leg.pick || leg.pick_description}</span>
                <span className="text-gray-500 ml-2 text-xs">{leg.sport} &middot; {leg.odds}</span>
              </div>
              <span className={`text-xs font-bold ${outcomeColor[leg.outcome || 'pending']}`}>
                {(leg.outcome || 'pending').toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ResultsPage({ onBack }) {
  const { user, isAuthenticated } = useAuth()
  const [parlays, setParlays] = useState([])
  const [parlayLegs, setParlayLegs] = useState({})
  const [modelStats, setModelStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('my-bets') // 'my-bets' | 'model'

  useEffect(() => {
    loadData()
  }, [isAuthenticated, user])

  const loadData = async () => {
    setLoading(true)
    try {
      // Load user parlays
      if (isAuthenticated && user && supabase) {
        const { data: parlayData } = await supabase
          .from('parlays')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_lock_bet', true)
          .order('created_at', { ascending: false })
          .limit(50)

        if (parlayData) {
          setParlays(parlayData)

          // Load legs for each parlay
          const parlayIds = parlayData.map(p => p.id)
          if (parlayIds.length > 0) {
            const { data: legsData } = await supabase
              .from('parlay_legs')
              .select('*')
              .in('parlay_id', parlayIds)
              .order('leg_number', { ascending: true })

            // Also check metadata for parlays without legs
            const legsByParlay = {}
            parlayData.forEach(p => {
              legsByParlay[p.id] = []
            })

            if (legsData) {
              legsData.forEach(leg => {
                if (!legsByParlay[leg.parlay_id]) legsByParlay[leg.parlay_id] = []
                legsByParlay[leg.parlay_id].push(leg)
              })
            }

            // Fallback to metadata for parlays without legs
            parlayData.forEach(p => {
              if (legsByParlay[p.id].length === 0 && p.metadata?.locked_picks) {
                legsByParlay[p.id] = p.metadata.locked_picks.map((lp, i) => ({
                  id: `meta_${i}`,
                  leg_number: lp.leg_number || i + 1,
                  sport: lp.sport,
                  pick: lp.pick,
                  pick_description: `${lp.betType}: ${lp.pick}`,
                  odds: lp.odds,
                  outcome: 'pending'
                }))
              }
            })

            setParlayLegs(legsByParlay)
          }
        }
      }

      // Load model performance from precomputed MV (public)
      if (supabase) {
        const { data: mvRows } = await supabase
          .from('mv_model_accuracy')
          .select('*')
          .eq('period_bucket', 'last_30d')

        if (mvRows && mvRows.length > 0) {
          const overallRow = mvRows.find(r => r.dimension_type === 'overall')
          const sportRows  = mvRows.filter(r => r.dimension_type === 'sport')
          const modeRows   = mvRows.filter(r => r.dimension_type === 'generate_mode')

          const asMap = (rows) => {
            const out = {}
            for (const r of rows) {
              out[r.dimension_value] = {
                wins: r.won || 0,
                losses: r.lost || 0,
                total: (r.won || 0) + (r.lost || 0) + (r.push || 0),
                roi_pct: r.roi_pct != null ? Number(r.roi_pct) : null,
              }
            }
            return out
          }

          const total   = overallRow ? (overallRow.won + overallRow.lost + overallRow.push) : 0
          const wins    = overallRow?.won || 0
          const losses  = overallRow?.lost || 0
          const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : 'N/A'
          const roi_pct = overallRow?.roi_pct != null ? Number(overallRow.roi_pct) : null

          setModelStats({
            total, wins, losses, winRate, roi_pct,
            bySport: asMap(sportRows),
            byMode:  asMap(modeRows),
          })
        }
      }
    } catch (err) {
      console.error('Error loading results:', err)
    } finally {
      setLoading(false)
    }
  }

  // Trigger settlement check
  const triggerSettlement = async () => {
    try {
      await fetch(`${API_BASE}/api/cron/check-parlays`, { method: 'POST' })
      // Reload after a moment
      setTimeout(loadData, 3000)
    } catch (err) {
      console.error('Settlement trigger error:', err)
    }
  }

  // User stats
  const userWins = parlays.filter(p => p.final_outcome === 'won').length
  const userLosses = parlays.filter(p => p.final_outcome === 'lost').length
  const userPending = parlays.filter(p => !p.final_outcome || p.final_outcome === 'pending' || p.status === 'pending').length
  const userWinRate = userWins + userLosses > 0 ? ((userWins / (userWins + userLosses)) * 100).toFixed(1) : '--'

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-sm">&larr; Back</button>
        <h1 className="text-lg font-bold bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
          Results & Performance
        </h1>
        <button onClick={triggerSettlement} className="text-xs text-gray-500 hover:text-yellow-400">
          Refresh
        </button>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setTab('my-bets')}
          className={`flex-1 py-3 text-sm font-medium ${tab === 'my-bets' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-gray-500'}`}
        >
          My Bets
        </button>
        <button
          onClick={() => setTab('model')}
          className={`flex-1 py-3 text-sm font-medium ${tab === 'model' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-gray-500'}`}
        >
          AI Model Performance
        </button>
      </div>

      <div className="px-4 py-4 max-w-2xl mx-auto">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : tab === 'my-bets' ? (
          <>
            {/* User Stats */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              <StatCard label="Locked" value={parlays.length} color="blue" />
              <StatCard label="Won" value={userWins} color="green" />
              <StatCard label="Lost" value={userLosses} color="red" />
              <StatCard label="Win %" value={userWinRate === '--' ? '--' : `${userWinRate}%`} color="yellow" />
            </div>

            {userPending > 0 && (
              <p className="text-gray-500 text-xs mb-4">{userPending} parlay(s) still pending settlement</p>
            )}

            {!isAuthenticated ? (
              <p className="text-center text-gray-500 py-8">Sign in to see your betting history</p>
            ) : parlays.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No locked parlays yet. Lock some picks to start tracking!</p>
            ) : (
              parlays.map(p => (
                <ParlayRow key={p.id} parlay={p} legs={parlayLegs[p.id] || []} />
              ))
            )}
          </>
        ) : (
          <>
            {/* Model Stats */}
            {modelStats ? (
              <>
                <div className="grid grid-cols-5 gap-3 mb-6">
                  <StatCard label="Predictions" value={modelStats.total} color="blue" />
                  <StatCard label="Wins" value={modelStats.wins} color="green" />
                  <StatCard label="Losses" value={modelStats.losses} color="red" />
                  <StatCard label="Win %" value={`${modelStats.winRate}%`} color="yellow" sub="Last 30 days" />
                  <StatCard
                    label="ROI"
                    value={modelStats.roi_pct != null
                      ? `${modelStats.roi_pct >= 0 ? '+' : ''}${modelStats.roi_pct.toFixed(1)}%`
                      : '—'}
                    color={modelStats.roi_pct == null ? 'gray'
                      : modelStats.roi_pct > 0 ? 'green'
                      : modelStats.roi_pct < 0 ? 'red'
                      : 'yellow'}
                  />
                </div>

                {/* By Sport */}
                <h3 className="text-sm font-semibold text-gray-300 mb-3 mt-6">By Sport</h3>
                <div className="space-y-2 mb-6">
                  {Object.entries(modelStats.bySport).map(([sport, stats]) => {
                    const wr = stats.wins + stats.losses > 0
                      ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1)
                      : 'N/A'
                    const roi = stats.roi_pct
                    return (
                      <div key={sport} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-2 border border-gray-700">
                        <span className="text-sm text-gray-300">{sport}</span>
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-green-400">{stats.wins}W</span>
                          <span className="text-red-400">{stats.losses}L</span>
                          <span className="text-yellow-400 font-bold">{wr}%</span>
                          <span className={`font-bold w-14 text-right ${
                            roi == null ? 'text-gray-600' :
                            roi > 0 ? 'text-green-400' :
                            roi < 0 ? 'text-red-400' : 'text-gray-400'
                          }`}>
                            {roi != null ? `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%` : '—'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* By Mode */}
                <h3 className="text-sm font-semibold text-gray-300 mb-3">By Generation Mode</h3>
                <div className="space-y-2">
                  {Object.entries(modelStats.byMode).map(([mode, stats]) => {
                    const wr = stats.wins + stats.losses > 0
                      ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1)
                      : 'N/A'
                    const roi = stats.roi_pct
                    return (
                      <div key={mode} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-2 border border-gray-700">
                        <span className="text-sm text-gray-300">{mode}</span>
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-green-400">{stats.wins}W</span>
                          <span className="text-red-400">{stats.losses}L</span>
                          <span className="text-yellow-400 font-bold">{wr}%</span>
                          <span className={`font-bold w-14 text-right ${
                            roi == null ? 'text-gray-600' :
                            roi > 0 ? 'text-green-400' :
                            roi < 0 ? 'text-red-400' : 'text-gray-400'
                          }`}>
                            {roi != null ? `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%` : '—'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <p className="text-center text-gray-500 py-8">No resolved AI predictions yet. Check back after games complete.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
