import React from 'react'
import { calculateParlay, decimalToAmerican } from '../utils/oddsCalculations'

export default function ParlayBuilder({ selectedPicks, onRemove, onLockBuild, isAuthenticated }) {
  // Calculate combined odds and payout
  const calculatePayout = () => {
    if (selectedPicks.length === 0) return null

    const americanOdds = selectedPicks.map(pick => pick.odds)
    const result = calculateParlay(americanOdds, 100)
    
    return {
      combinedOdds: result.combinedOdds,
      payout: result.payout.toFixed(2),
      profit: (result.payout - 100).toFixed(2)
    }
  }

  const payout = calculatePayout()

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' })
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 sticky top-4">
      <h2 className="text-xl font-bold text-yellow-400 mb-4">Your Parlay</h2>

      {selectedPicks.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🎯</div>
          <p className="text-gray-400 text-sm">
            Select picks from the suggestions to build your parlay
          </p>
        </div>
      ) : (
        <>
          {/* Selected Picks */}
          <div className="space-y-3 mb-6 max-h-[400px] overflow-y-auto">
            {selectedPicks.map((pick, index) => (
              <div
                key={pick.id}
                className="bg-gray-900 rounded p-3 border border-gray-700"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <div className="text-xs text-gray-400 mb-1">
                      Leg {index + 1} • {formatDate(pick.gameDate)}
                    </div>
                    <div className="text-sm font-semibold text-gray-200">
                      {pick.awayTeam} @ {pick.homeTeam}
                    </div>
                  </div>
                  <button
                    onClick={() => onRemove(pick.id)}
                    className="text-red-400 hover:text-red-300 text-xs ml-2"
                  >
                    ✕
                  </button>
                </div>
                
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-xs text-gray-400">{pick.betType}</div>
                    <div className="text-sm font-bold text-white">{pick.pick}</div>
                  </div>
                  <div className="text-lg font-bold text-green-400">
                    {pick.odds}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Payout Calculator */}
          {payout && (
            <div className="bg-gradient-to-r from-green-900/30 to-blue-900/30 rounded-lg p-4 mb-4 border border-green-700">
              <div className="text-center mb-3">
                <div className="text-xs text-gray-400 mb-1">Combined Odds</div>
                <div className="text-2xl font-bold text-yellow-400">
                  {payout.combinedOdds}
                </div>
              </div>
              
              <div className="border-t border-gray-700 pt-3">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">Bet Amount:</span>
                  <span className="text-white font-semibold">$100.00</span>
                </div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">Potential Profit:</span>
                  <span className="text-green-400 font-semibold">+${payout.profit}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t border-gray-700 pt-2">
                  <span className="text-gray-300">Total Payout:</span>
                  <span className="text-green-400">${payout.payout}</span>
                </div>
              </div>
            </div>
          )}

          {/* Lock Build Button */}
          <button
            onClick={onLockBuild}
            disabled={!isAuthenticated}
            className={`w-full py-3 rounded-lg font-bold text-lg transition-all ${
              isAuthenticated
                ? 'bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white shadow-lg'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            {isAuthenticated ? '🔒 Lock Build' : '🔒 Sign In to Lock Build'}
          </button>

          {!isAuthenticated && (
            <p className="text-xs text-center text-gray-400 mt-2">
              Create an account to save your parlays
            </p>
          )}
        </>
      )}
    </div>
  )
}
