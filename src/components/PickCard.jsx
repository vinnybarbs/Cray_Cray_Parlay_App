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
  
  // Always trust backend reasoning, which already includes data-backed analysis
  if (!baseAnalysis) return '';

  return baseAnalysis;
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
  // For Over/Under props, don't add + sign - it's a threshold, not a spread
  // Format: "24.5 — Breece Hall reception yds" (direction is added separately in display)
  const lineText = `${lineNumber}`;
  const coreText = `${lineText} — ${playerName} ${marketLabel}`;

  return { direction, coreText };
}

export default function PickCard({ pick, onAdd, isAdded }) {
  const [showFullAnalysis, setShowFullAnalysis] = useState(false)
  const propMeta = parsePlayerPropPick(pick)
  const formatDate = (dateString) => {
    if (!dateString) return 'TBD'
    const date = new Date(dateString)
    const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' })
    const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' })
    return `${datePart} • ${timePart}`
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
            {formatDate(pick.commenceTime || pick.gameDate)} • {pick.sport}
          </div>
          <div className="text-sm font-semibold text-gray-200">
            {pick.awayTeam} @ {pick.homeTeam}
          </div>
          {pick.matchupSnapshot && (
            <div className="mt-1 text-[11px] text-gray-300 bg-gray-900/60 rounded px-2 py-1 border border-gray-700">
              <div className="flex justify-between gap-4">
                <div className="flex-1">
                  <div className="text-[11px] font-semibold truncate">{pick.matchupSnapshot.away.team}</div>
                  <div className="text-[10px] text-gray-400">
                    {pick.matchupSnapshot.away.record}
                    {pick.matchupSnapshot.away.pct != null && ` • ${(pick.matchupSnapshot.away.pct * 100).toFixed(1)}%`}
                    {typeof pick.matchupSnapshot.away.diff === 'number' && ` • DIFF ${pick.matchupSnapshot.away.diff > 0 ? '+' : ''}${pick.matchupSnapshot.away.diff}`}
                    {pick.matchupSnapshot.away.streak && ` • ${pick.matchupSnapshot.away.streak}`}
                  </div>
                </div>
                <div className="flex-1 text-right">
                  <div className="text-[11px] font-semibold truncate">{pick.matchupSnapshot.home.team}</div>
                  <div className="text-[10px] text-gray-400">
                    {pick.matchupSnapshot.home.record}
                    {pick.matchupSnapshot.home.pct != null && ` • ${(pick.matchupSnapshot.home.pct * 100).toFixed(1)}%`}
                    {typeof pick.matchupSnapshot.home.diff === 'number' && ` • DIFF ${pick.matchupSnapshot.home.diff > 0 ? '+' : ''}${pick.matchupSnapshot.home.diff}`}
                    {pick.matchupSnapshot.home.streak && ` • ${pick.matchupSnapshot.home.streak}`}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className={`text-xs font-bold px-2 py-1 rounded ${getConfidenceColor(pick.confidence)} bg-gray-900`}>
          {pick.confidence}/10
        </div>
      </div>

      {/* Pick Details */}
      <div className="mb-3 p-3 bg-gray-900 rounded">
        <div className="flex justify-between items-start mb-2">
          <div className="flex-1">
            <div className="text-xs text-gray-400 mb-1">{pick.betType}</div>
            <div className="text-base font-bold text-white leading-tight">
              {propMeta ? (
                <span>{propMeta.direction} — {propMeta.coreText}</span>
              ) : pick.betType === 'Spread' && pick.point !== undefined && pick.point !== null ? (
                <span>{pick.pick} {typeof pick.point === 'string' ? pick.point : (pick.point > 0 ? '+' : '')}{typeof pick.point === 'number' ? pick.point : ''} <span className={`${getOddsColor(pick.odds)}`}>{pick.odds}</span></span>
              ) : pick.betType === 'Total' && pick.point !== undefined && pick.point !== null ? (
                <span>{pick.pick} {pick.point} <span className={`${getOddsColor(pick.odds)}`}>{pick.odds}</span></span>
              ) : (
                <span>{pick.pick}</span>
              )}
            </div>
          </div>
          {/* Show odds separately for non-spread/total bets */}
          {!(pick.betType === 'Spread' && pick.point) && !(pick.betType === 'Total' && pick.point) && (
            <div className={`text-xl font-bold ml-2 ${getOddsColor(pick.odds)}`}>
              {pick.odds}
            </div>
          )}
        </div>
        
        {/* Player props already show full details above - no need for redundant line */}

        {/* Show line for totals when displayed separately */}
        {!propMeta && pick.betType === 'Total' && pick.point !== undefined && pick.point !== null && (
          <div className="text-xs text-gray-400 mt-1">
            Total: {pick.point}
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

      {/* Add / Toggle Button */}
      <button
        onClick={() => onAdd(pick)}
        className={`w-full py-2 rounded font-semibold text-sm transition-all ${
          isAdded
            ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
            : 'bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 text-white'
        }`}
      >
        {isAdded ? '✓ Added to Parlay (tap to remove)' : '+ Add to Parlay'}
      </button>
    </div>
  )
}
