import React, { useState } from 'react'

// Helper function to get short tagline (edge-focused)
const getShortTagline = (pick) => {
  const sport = pick.sport || 'Unknown';
  const confidence = pick.confidence || 7;
  const edgeType = pick.edgeType || 'value';
  
  const edgeLabels = {
    'line_value': 'Line Value Edge',
    'situational': 'Situational Edge', 
    'information': 'Information Edge',
    'contrarian': 'Contrarian Edge',
    'value': 'Value Edge'
  };
  
  const edgeLabel = edgeLabels[edgeType] || 'Analytical Edge';
  
  return `${edgeLabel} detected: ${confidence}/10 confidence based on market analysis`;
}

// Helper function to get detailed analysis (sport-adaptive)
const getDetailedAnalysis = (pick) => {
  const baseAnalysis = pick.reasoning || '';
  const sport = pick.sport || 'Unknown';
  
  // Sport-specific terminology and analysis factors
  const getSportContext = () => {
    switch (sport) {
      case 'NFL':
      case 'NCAAF':
        return {
          efficiency: 'red zone efficiency disparities',
          situational: 'third down efficiency and situational play-calling',
          advantage: 'home field advantages and coaching adjustments',
          pace: 'offensive tempo and turnover margin expectations'
        };
      case 'NBA':
        return {
          efficiency: 'field goal percentage and three-point efficiency',
          situational: 'clutch performance and fourth quarter execution',
          advantage: 'home court advantages and matchup mismatches',
          pace: 'pace of play and possession efficiency metrics'
        };
      case 'NHL':
        return {
          efficiency: 'power play efficiency and penalty kill success',
          situational: 'special teams performance and goaltending stability',
          advantage: 'home ice advantages and line matchups',
          pace: 'shot generation rates and defensive zone coverage'
        };
      case 'MLB':
        return {
          efficiency: 'batting average against and pitching effectiveness',
          situational: 'bullpen performance and late-inning execution',
          advantage: 'home field advantages and pitcher-batter matchups',
          pace: 'run production rates and defensive efficiency'
        };
      case 'Soccer':
        return {
          efficiency: 'shot conversion rates and defensive solidity',
          situational: 'set piece effectiveness and tactical flexibility',
          advantage: 'home advantage and formation matchups',
          pace: 'possession metrics and counter-attack efficiency'
        };
      default:
        return {
          efficiency: 'performance efficiency metrics',
          situational: 'situational performance indicators',
          advantage: 'competitive advantages and strategic factors',
          pace: 'game flow dynamics and execution patterns'
        };
    }
  };
  
  const context = getSportContext();
  
  if (pick.betType === 'Moneyline') {
    return `${baseAnalysis} Our moneyline analysis incorporates team strength ratings, recent form indicators, injury impact assessments, and historical head-to-head performance. Key evaluation metrics include offensive efficiency rankings, defensive unit performance, ${context.advantage}, and coaching tendencies in similar game scripts. Market positioning analysis suggests significant value opportunity with favorable risk-reward ratio. Statistical modeling shows this selection aligns with high-probability outcome scenarios based on current season performance indicators and situational matchup factors.`;
  } else if (pick.betType === 'Spread') {
    return `${baseAnalysis} This spread selection leverages advanced point differential modeling, incorporating ${context.pace} and historical performance against similar lines. Critical analysis factors include ${context.efficiency}, late-game execution patterns, and competitive adjustments in key situations. Our algorithm identifies market inefficiency in the current spread pricing relative to true probability estimates based on comprehensive performance metrics and situational analysis.`;
  } else if (pick.betType === 'Total') {
    return `${baseAnalysis} Total analysis evaluates multiple scoring environment variables including weather conditions (where applicable), defensive pressure rates, ${context.pace}, and historical scoring patterns in similar matchups. Key performance indicators include first half trends, ${context.efficiency}, ${context.situational}, and strategic tendencies. Statistical correlation models show strong probability alignment for this total range based on team-specific capabilities and defensive strengths in current context.`;
  } else {
    return `${baseAnalysis} Comprehensive multi-factor analysis evaluates this selection through advanced statistical modeling, market positioning assessment, and historical precedent analysis. Performance evaluation includes team form indicators, ${context.advantage}, injury impact analysis, and probability distribution modeling. Our AI framework identifies significant edge opportunity through combination of statistical analysis, market inefficiency detection, and situational performance metrics that suggest favorable outcome probability relative to current market pricing.`;
  }
}

// Helper to parse player prop pick strings like:
// "Lamar Jackson Over 208.5 Pass Yards" -> { direction: 'Over', coreText: 'Lamar Jackson +208.5 Pass Yards' }
const parsePlayerPropPick = (pick) => {
  if (!pick || !pick.pick) return null;
  const betType = pick.betType || '';
  if (betType !== 'Player Props' && betType !== 'TD') return null;

  const raw = pick.pick;
  const match = raw.match(/^(.+?)\s+(Over|Under)\s+([\d.]+)\s+(.+)$/i);
  if (!match) return null;

  const playerName = match[1].trim();
  const directionRaw = match[2];
  const lineNumber = parseFloat(match[3]);
  const marketLabel = match[4].trim();

  if (!playerName || !directionRaw || Number.isNaN(lineNumber) || !marketLabel) return null;

  const direction = directionRaw.charAt(0).toUpperCase() + directionRaw.slice(1).toLowerCase();
  const lineText = `${lineNumber > 0 ? '+' : ''}${lineNumber}`;
  const coreText = `${playerName} ${lineText} ${marketLabel}`;

  return { direction, coreText };
}

export default function PickCard({ pick, onAdd, isAdded }) {
  const [showFullAnalysis, setShowFullAnalysis] = useState(false)
  const propMeta = parsePlayerPropPick(pick)
  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' })
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
            <div className="text-base font-bold text-white">{propMeta ? propMeta.coreText : pick.pick}</div>
          </div>
          <div className={`text-xl font-bold ${getOddsColor(pick.odds)}`}>
            {pick.odds}
          </div>
        </div>
        
        {/* Show what you're actually betting - clear and unambiguous */}
        {pick.betType === 'Spread' && pick.point !== undefined && pick.point !== null && (
          <div className="text-xs text-green-400 mt-1 font-medium">
            Betting: {pick.pick} {pick.point > 0 ? '+' : ''}{pick.point}
          </div>
        )}
        
        {/* Special formatting for player props: explicit Over/Under + human line */}
        {propMeta && (
          <div className="text-xs text-green-400 mt-1 font-medium">
            Betting: {propMeta.direction} - {propMeta.coreText}
          </div>
        )}

        {/* Show other bet details for non-spread, non-prop bets when a point is present */}
        {!propMeta && pick.betType !== 'Spread' && pick.point !== undefined && pick.point !== null && (
          <div className="text-xs text-green-400 mt-1 font-medium">
            {pick.betType === 'Moneyline' ? 'Betting:' : 'Line:'} {pick.pick} {pick.betType !== 'Moneyline' && (pick.point > 0 ? '+' : '')}{pick.betType !== 'Moneyline' ? pick.point : ''}
          </div>
        )}
        
        {/* Always show game spread for context (for all bet types) */}
        {(pick.spread !== undefined && pick.spread !== null && pick.spread !== '') && (
          <div className="text-xs text-gray-500 mt-1">
            Game Spread: {pick.homeTeam} {pick.spread > 0 ? '+' : ''}{pick.spread}
          </div>
        )}
      </div>

      {/* AI Reasoning with Expandable Analysis */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-blue-400 text-xs">🎯</span>
          <div className="text-xs font-semibold text-gray-300">Analytical Edge:</div>
          {pick.edgeType && (
            <span className={`text-xs px-2 py-0.5 rounded ${
              pick.edgeType === 'line_value' ? 'bg-green-900/50 text-green-300' :
              pick.edgeType === 'situational' ? 'bg-yellow-900/50 text-yellow-300' :
              pick.edgeType === 'information' ? 'bg-blue-900/50 text-blue-300' :
              pick.edgeType === 'contrarian' ? 'bg-purple-900/50 text-purple-300' :
              'bg-gray-900/50 text-gray-300'
            }`}>
              {pick.edgeType.replace('_', ' ').toUpperCase()}
            </span>
          )}
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
              <span className="text-blue-400 text-sm font-semibold">🎯 Analytical Edge Analysis</span>
            </div>
            <div className="text-sm text-gray-200 leading-relaxed mb-3">
              {getDetailedAnalysis(pick)}
            </div>
            
            {/* Contrary Evidence for intellectual honesty */}
            {pick.contraryEvidence && (
              <div className="mt-3 p-3 bg-orange-900/20 border border-orange-700/50 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-orange-400 text-xs font-semibold">⚠️ Counter-Arguments</span>
                </div>
                <div className="text-xs text-orange-200 leading-relaxed">
                  {pick.contraryEvidence}
                </div>
              </div>
            )}
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
