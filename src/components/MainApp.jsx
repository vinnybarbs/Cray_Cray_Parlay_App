import React, { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import Auth from './Auth'
import Dashboard from './Dashboard'
import { supabase } from '../lib/supabaseClient'
import { calculateParlay } from '../utils/oddsCalculations'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

// CheckboxGroup component for sport/bet type selection
const CheckboxGroup = ({ label, options, selectedOptions, onToggle }) => (
  <div>
    <label className="text-gray-200 text-sm font-semibold block mb-3">{label}</label>
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onToggle(opt)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            selectedOptions.includes(opt)
              ? 'bg-yellow-500 text-gray-900'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  </div>
)

// AI Agents Workflow Component (from legacy)
const AIAgentsWorkflow = () => {
  const characterImages = {
    degenerate: '/images/degenerate-gambler.png',
    carol: '/images/carol-coordinator.png',
    oddjob: '/images/oddjob.png',
    randy: '/images/randy-researcher.png',
    andy: '/images/andy-analyst.png'
  }

  return (
    <div className="max-w-2xl mx-auto mt-8 mb-8 px-4">
      <div className="bg-gradient-to-r from-gray-800 via-gray-900 to-gray-800 rounded-xl p-4 md:p-6 border border-gray-700 shadow-2xl">
        <div className="text-center mb-8 md:mb-12">
          <h2 className="text-2xl md:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-red-500 mb-2">
            How AI Agents Work:
          </h2>
        </div>
        
        <div className="relative mx-auto w-full max-w-md md:max-w-lg" style={{ aspectRatio: '1/1' }}>
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 400" style={{ zIndex: 1 }}>
            <defs>
              <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <polygon points="0 0, 6 3, 0 6" fill="#eab308" />
              </marker>
            </defs>
            
            <path d="M 192 96 Q 180 124 164 144" fill="none" stroke="#eab308" strokeWidth="2" markerEnd="url(#arrow)" className="animate-pulse" />
            <path d="M 144 168 Q 128 200 144 232" fill="none" stroke="#eab308" strokeWidth="2" markerEnd="url(#arrow)" className="animate-pulse" style={{ animationDelay: '0.2s' }} />
            <path d="M 176 264 Q 200 280 224 264" fill="none" stroke="#eab308" strokeWidth="2" markerEnd="url(#arrow)" className="animate-pulse" style={{ animationDelay: '0.4s' }} />
            <path d="M 256 232 Q 272 200 256 168" fill="none" stroke="#eab308" strokeWidth="2" markerEnd="url(#arrow)" className="animate-pulse" style={{ animationDelay: '0.6s' }} />
            <path d="M 236 144 Q 220 124 208 96" fill="none" stroke="#eab308" strokeWidth="2" markerEnd="url(#arrow)" className="animate-pulse" style={{ animationDelay: '0.8s' }} />
          </svg>

          {/* Degenerate Gambler - Top Center */}
          <div className="absolute" style={{ top: '5%', left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
            <div className="flex flex-col items-center">
              <h3 className="font-bold text-xs md:text-sm text-yellow-400 mb-1">Degenerate</h3>
              <p className="text-xs text-yellow-400 text-center mb-2">(You)</p>
              <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-gray-700 flex items-center justify-center shadow-xl border-2 border-yellow-500">
                <span className="text-2xl">🎰</span>
              </div>
            </div>
          </div>

          {/* Carol Coordinator - Left */}
          <div className="absolute" style={{ top: '30%', left: '5%', zIndex: 10 }}>
            <div className="flex flex-col items-center">
              <h3 className="font-bold text-xs md:text-sm text-blue-400 mb-1">Carol</h3>
              <p className="text-xs text-blue-300 text-center mb-2">Coordinator</p>
              <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-gray-700 flex items-center justify-center shadow-xl border-2 border-blue-500">
                <span className="text-2xl">👩‍💼</span>
              </div>
            </div>
          </div>

          {/* OddJob - Bottom Left */}
          <div className="absolute" style={{ bottom: '15%', left: '15%', zIndex: 10 }}>
            <div className="flex flex-col items-center">
              <h3 className="font-bold text-xs md:text-sm text-green-400 mb-1">OddJob</h3>
              <p className="text-xs text-green-300 text-center mb-2">Odds Agent</p>
              <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-gray-700 flex items-center justify-center shadow-xl border-2 border-green-500">
                <span className="text-2xl">📊</span>
              </div>
            </div>
          </div>

          {/* Randy Researcher - Bottom Right */}
          <div className="absolute" style={{ bottom: '15%', right: '15%', zIndex: 10 }}>
            <div className="flex flex-col items-center">
              <h3 className="font-bold text-xs md:text-sm text-purple-400 mb-1">Randy</h3>
              <p className="text-xs text-purple-300 text-center mb-2">Researcher</p>
              <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-gray-700 flex items-center justify-center shadow-xl border-2 border-purple-500">
                <span className="text-2xl">🔍</span>
              </div>
            </div>
          </div>

          {/* Andy Analyst - Right */}
          <div className="absolute" style={{ top: '30%', right: '5%', zIndex: 10 }}>
            <div className="flex flex-col items-center">
              <h3 className="font-bold text-xs md:text-sm text-red-400 mb-1">Andy</h3>
              <p className="text-xs text-red-300 text-center mb-2">Analyst</p>
              <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-gray-700 flex items-center justify-center shadow-xl border-2 border-red-500">
                <span className="text-2xl">🧠</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 space-y-3 text-sm text-gray-300">
          <p><strong className="text-yellow-400">1. You (Degenerate):</strong> Pick your sports, bet types, and risk level</p>
          <p><strong className="text-blue-400">2. Carol (Coordinator):</strong> Orchestrates the entire process</p>
          <p><strong className="text-green-400">3. OddJob (Odds Agent):</strong> Fetches live odds from sportsbooks</p>
          <p><strong className="text-purple-400">4. Randy (Researcher):</strong> Gathers news, injuries, and stats</p>
          <p><strong className="text-red-400">5. Andy (Analyst):</strong> Uses AI to rank and select best picks</p>
        </div>
      </div>
    </div>
  )
}

export default function MainApp() {
  const { user, isAuthenticated, signOut } = useAuth()
  const [showAuth, setShowAuth] = useState(!isAuthenticated)
  const [showDashboard, setShowDashboard] = useState(false)

  // Form state
  const [selectedSports, setSelectedSports] = useState([])
  const [selectedBetTypes, setSelectedBetTypes] = useState([])
  const [numLegs, setNumLegs] = useState(3)
  const [riskLevel, setRiskLevel] = useState('Medium')
  const [oddsPlatform, setOddsPlatform] = useState('DraftKings')
  const [dateRange, setDateRange] = useState(1)

  // Suggestions state
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Builder state
  const [selectedPicks, setSelectedPicks] = useState([])

  const sports = ['NFL', 'NCAAF', 'NBA', 'MLB', 'NHL', 'Soccer', 'PGA/Golf', 'Tennis', 'UFC']
  const betTypes = ['Moneyline/Spread', 'Player Props', 'TD Props', 'Totals (O/U)', 'Team Props']
  const sportsbooks = ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'Bet365']
  const riskLevels = ['Low', 'Medium', 'High']

  const toggleSport = (sport) => {
    setSelectedSports(prev =>
      prev.includes(sport) ? prev.filter(s => s !== sport) : [...prev, sport]
    )
  }

  const toggleBetType = (type) => {
    setSelectedBetTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    )
  }

  const fetchSuggestions = async () => {
    setLoading(true)
    setError('')
    setSuggestions([])
    setSelectedPicks([])

    try {
      const response = await fetch(`${API_BASE}/api/suggest-picks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedSports,
          selectedBetTypes,
          numLegs,
          riskLevel,
          oddsPlatform,
          dateRange
        })
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json()

      if (data.success && data.suggestions) {
        setSuggestions(data.suggestions)
      } else {
        throw new Error('Invalid response format')
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch suggestions')
    } finally {
      setLoading(false)
    }
  }

  const togglePickSelection = (pick) => {
    setSelectedPicks(prev => {
      const isSelected = prev.find(p => p.id === pick.id)
      if (isSelected) {
        return prev.filter(p => p.id !== pick.id)
      } else {
        return [...prev, pick]
      }
    })
  }

  const calculatePayout = () => {
    if (selectedPicks.length === 0) return null
    const americanOdds = selectedPicks.map(p => p.odds)
    const result = calculateParlay(americanOdds, 100)
    return {
      combinedOdds: result.combinedOdds,
      payout: result.payout.toFixed(2),
      profit: (result.payout - 100).toFixed(2)
    }
  }

  const handleLockBuild = async () => {
    if (!supabase) {
      alert('Database not configured')
      return
    }

    try {
      const americanOdds = selectedPicks.map(p => p.odds)
      const result = calculateParlay(americanOdds, 100)

      const { data: parlayData, error: parlayError } = await supabase
        .from('parlays')
        .insert({
          user_id: user.id,
          ai_model: 'gpt-4o-mini',
          risk_level: riskLevel,
          sportsbook: oddsPlatform,
          preference_type: selectedBetTypes.join(','),
          total_legs: selectedPicks.length,
          combined_odds: result.combinedOdds,
          potential_payout: result.payout,
          is_lock_bet: true,
          status: 'pending'
        })
        .select()
        .single()

      if (parlayError) throw parlayError

      const legs = selectedPicks.map((pick, index) => ({
        parlay_id: parlayData.id,
        leg_number: index + 1,
        game_date: new Date(pick.gameDate).toISOString().split('T')[0],
        sport: pick.sport,
        home_team: pick.homeTeam,
        away_team: pick.awayTeam,
        bet_type: pick.betType,
        bet_details: {
          pick: pick.pick,
          point: pick.point,
          spread: pick.spread
        },
        odds: pick.odds,
        confidence: pick.confidence,
        reasoning: pick.reasoning
      }))

      const { error: legsError } = await supabase
        .from('parlay_legs')
        .insert(legs)

      if (legsError) throw legsError

      alert('✅ Parlay locked and saved!')
      setSelectedPicks([])
      setSuggestions([])
    } catch (err) {
      alert(`Failed to save parlay: ${err.message}`)
    }
  }

  const payout = calculatePayout()

  // Show auth modal if not authenticated
  if (!isAuthenticated) {
    return <Auth onClose={() => {}} />
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-4">
      {/* Header */}
      <header className="flex flex-col items-center justify-center py-6 mb-6 bg-gray-800 rounded-2xl shadow-2xl relative">
        <h1 className="text-4xl font-extrabold tracking-tight mt-2 text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-red-500">
          Cray Cray
        </h1>
        <p className="text-xl font-medium text-gray-300">for Parlays</p>

        {/* User menu */}
        <div className="absolute top-4 right-4 flex items-center gap-3">
          <button
            onClick={() => setShowDashboard(true)}
            className="text-sm text-gray-300 hover:text-yellow-400"
          >
            📊 Dashboard
          </button>
          <button
            onClick={signOut}
            className="text-sm text-gray-400 hover:text-white"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Configuration */}
      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <CheckboxGroup
            label="1. Sport (Or Multiple)"
            options={sports}
            selectedOptions={selectedSports}
            onToggle={toggleSport}
          />
          <CheckboxGroup
            label="2. Bet-Type/Focus (Or Multiple)"
            options={betTypes}
            selectedOptions={selectedBetTypes}
            onToggle={toggleBetType}
          />
        </div>

        <div>
          <label className="text-gray-200 text-sm font-semibold block mb-3">
            3. Game Date Range: <span className="text-yellow-400 text-lg font-bold">{dateRange === 1 ? '1 Day' : `${dateRange} Days`}</span>
          </label>
          <input
            type="range"
            min="1"
            max="4"
            value={dateRange}
            onChange={(e) => setDateRange(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1 Day</span>
            <span>4 Days</span>
          </div>
        </div>

        <div>
          <label className="text-gray-200 text-sm font-semibold block mb-3">
            4. Number of Legs: <span className="text-yellow-400 text-lg font-bold">{numLegs}</span>
          </label>
          <input
            type="range"
            min="1"
            max="10"
            value={numLegs}
            onChange={(e) => setNumLegs(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1 Leg</span>
            <span>10 Legs</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="text-gray-200 text-sm font-semibold block mb-3">5. Risk Level</label>
            <div className="flex gap-2">
              {riskLevels.map(level => (
                <button
                  key={level}
                  onClick={() => setRiskLevel(level)}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    riskLevel === level
                      ? 'bg-yellow-500 text-gray-900'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-gray-200 text-sm font-semibold block mb-3">6. Sportsbook</label>
            <select
              value={oddsPlatform}
              onChange={(e) => setOddsPlatform(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white"
            >
              {sportsbooks.map(book => (
                <option key={book} value={book}>{book}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={fetchSuggestions}
          disabled={loading || selectedSports.length === 0 || selectedBetTypes.length === 0}
          className={`w-full py-4 mt-4 font-bold text-lg rounded-xl shadow-2xl transition duration-300 transform active:scale-95 ${
            loading || selectedSports.length === 0 || selectedBetTypes.length === 0
              ? 'bg-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600'
          }`}
        >
          {loading ? '🔄 Getting Suggestions...' : '🎯 Get AI Suggestions'}
        </button>

        {selectedSports.length === 0 && <p className="text-xs text-center text-red-400">⚠️ Select at least one sport</p>}
        {selectedBetTypes.length === 0 && <p className="text-xs text-center text-red-400">⚠️ Select at least one bet type</p>}
      </div>

      {/* Error Display */}
      {error && (
        <div className="max-w-2xl mx-auto mt-6 bg-red-900 border border-red-700 rounded-lg p-4">
          <p className="text-red-200">❌ {error}</p>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="max-w-2xl mx-auto mt-8">
          <h2 className="text-2xl font-bold mb-4 text-yellow-400">
            AI Suggestions ({suggestions.length})
          </h2>
          <p className="text-sm text-gray-400 mb-4">
            Tap picks to add them to your parlay builder below
          </p>

          <div className="space-y-3">
            {suggestions.map(pick => {
              const isSelected = selectedPicks.find(p => p.id === pick.id)
              return (
                <div
                  key={pick.id}
                  onClick={() => togglePickSelection(pick)}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-yellow-900 border-yellow-500'
                      : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="text-xs text-gray-400 mb-1">
                        {new Date(pick.gameDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} • {pick.sport}
                      </div>
                      <div className="text-sm font-semibold text-gray-200">
                        {pick.awayTeam} @ {pick.homeTeam}
                      </div>
                    </div>
                    <div className="text-xs font-bold px-2 py-1 rounded bg-gray-900 text-yellow-400">
                      {pick.confidence}/10
                    </div>
                  </div>

                  <div className="flex justify-between items-center mb-2 p-2 bg-gray-900 rounded">
                    <div>
                      <div className="text-xs text-gray-400">{pick.betType}</div>
                      <div className="text-base font-bold text-white">{pick.pick}</div>
                    </div>
                    <div className="text-xl font-bold text-green-400">
                      {pick.odds}
                    </div>
                  </div>

                  {pick.spread && (
                    <div className="text-xs text-gray-400 mb-2">
                      Spread: {pick.homeTeam} {pick.spread > 0 ? '+' : ''}{pick.spread}
                    </div>
                  )}

                  <div className="text-xs text-gray-400">
                    {pick.reasoning}
                  </div>

                  {isSelected && (
                    <div className="mt-2 text-xs text-yellow-400 font-semibold">
                      ✓ Added to parlay
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Parlay Builder */}
      {selectedPicks.length > 0 && (
        <div className="max-w-2xl mx-auto mt-8 bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 className="text-xl font-bold text-yellow-400 mb-4">
            Your Parlay ({selectedPicks.length} picks)
          </h2>

          <div className="space-y-2 mb-4">
            {selectedPicks.map((pick, index) => (
              <div key={pick.id} className="flex justify-between items-center p-2 bg-gray-900 rounded">
                <div className="flex-1">
                  <div className="text-xs text-gray-400">Leg {index + 1}</div>
                  <div className="text-sm font-semibold">{pick.pick}</div>
                </div>
                <div className="text-lg font-bold text-green-400">{pick.odds}</div>
              </div>
            ))}
          </div>

          {payout && (
            <div className="bg-gradient-to-r from-green-900/30 to-blue-900/30 rounded-lg p-4 mb-4 border border-green-700">
              <div className="text-center mb-3">
                <div className="text-xs text-gray-400 mb-1">Combined Odds</div>
                <div className="text-2xl font-bold text-yellow-400">
                  {payout.combinedOdds}
                </div>
              </div>

              <div className="border-t border-gray-700 pt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Bet Amount:</span>
                  <span className="text-white font-semibold">$100.00</span>
                </div>
                <div className="flex justify-between">
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

          <button
            onClick={handleLockBuild}
            className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white py-3 rounded-lg font-bold text-lg shadow-lg"
          >
            🔒 Lock Build
          </button>
        </div>
      )}

      {/* AI Agents Workflow */}
      <AIAgentsWorkflow />

      {/* Dashboard Modal */}
      {showDashboard && <Dashboard onClose={() => setShowDashboard(false)} />}
    </div>
  )
}
