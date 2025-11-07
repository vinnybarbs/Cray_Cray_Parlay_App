import React from 'react'

export default function PickCard({ pick, onAdd, isAdded }) {
  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const getConfidenceColor = (confidence) => {
    if (confidence >= 8) return 'text-green-400'
    if (confidence >= 6) return 'text-yellow-400'
    return 'text-orange-400'
  }

  const getOddsColor = (odds) => {
    const numOdds = parseInt(odds)
    if (numOdds > 0) return 'text-green-400' // Underdog
    return 'text-blue-400' // Favorite
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition-all">
      {/* Header: Game Info */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <div className="text-xs text-gray-400 mb-1">
            {formatDate(pick.gameDate)} • {pick.sport}
          </div>
          <div className="text-sm font-semibold text-gray-200">
            {pick.awayTeam} @ {pick.homeTeam}
          </div>
        </div>
        <div className={`text-xs font-bold px-2 py-1 rounded ${getConfidenceColor(pick.confidence)} bg-gray-900`}>
          {pick.confidence}/10
        </div>
      </div>

      {/* Pick Details */}
      <div className="mb-3 p-3 bg-gray-900 rounded">
        <div className="flex justify-between items-center mb-2">
          <div>
            <div className="text-xs text-gray-400">{pick.betType}</div>
            <div className="text-base font-bold text-white">{pick.pick}</div>
          </div>
          <div className={`text-xl font-bold ${getOddsColor(pick.odds)}`}>
            {pick.odds}
          </div>
        </div>
        
        {/* Spread Context */}
        {pick.spread && (
          <div className="text-xs text-gray-400 mt-1">
            Spread: {pick.homeTeam} {pick.spread > 0 ? '+' : ''}{pick.spread}
          </div>
        )}
      </div>

      {/* Reasoning */}
      <div className="mb-3">
        <div className="text-xs font-semibold text-gray-300 mb-1">Why this pick:</div>
        <div className="text-xs text-gray-400 line-clamp-3">
          {pick.reasoning}
        </div>
      </div>

      {/* Research Summary */}
      {pick.researchSummary && (
        <div className="mb-3 p-2 bg-blue-900/20 border border-blue-800 rounded">
          <div className="text-xs text-blue-300">
            🔍 {pick.researchSummary}
          </div>
        </div>
      )}

      {/* Add Button */}
      <button
        onClick={() => onAdd(pick)}
        disabled={isAdded}
        className={`w-full py-2 rounded font-semibold text-sm transition-all ${
          isAdded
            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
            : 'bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 text-white'
        }`}
      >
        {isAdded ? '✓ Added to Parlay' : '+ Add to Parlay'}
      </button>
    </div>
  )
}
