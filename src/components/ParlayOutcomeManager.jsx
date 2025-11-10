import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function ParlayOutcomeManager({ onClose }) {
  const { user } = useAuth();
  const [pendingParlays, setPendingParlays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState({});

  useEffect(() => {
    if (user) {
      fetchPendingParlays();
    }
  }, [user]);

  const fetchPendingParlays = async () => {
    try {
      const response = await fetch('/api/parlays/pending', {
        headers: {
          'Authorization': `Bearer ${user.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setPendingParlays(data.parlays || []);
      }
    } catch (error) {
      console.error('Error fetching pending parlays:', error);
    } finally {
      setLoading(false);
    }
  };

  const runAutomaticCheck = async () => {
    setChecking(true);
    try {
      const response = await fetch('/api/check-parlays', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Automatic check complete: ${result.message}`);
        fetchPendingParlays(); // Refresh the list
      } else {
        alert('Failed to run automatic check');
      }
    } catch (error) {
      console.error('Error running automatic check:', error);
      alert('Error running automatic check');
    } finally {
      setChecking(false);
    }
  };

  const manualUpdate = async (parlayId, outcome) => {
    setUpdating(prev => ({ ...prev, [parlayId]: true }));
    
    try {
      const response = await fetch(`/api/parlays/${parlayId}/outcome`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${user.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ outcome })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Parlay marked as ${outcome}. P&L: $${result.profitLoss}`);
        fetchPendingParlays(); // Refresh the list
      } else {
        const error = await response.json();
        alert(`Failed to update: ${error.error}`);
      }
    } catch (error) {
      console.error('Error updating parlay:', error);
      alert('Error updating parlay');
    } finally {
      setUpdating(prev => ({ ...prev, [parlayId]: false }));
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-gray-900 rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
          <div className="flex justify-center items-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-6 w-full max-w-6xl max-h-[90vh] overflow-y-auto border border-gray-700">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-yellow-400">⚡ Parlay Outcome Manager</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ✕
          </button>
        </div>

        {/* Controls */}
        <div className="mb-6 p-4 bg-gray-800 rounded-lg border border-gray-600">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Outcome Management</h3>
              <p className="text-gray-400 text-sm">
                Check pending parlays automatically or manually mark outcomes
              </p>
            </div>
            <button
              onClick={runAutomaticCheck}
              disabled={checking}
              className={`px-4 py-2 rounded font-semibold transition-all ${
                checking
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {checking ? (
                <span className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Checking...
                </span>
              ) : (
                '🔍 Run Automatic Check'
              )}
            </button>
          </div>
        </div>

        {/* Pending Parlays */}
        {pendingParlays.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-4">🎉</div>
            <h3 className="text-xl font-semibold text-white mb-2">No Pending Parlays</h3>
            <p className="text-gray-400">All your parlays have been resolved!</p>
          </div>
        ) : (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">
              Pending Parlays ({pendingParlays.length})
            </h3>
            
            {pendingParlays.map(parlay => (
              <div
                key={parlay.id}
                className="bg-gray-800 rounded-lg p-4 border border-gray-700"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-lg font-bold text-white">
                        {parlay.total_legs}-Leg Parlay
                      </span>
                      {parlay.is_lock_bet && (
                        <span className="text-yellow-400 text-sm">🔒 LOCK</span>
                      )}
                      {parlay.all_games_likely_completed && (
                        <span className="bg-green-600 text-white text-xs px-2 py-1 rounded">
                          ✅ Games Complete
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-400">
                      Created: {formatDate(parlay.created_at)} at {formatTime(parlay.created_at)}
                    </div>
                    <div className="text-sm text-gray-400">
                      Odds: {parlay.combined_odds} • Potential: ${parlay.potential_payout}
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => manualUpdate(parlay.id, 'won')}
                      disabled={updating[parlay.id]}
                      className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                    >
                      {updating[parlay.id] ? '...' : '✅ Won'}
                    </button>
                    <button
                      onClick={() => manualUpdate(parlay.id, 'lost')}
                      disabled={updating[parlay.id]}
                      className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
                    >
                      {updating[parlay.id] ? '...' : '❌ Lost'}
                    </button>
                    <button
                      onClick={() => manualUpdate(parlay.id, 'push')}
                      disabled={updating[parlay.id]}
                      className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700 disabled:opacity-50"
                    >
                      {updating[parlay.id] ? '...' : '↔️ Push'}
                    </button>
                  </div>
                </div>

                {/* Legs */}
                <div className="grid gap-3 mt-4">
                  {parlay.parlay_legs.map((leg, index) => (
                    <div
                      key={leg.id}
                      className={`p-3 rounded border ${
                        leg.likely_completed
                          ? 'bg-green-900/20 border-green-700'
                          : 'bg-yellow-900/20 border-yellow-700'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-semibold text-white mb-1">
                            Leg {index + 1}: {leg.away_team} @ {leg.home_team}
                          </div>
                          <div className="text-sm text-gray-300 mb-1">
                            {JSON.parse(leg.bet_details || '{}').description || leg.bet_type}
                          </div>
                          <div className="text-sm text-gray-400">
                            {formatDate(leg.game_date)} • Odds: {leg.odds}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-xs px-2 py-1 rounded ${
                            leg.likely_completed
                              ? 'bg-green-600 text-white'
                              : 'bg-yellow-600 text-white'
                          }`}>
                            {leg.likely_completed
                              ? `✅ Likely done (${leg.hours_since_game}h ago)`
                              : `⏳ Pending`
                            }
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Help Text */}
        <div className="mt-6 p-4 bg-blue-900/20 border border-blue-700 rounded-lg">
          <h4 className="font-semibold text-blue-300 mb-2">💡 How It Works</h4>
          <ul className="text-sm text-blue-200 space-y-1">
            <li>• <strong>Automatic Check:</strong> Fetches game results from ESPN API and determines outcomes</li>
            <li>• <strong>Manual Override:</strong> Mark parlays as Won/Lost/Push if automatic checking fails</li>
            <li>• <strong>Green badges:</strong> Games likely completed (4+ hours after game time)</li>
            <li>• <strong>Profit/Loss:</strong> Automatically calculated based on $100 bet assumption</li>
          </ul>
        </div>
      </div>
    </div>
  );
}