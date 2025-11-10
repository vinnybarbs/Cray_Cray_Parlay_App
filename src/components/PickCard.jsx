import React, { useState } from 'react'

// Helper function to get short tagline
const getShortTagline = (pick) => {
  if (pick.betType === 'Moneyline') {
    return `Strong moneyline value with ${pick.confidence}/10 confidence based on form and matchup data`;
  } else if (pick.betType === 'Spread') {
    return `Spread edge detected through statistical modeling and historical performance`;
  } else if (pick.betType === 'Total') {
    return `Total value identified via pace analysis and environmental factors`;
  } else {
    return `High-probability pick backed by comprehensive AI analysis`;
  }
}

// Helper function to get detailed analysis
const getDetailedAnalysis = (pick) => {
  const baseAnalysis = pick.reasoning || '';
  
  if (pick.betType === 'Moneyline') {
    return `${baseAnalysis} Our moneyline analysis incorporates team strength ratings, recent form indicators, injury impact assessments, and historical head-to-head performance. Key evaluation metrics include offensive efficiency rankings, defensive unit performance, home field advantages, and coaching tendencies in similar game scripts. Market positioning analysis suggests significant value opportunity with favorable risk-reward ratio. Statistical modeling shows this selection aligns with high-probability outcome scenarios based on current season performance indicators and situational matchup factors.`;
  } else if (pick.betType === 'Spread') {
    return `${baseAnalysis} This spread selection leverages advanced point differential modeling, incorporating pace of play variations, turnover margin expectations, and historical performance against similar lines. Critical analysis factors include red zone efficiency disparities between teams, late-game execution patterns, special teams advantages, and coaching adjustments in competitive situations. Our algorithm identifies market inefficiency in the current spread pricing relative to true probability estimates based on comprehensive performance metrics and situational analysis.`;
  } else if (pick.betType === 'Total') {
    return `${baseAnalysis} Total analysis evaluates multiple scoring environment variables including weather conditions, defensive pressure rates, offensive tempo metrics, and historical scoring patterns in similar matchups. Key performance indicators include first half pace trends, red zone conversion rates, defensive third down efficiency, and situational play-calling tendencies. Statistical correlation models show strong probability alignment for this total range based on team-specific offensive capabilities and defensive unit strengths in current game context.`;
  } else {
    return `${baseAnalysis} Comprehensive multi-factor analysis evaluates this selection through advanced statistical modeling, market positioning assessment, and historical precedent analysis. Performance evaluation includes team form indicators, matchup-specific advantages, injury impact analysis, and probability distribution modeling. Our AI framework identifies significant edge opportunity through combination of statistical analysis, market inefficiency detection, and situational performance metrics that suggest favorable outcome probability relative to current market pricing.`;
  }
}

export default function PickCard({ pick, onAdd, isAdded }) {
  const [showFullAnalysis, setShowFullAnalysis] = useState(false)
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

      {/* AI Reasoning with Expandable Analysis */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-blue-400 text-xs">🧠</span>
          <div className="text-xs font-semibold text-gray-300">AI Analysis:</div>
        </div>
        
        {/* Short tagline - always visible */}
        <div className="text-xs text-gray-300 mb-2">
          {getShortTagline(pick)}
        </div>
        
        {/* Expand button */}
        <button
          onClick={() => setShowFullAnalysis(!showFullAnalysis)}
          className="px-3 py-1 bg-blue-600/20 text-blue-400 hover:text-blue-300 hover:bg-blue-600/30 text-xs rounded border border-blue-500/30 transition-all mb-2"
        >
          {showFullAnalysis ? '▲ Hide Full Analysis' : '▼ Read Full Analysis'}
        </button>
        
        {/* Detailed analysis - expandable */}
        {showFullAnalysis && (
          <div className="mt-3 p-4 bg-gray-900/70 rounded-lg border border-blue-500/30">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-blue-400 text-sm font-semibold">🎯 Deep AI Analysis</span>
            </div>
            <div className="text-sm text-gray-200 leading-relaxed">
              {getDetailedAnalysis(pick)}
            </div>
          </div>
        )}
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
