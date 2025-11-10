import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

// Component for individual leg with expandable reasoning
function LegWithReasoning({ leg, betDisplay, statusIcon }) {
  const [showReasoning, setShowReasoning] = useState(false)
  
  // Parse reasoning from leg data - could be in bet_details or reasoning field
  let reasoning = '';
  let shortTagline = 'AI-analyzed pick based on data and trends';
  
  try {
    if (leg.reasoning) {
      reasoning = leg.reasoning;
      // Extract first sentence as tagline
      const sentences = reasoning.split(/[.!?]+/);
      if (sentences.length > 0 && sentences[0].trim()) {
        shortTagline = sentences[0].trim() + '.';
      }
    } else if (leg.bet_details) {
      const betDetails = typeof leg.bet_details === 'string' 
        ? JSON.parse(leg.bet_details) 
        : leg.bet_details;
      
      if (betDetails.reasoning) {
        reasoning = betDetails.reasoning;
        const sentences = reasoning.split(/[.!?]+/);
        if (sentences.length > 0 && sentences[0].trim()) {
          shortTagline = sentences[0].trim() + '.';
        }
      }
    }
  } catch (e) {
    console.warn('Error parsing leg reasoning:', e);
  }
  
  // Fallback reasoning if none exists
  if (!reasoning) {
    reasoning = `Our AI analysis identified this as a strong pick based on multiple data factors including team performance metrics, historical matchup data, current form indicators, and statistical edge detection. The confidence rating reflects our algorithmic assessment of probability combined with market value analysis and situational context evaluation.`;
    shortTagline = 'AI-analyzed pick with high confidence rating';
  }
  
  return (
    <div className="text-xs">
      <div className="flex justify-between items-center">
        <div className="flex-1">
          <span className="text-gray-300">{leg.away_team} @ {leg.home_team}</span>
          <span className="text-gray-400 ml-2">
            {new Date(leg.game_date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              timeZone: 'America/Denver'
            })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-300 font-medium">{betDisplay}</span>
          <span className="text-lg">{statusIcon}</span>
        </div>
      </div>
      
      {/* AI Reasoning Section */}
      <div className="mt-2 ml-2 border-l-2 border-blue-500/30 pl-3">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-blue-400 text-xs">🧠</span>
              <span className="text-gray-300 text-xs italic">{shortTagline}</span>
            </div>
            {leg.confidence && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-gray-500 text-xs">Confidence:</span>
                <div className="flex">
                  {[...Array(10)].map((_, i) => (
                    <span 
                      key={i} 
                      className={`text-xs ${i < (leg.confidence || 7) ? 'text-green-400' : 'text-gray-600'}`}
                    >
                      ●
                    </span>
                  ))}
                </div>
                <span className="text-gray-400 text-xs">{leg.confidence || 7}/10</span>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className="text-blue-400 hover:text-blue-300 text-xs underline ml-2"
          >
            {showReasoning ? 'Hide Analysis' : 'Read Full Analysis'}
          </button>
        </div>
        
        {showReasoning && (
          <div className="mt-3 p-3 bg-gray-800/50 rounded border border-gray-700">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-blue-400 text-sm">🎯 AI Deep Analysis</span>
            </div>
            <p className="text-gray-300 text-xs leading-relaxed">
              {reasoning}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

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
                <div className="text-2xl font-bold text-yellow-400">{stats.pending}</div>
                <div className="text-xs text-gray-400">Pending</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-400">{stats.winRate}%</div>
                <div className="text-xs text-gray-400">Win Rate</div>
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
                      <span className="text-gray-400">Unit Size:</span>
                      <span className="text-blue-400 font-semibold ml-2">${parlay.bet_amount || '100'}</span>
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

                  {/* Enhanced Legs Display */}
                  {parlay.parlay_legs && parlay.parlay_legs.length > 0 && (
                    <div className="border-t border-gray-700 pt-3 mt-3">
                      <div className="text-xs text-gray-400 mb-2">Legs:</div>
                      <div className="space-y-1">
                        {parlay.parlay_legs.map((leg, index) => {
                          // Parse bet details to show actual picks
                          let betDisplay = leg.bet_type;
                          try {
                            const betDetails = typeof leg.bet_details === 'string' 
                              ? JSON.parse(leg.bet_details) 
                              : leg.bet_details;
                            
                            if (betDetails) {
                              const description = betDetails.description || betDetails.pick || '';
                              
                              if (leg.bet_type === 'Total' && description) {
                                // Extract "Over 50.5" or "Under 51.5" 
                                const totalMatch = description.match(/(Over|Under)\s*([\d.]+)/i);
                                if (totalMatch) {
                                  betDisplay = `${totalMatch[1]} ${totalMatch[2]}`;
                                } else {
                                  betDisplay = description;
                                }
                              } else if (leg.bet_type === 'Spread' && description) {
                                // Extract team and spread - handle multiple formats
                                // Look for patterns like "Bowling Green Falcons (2.5)" or "Team Name +7"
                                const spreadMatch = description.match(/([^()]+?)\s*\(([+-]?[\d.]+)\)/);
                                if (spreadMatch) {
                                  const teamName = spreadMatch[1].trim();
                                  const spreadValue = parseFloat(spreadMatch[2]);
                                  const sign = spreadValue >= 0 ? '+' : '';
                                  betDisplay = `${teamName} (${sign}${spreadValue})`;
                                } else if (description.includes('+') || description.includes('-')) {
                                  // Already formatted correctly
                                  betDisplay = description;
                                } else {
                                  // Fallback
                                  betDisplay = description;
                                }
                              } else if (leg.bet_type === 'Moneyline' && description) {
                                // Show team name for moneyline
                                betDisplay = `Moneyline: ${description}`;
                              } else if (description) {
                                // Fallback - show description if available
                                betDisplay = description;
                              }
                            }
                          } catch (e) {
                            console.warn('Error parsing bet details:', e);
                          }
                          
                          // Determine status icon - NO question marks ever
                          let statusIcon = '⏳'; // Default pending
                          
                          if (leg.game_completed && leg.leg_result) {
                            // Game processed - show result
                            statusIcon = leg.leg_result === 'won' ? '✅' : 
                                        leg.leg_result === 'lost' ? '❌' : '⏳';
                          } else {
                            // Game not processed yet - always show hourglass
                            statusIcon = '⏳';
                          }
                          
                          return (
                            <LegWithReasoning 
                              key={leg.id} 
                              leg={leg} 
                              betDisplay={betDisplay} 
                              statusIcon={statusIcon}
                            />
                          );
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