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
          parlay_legs (*)
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
      const wins = data.filter(p => p.final_outcome === 'win').length
      const losses = data.filter(p => p.final_outcome === 'loss').length
      const pending = data.filter(p => !p.final_outcome || p.final_outcome === 'pending').length
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
    const badges = {
      pending: 'bg-yellow-900 text-yellow-300',
      win: 'bg-green-900 text-green-300',
      loss: 'bg-red-900 text-red-300',
      push: 'bg-gray-700 text-gray-300'
    }
    return badges[status] || badges.pending
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
                <div className="text-2xl font-bold text-yellow-400">{stats.winRate}%</div>
                <div className="text-xs text-gray-400">Win Rate</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${parseFloat(stats.totalProfit) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ${stats.totalProfit}
                </div>
                <div className="text-xs text-gray-400">Total P/L</div>
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
                      <span className={`px-3 py-1 rounded text-xs font-semibold ${getStatusBadge(parlay.final_outcome || 'pending')}`}>
                        {(parlay.final_outcome || 'pending').toUpperCase()}
                      </span>
                      {parlay.is_lock_bet && (
                        <span className="text-yellow-400 text-xs">🔒 LOCK</span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-3 text-sm">
                    <div>
                      <span className="text-gray-400">Odds:</span>
                      <span className="text-white font-semibold ml-2">{parlay.combined_odds}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Payout:</span>
                      <span className="text-green-400 font-semibold ml-2">${parlay.potential_payout}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Risk:</span>
                      <span className="text-white ml-2">{parlay.risk_level}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Book:</span>
                      <span className="text-white ml-2">{parlay.sportsbook}</span>
                    </div>
                  </div>

                  {/* Legs Preview */}
                  {parlay.parlay_legs && parlay.parlay_legs.length > 0 && (
                    <div className="border-t border-gray-700 pt-3 mt-3">
                      <div className="text-xs text-gray-400 mb-2">Legs:</div>
                      <div className="space-y-2">
                        {parlay.parlay_legs.slice(0, 3).map(leg => (
                          <div key={leg.id} className="text-xs text-gray-300 flex justify-between">
                            <span>{leg.away_team} @ {leg.home_team}</span>
                            <span className="text-gray-400">{leg.bet_type}</span>
                          </div>
                        ))}
                        {parlay.parlay_legs.length > 3 && (
                          <div className="text-xs text-gray-500">
                            +{parlay.parlay_legs.length - 3} more legs
                          </div>
                        )}
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
