import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

import { API_BASE_URL as API_BASE } from '../config'

function StatCard({ label, value, sub, color = 'yellow' }) {
  const colorMap = {
    yellow: 'text-signal-pos',
    green:  'text-emerald-400',
    red:    'text-signal-neg',
    blue:   'text-sky-400',
    gray:   'text-ink-300',
  }
  return (
    <div className="bg-ink-900 rounded-sharp shadow-hairline p-4">
      <p className="font-mono text-[10px] text-ink-400 uppercase tracking-[0.14em]">{label}</p>
      <p className={`font-mono text-2xl font-semibold tabular-nums ${colorMap[color]}`}>
        {value}
      </p>
      {sub && <p className="font-mono text-[11px] text-ink-400 mt-1 tabular-nums">{sub}</p>}
    </div>
  )
}

function BreakdownList({ items }) {
  const entries = Object.entries(items || {})
  if (entries.length === 0) {
    return <p className="text-ink-400 text-xs mb-4">No data for this period.</p>
  }
  return (
    <div className="space-y-2 mb-2">
      {entries.map(([label, stats]) => {
        const decided = stats.wins + stats.losses
        const wr = decided > 0 ? ((stats.wins / decided) * 100).toFixed(1) : 'N/A'
        return (
          <div key={label} className="flex items-center justify-between bg-ink-900 rounded-sharp px-4 py-2 border border-ink-700">
            <span className="text-sm text-ink-200">{label}</span>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-green-400">{stats.wins}W</span>
              <span className="text-signal-neg">{stats.losses}L</span>
              <span className="text-signal-pos font-bold">{wr}{wr !== 'N/A' ? '%' : ''}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ParlayRow({ parlay, legs }) {
  const [expanded, setExpanded] = useState(false)
  const outcomeColor = {
    won: 'text-green-400',
    lost: 'text-signal-neg',
    push: 'text-signal-pos',
    pending: 'text-ink-300'
  }
  const outcome = parlay.final_outcome || parlay.status || 'pending'

  return (
    <div className="bg-ink-900 rounded-sharp border border-ink-700 mb-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`font-bold text-sm uppercase ${outcomeColor[outcome]}`}>
              {outcome === 'pending' ? '⏳' : outcome === 'won' ? '✅' : outcome === 'lost' ? '❌' : '🔄'} {outcome}
            </span>
            <span className="text-ink-400 text-xs">{parlay.total_legs} legs</span>
            <span className="text-ink-400 text-xs">{parlay.generate_mode || ''}</span>
          </div>
          <p className="text-ink-300 text-xs mt-1">
            {new Date(parlay.created_at).toLocaleDateString()} &middot; {parlay.combined_odds} odds &middot; ${parlay.potential_payout?.toFixed(0) || '?'} payout
          </p>
        </div>
        <span className="text-ink-400">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && legs && (
        <div className="px-4 pb-3 space-y-2">
          {legs.map((leg, i) => (
            <div key={i} className="flex items-center justify-between text-sm border-t border-ink-700 pt-2">
              <div>
                <span className="text-ink-200">{leg.pick || leg.pick_description}</span>
                <span className="text-ink-400 ml-2 text-xs">{leg.sport} &middot; {leg.odds}</span>
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
  const [modelStatsByPeriod, setModelStatsByPeriod] = useState({ last_7d: null, last_30d: null, all: null })
  const [modelPeriod, setModelPeriod] = useState('last_30d')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('model') // 'my-bets' | 'model' — default to model so new users see hit-rate data, not an empty "My Bets"
  const [tabAutoSet, setTabAutoSet] = useState(false)

  const modelStats = modelStatsByPeriod[modelPeriod]

  useEffect(() => {
    loadData()
  }, [isAuthenticated, user])

  // Auto-route the first visit: if the user has bets, surface them.
  // Otherwise stay on Model. Only fires once so manual taps stick.
  useEffect(() => {
    if (tabAutoSet || loading) return
    if (isAuthenticated && parlays.length > 0) {
      setTab('my-bets')
    }
    setTabAutoSet(true)
  }, [loading, isAuthenticated, parlays.length, tabAutoSet])

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

      // Load model performance from precomputed MV (all three periods in one call)
      if (supabase) {
        const { data: mvRows } = await supabase
          .from('mv_model_accuracy')
          .select('*')
          .in('period_bucket', ['last_7d', 'last_30d', 'all'])

        if (mvRows && mvRows.length > 0) {
          const asMap = (rows) => {
            const out = {}
            for (const r of rows) {
              out[r.dimension_value] = {
                wins: r.won || 0,
                losses: r.lost || 0,
                total: (r.won || 0) + (r.lost || 0) + (r.push || 0),
              }
            }
            return out
          }

          const byPeriod = { last_7d: null, last_30d: null, all: null }
          for (const period of Object.keys(byPeriod)) {
            const rows = mvRows.filter(r => r.period_bucket === period)
            if (rows.length === 0) continue
            const overallRow = rows.find(r => r.dimension_type === 'overall')
            const wins   = overallRow?.won || 0
            const losses = overallRow?.lost || 0
            const total  = overallRow ? (overallRow.won + overallRow.lost + overallRow.push) : 0
            byPeriod[period] = {
              total, wins, losses,
              winRate: wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : 'N/A',
              bySport:   asMap(rows.filter(r => r.dimension_type === 'sport')),
              byBetType: asMap(rows.filter(r => r.dimension_type === 'bet_type')),
              byMode:    asMap(rows.filter(r => r.dimension_type === 'generate_mode')),
            }
          }
          setModelStatsByPeriod(byPeriod)
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
    <div className="min-h-screen bg-ink-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-ink-900 border-b border-ink-700">
        <button onClick={onBack} className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-300 hover:text-ink-100 transition-colors">← Back</button>
        <h1 className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-ink-100">
          Track Record
        </h1>
        <button
          onClick={triggerSettlement}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400 hover:text-signal-pos transition-colors"
          title="Manually run the settlement check on pending bets"
        >
          ↻ Settle
        </button>
      </header>

      {/* Tabs — terminal-style segmented control matching MarketTabs */}
      <div className="flex items-stretch border-b border-ink-700">
        <button
          onClick={() => { setTab('my-bets'); setTabAutoSet(true); }}
          className={`flex-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em] py-3 transition-colors ${
            tab === 'my-bets'
              ? 'text-ink-100 bg-ink-800 border-b-2 border-signal-pos'
              : 'text-ink-400 hover:text-ink-200'
          }`}
        >
          My Bets
        </button>
        <button
          onClick={() => { setTab('model'); setTabAutoSet(true); }}
          className={`flex-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em] py-3 transition-colors border-l border-ink-700 ${
            tab === 'model'
              ? 'text-ink-100 bg-ink-800 border-b-2 border-signal-pos'
              : 'text-ink-400 hover:text-ink-200'
          }`}
        >
          Model
        </button>
      </div>

      <div className="px-4 py-4 max-w-2xl mx-auto">
        {loading ? (
          <div className="text-center py-12 text-ink-400">Loading...</div>
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
              <p className="font-mono text-[11px] text-ink-400 mb-4 tabular-nums">
                <span className="text-signal-pos">{userPending}</span> parlay{userPending !== 1 ? 's' : ''} still pending settlement
              </p>
            )}

            {!isAuthenticated ? (
              <div className="bg-ink-900 rounded-sharp shadow-hairline px-4 py-8 text-center">
                <p className="font-mono text-sm text-ink-200 mb-2">Sign in to track your bets.</p>
                <p className="font-mono text-[11px] text-ink-400 leading-relaxed max-w-sm mx-auto">
                  We grade every locked pick against the model — you'll see your hit-rate next to ours.
                </p>
              </div>
            ) : parlays.length === 0 ? (
              <div className="bg-ink-900 rounded-sharp shadow-hairline px-4 py-8 text-center">
                <p className="font-mono text-sm text-ink-200 mb-2">No locked parlays yet.</p>
                <p className="font-mono text-[11px] text-ink-400 leading-relaxed max-w-sm mx-auto">
                  Lock picks from the daily digest and they show up here once games finish.
                </p>
              </div>
            ) : (
              parlays.map(p => (
                <ParlayRow key={p.id} parlay={p} legs={parlayLegs[p.id] || []} />
              ))
            )}
          </>
        ) : (
          <>
            {/* Period — terminal-style segmented control */}
            <div className="flex items-stretch mb-5 rounded-sharp shadow-hairline overflow-hidden">
              {[
                { key: 'last_7d',  label: '7 days' },
                { key: 'last_30d', label: '30 days' },
                { key: 'all',      label: 'All time' },
              ].map((opt, i) => (
                <button
                  key={opt.key}
                  onClick={() => setModelPeriod(opt.key)}
                  className={`flex-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em] py-2 transition-colors ${
                    modelPeriod === opt.key
                      ? 'text-ink-100 bg-ink-750'
                      : 'text-ink-400 bg-ink-900 hover:text-ink-200'
                  } ${i > 0 ? 'border-l border-ink-600' : ''}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Model Stats */}
            {modelStats ? (
              <>
                {/* Hero hit-rate — the headline trust signal */}
                <div className="bg-ink-900 rounded-sharp shadow-hairline p-6 mb-5">
                  <div className="font-mono text-[10px] text-ink-400 uppercase tracking-[0.18em] mb-2">
                    Overall hit rate · {modelPeriod === 'last_7d' ? 'last 7 days' : modelPeriod === 'last_30d' ? 'last 30 days' : 'all time'}
                  </div>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className={`font-mono text-5xl md:text-6xl font-bold tabular-nums tracking-tight ${
                      modelStats.winRate === 'N/A' ? 'text-ink-400'
                        : Number(modelStats.winRate) >= 55 ? 'text-signal-pos'
                        : Number(modelStats.winRate) >= 50 ? 'text-ink-100'
                        : 'text-signal-neg'
                    }`}>
                      {modelStats.winRate === 'N/A' ? '—' : `${modelStats.winRate}%`}
                    </span>
                    <span className="font-mono text-sm text-ink-400 tabular-nums">
                      {modelStats.wins}W &nbsp;·&nbsp; {modelStats.losses}L &nbsp;·&nbsp; {modelStats.total} settled
                    </span>
                  </div>
                </div>

                {/* By Bet Type — the sharp-curious persona's data. Promoted above By Sport. */}
                {Object.keys(modelStats.byBetType || {}).length > 0 && (
                  <>
                    <h3 className="font-mono text-[10px] text-ink-400 uppercase tracking-[0.18em] mb-2.5">By bet type</h3>
                    <BreakdownList items={modelStats.byBetType} />
                  </>
                )}

                {/* By Sport */}
                {Object.keys(modelStats.bySport || {}).length > 0 && (
                  <>
                    <h3 className="font-mono text-[10px] text-ink-400 uppercase tracking-[0.18em] mb-2.5 mt-5">By sport</h3>
                    <BreakdownList items={modelStats.bySport} />
                  </>
                )}

                {/* By Mode */}
                {Object.keys(modelStats.byMode || {}).length > 0 && (
                  <>
                    <h3 className="font-mono text-[10px] text-ink-400 uppercase tracking-[0.18em] mb-2.5 mt-5">By generation mode</h3>
                    <BreakdownList items={modelStats.byMode} />
                  </>
                )}
              </>
            ) : (
              <div className="bg-ink-900 rounded-sharp shadow-hairline px-4 py-8 text-center">
                <p className="font-mono text-sm text-ink-200 mb-2">No settled predictions for this window yet.</p>
                <p className="font-mono text-[11px] text-ink-400 leading-relaxed max-w-sm mx-auto">
                  Picks settle automatically as games finish. Check back, or pick a longer window above.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
