import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

export default function Dashboard({ onClose }) {
  const { user } = useAuth()
  const [parlays, setParlays] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)

  useEffect(() => {
    if (user && supabase) {
      fetchParlays()
      fetchStats()
    }
  }, [user])

  const fetchParlays = async () => {
    try {
      const { data, error } = await supabase
        .from('parlays')
        .select(`
          *,
          parlay_legs (
            id,
            leg_number,
            game_date,
            sport,
            home_team,
            away_team,
            bet_type,
            bet_details,
            odds,
            outcome
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error
      setParlays(data || [])
    } catch (err) {
      console.error('Error fetching parlays:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      const { data, error } = await supabase
        .from('parlays')
        .select('final_outcome, profit_loss')
        .eq('user_id', user.id)

      if (error) throw error

      const total = data.length
      const wins = data.filter(p => p.final_outcome?.toLowerCase() === 'win' || p.final_outcome?.toLowerCase() === 'won').length
      const losses = data.filter(p => p.final_outcome?.toLowerCase() === 'loss' || p.final_outcome?.toLowerCase() === 'lost').length
      const pending = data.filter(p => !p.final_outcome || p.final_outcome?.toLowerCase() === 'pending').length
      const winRate = total > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : 0
      const totalProfit = data.reduce((sum, p) => sum + (parseFloat(p.profit_loss) || 0), 0)

      setStats({
        total,
        wins,
        losses,
        pending,
        winRate,
        totalProfit: totalProfit.toFixed(2)
      })
    } catch (err) {
      console.error('Error fetching stats:', err)
    }
  }

  const getStatusBadge = (status) => {
    const normalizedStatus = status?.toLowerCase()
    const badges = {
      pending: 'bg-yellow-900 text-yellow-300',
      win: 'bg-green-900 text-green-300',
      won: 'bg-green-900 text-green-300',
      loss: 'bg-red-900 text-red-300', 
      lost: 'bg-red-900 text-red-300',
      push: 'bg-gray-700 text-gray-300'
    }
    return badges[normalizedStatus] || badges.pending
  }

  const deriveParlayOutcome = (parlay) => {
    if (Array.isArray(parlay.parlay_legs) && parlay.parlay_legs.length > 0) {
      const outcomes = parlay.parlay_legs
        .map(l => l.outcome)
        .filter(Boolean);

      if (outcomes.length === 0) {
        return parlay.final_outcome || 'pending';
      }

      const hasPending = outcomes.some(o => o === 'pending');
      if (hasPending) return 'pending';

      const hasLost = outcomes.some(o => o === 'lost');
      const hasWon = outcomes.some(o => o === 'won');
      const allPush = outcomes.every(o => o === 'push');

      if (hasLost) return 'lost';
      if (allPush) return 'push';
      if (hasWon) return 'won';
    }

    return parlay.final_outcome || 'pending';
  }

  const parseLockedPlayerProp = (leg) => {
    if (!leg || !leg.pick) return null
    const betType = leg.betType || ''
    if (betType !== 'Player Props' && betType !== 'TD') return null

    const raw = leg.pick
    const match = raw.match(/^(.+?)\s+(Over|Under)\s+([\d.]+)\s+(.+)$/i)
    if (!match) return null

    const playerName = match[1].trim()
    const directionRaw = match[2]
    const lineNumber = parseFloat(match[3])
    const marketLabel = match[4].trim()

    if (!playerName || !directionRaw || Number.isNaN(lineNumber) || !marketLabel) return null

    const direction = directionRaw.charAt(0).toUpperCase() + directionRaw.slice(1).toLowerCase()
    const lineText = `${lineNumber > 0 ? '+' : ''}${lineNumber}`
    const coreText = `${playerName} ${lineText} ${marketLabel}`

    return { direction, coreText }
  }

  const handleDeleteParlay = async (parlayId) => {
    if (!user || !supabase) return
    const confirmed = window.confirm('Delete this parlay from your history? This cannot be undone.')
    if (!confirmed) return

    try {
      const { error } = await supabase
        .from('parlays')
        .delete()
        .eq('id', parlayId)
        .eq('user_id', user.id)

      if (error) throw error

      setParlays(prev => prev.filter(p => p.id !== parlayId))
      await fetchStats()
    } catch (err) {
      console.error('Error deleting parlay:', err)
    }
  }

  const handleCopySummary = (parlay) => {
    if (!parlay.metadata || !parlay.metadata.locked_picks || parlay.metadata.locked_picks.length === 0) {
      alert('No picks to copy')
      return
    }

    // Build concise summary
    const picks = parlay.metadata.locked_picks.map((leg, index) => {
      const propMeta = parseLockedPlayerProp(leg)
      let pickText = ''
      
      if (leg.betType === 'Player Props' || leg.betType === 'TD') {
        pickText = propMeta 
          ? `${propMeta.direction} ${propMeta.coreText}`
          : leg.pick
      } else {
        pickText = `${leg.pick}`
        if (leg.point != null && leg.betType === 'Spread') {
          pickText += ` ${leg.point > 0 ? '+' : ''}${leg.point}`
        }
      }

      return `${index + 1}. ${leg.awayTeam} @ ${leg.homeTeam} - ${leg.betType}: ${pickText} (${leg.odds})`
    }).join('\n')

    const summary = `${parlay.total_legs}-Leg Parlay\n` +
      `Odds: ${parlay.combined_odds} | Payout: $${parlay.potential_payout}\n` +
      `Book: ${parlay.sportsbook}\n\n` +
      `Picks:\n${picks}`

    // Copy to clipboard
    navigator.clipboard.writeText(summary).then(() => {
      alert('✅ Parlay summary copied to clipboard!')
    }).catch(err => {
      console.error('Failed to copy:', err)
      alert('❌ Failed to copy. Please try again.')
    })
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden border border-gray-700">
        {/* Header */}
        <div className="bg-gray-800 p-6 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-yellow-400">Your Dashboard</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ✕
          </button>
        </div>

        {/* Stats Summary */}
        {stats && (
          <div className="p-6 bg-gray-800/50 border-b border-gray-700">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-white">{stats.total}</div>
                <div className="text-xs text-gray-400">Total Parlays</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-400">{stats.wins}</div>
                <div className="text-xs text-gray-400">Wins</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-400">{stats.losses}</div>
                <div className="text-xs text-gray-400">Losses</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-400">{stats.pending}</div>
                <div className="text-xs text-gray-400">Pending</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-400">{stats.winRate}%</div>
                <div className="text-xs text-gray-400">Win Rate</div>
                <div className="mt-1 text-[10px] text-gray-500 px-2">
                  Ask the model how to improve <span className="italic">(under construction)</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Parlays List */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {loading ? (
            <div className="text-center py-12 text-gray-400">
              Loading your parlays...
            </div>
          ) : parlays.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p>No parlays yet. Start building!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {parlays.map(parlay => (
                <div
                  key={parlay.id}
                  className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition-all"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="text-sm text-gray-400">
                        {new Date(parlay.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                      <div className="text-lg font-bold text-white">
                        {parlay.total_legs}-Leg Parlay
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className={`px-3 py-1 rounded text-xs font-semibold ${getStatusBadge(deriveParlayOutcome(parlay))}`}>
                        {deriveParlayOutcome(parlay).toUpperCase()}
                      </span>
                      {parlay.is_lock_bet && (
                        <span className="text-yellow-400 text-xs">🔒 LOCK</span>
                      )}
                      {parlay.is_lock_bet && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleCopySummary(parlay)}
                            className="text-xs text-blue-400 hover:text-blue-200 transition-colors"
                            title="Copy summary to place bet at sportsbook"
                          >
                            📋 Copy
                          </button>
                          <button
                            onClick={() => handleDeleteParlay(parlay.id)}
                            className="text-xs text-red-400 hover:text-red-200 transition-colors"
                          >
                            🗑 Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-3 text-sm">
                    <div>
                      <span className="text-gray-400">Odds:</span>
                      <span className="text-white font-semibold ml-2">{parlay.combined_odds}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Unit Size:</span>
                      <span className="text-blue-400 font-semibold ml-2">${parlay.bet_amount || '100'}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Payout:</span>
                      <span className="text-green-400 font-semibold ml-2">${parlay.potential_payout}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Generate Mode:</span>
                      <span className="text-white ml-2">{parlay.generate_mode || parlay.risk_level}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Book:</span>
                      <span className="text-white ml-2">{parlay.sportsbook}</span>
                    </div>
                  </div>

                  {/* Compact locked picks display (new flow, with leg outcomes) */}
                  {parlay.metadata && Array.isArray(parlay.metadata.locked_picks) && parlay.metadata.locked_picks.length > 0 && (
                    <div className="border-t border-gray-700 pt-3 mt-3">
                      <div className="text-xs text-gray-400 mb-2">Locked Picks:</div>
                      <div className="space-y-1">
                        {parlay.metadata.locked_picks.map((leg, index) => {
                          const propMeta = parseLockedPlayerProp(leg)

                          // Match this locked leg with its DB-backed parlay_legs row (by leg_number)
                          const dbLeg = Array.isArray(parlay.parlay_legs)
                            ? parlay.parlay_legs.find(l => l.leg_number === index + 1)
                            : null;

                          let statusIcon = '⏳';
                          if (dbLeg?.outcome === 'won') statusIcon = '✅';
                          else if (dbLeg?.outcome === 'lost') statusIcon = '❌';
                          else if (dbLeg?.outcome === 'push') statusIcon = '↔️';

                          return (
                            <div key={index} className="flex justify-between items-center text-xs">
                              <div className="flex-1">
                                <div className="text-gray-300">
                                  {leg.awayTeam} @ {leg.homeTeam}
                                </div>
                                <div className="text-gray-400">
                                  {leg.betType}: {propMeta ? `${propMeta.direction} — ${propMeta.coreText}` : leg.pick}
                                  {leg.point != null && leg.betType === 'Spread' && (
                                    <span> {leg.point > 0 ? `+${leg.point}` : leg.point}</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-green-400 font-semibold">{leg.odds}</span>
                                <span className="text-lg">{statusIcon}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}