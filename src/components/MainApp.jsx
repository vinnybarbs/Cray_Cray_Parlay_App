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

// AI Agents Workflow Component (exact copy from legacy)
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
        {/* Header */}
        <div className="text-center mb-8 md:mb-12">
          <h2 className="text-2xl md:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-red-500 mb-2">
            How AI Agents Work:
          </h2>
        </div>
        
        {/* Circular Flow */}
        <div className="relative mx-auto w-full max-w-md md:max-w-lg" style={{ aspectRatio: '1/1' }}>
          {/* SVG for curved arrows between agents - responsive */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 400" style={{ zIndex: 1 }}>
            <defs>
              <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <polygon points="0 0, 6 3, 0 6" fill="#eab308" />
              </marker>
            </defs>
            
            {/* Clean shorter curved arrows that avoid text - responsive positioning */}
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
              <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-gray-700 flex items-center justify-center shadow-xl border-2 border-yellow-500 overflow-hidden">
                <img 
                  src={characterImages.degenerate} 
                  alt="Degenerate Gambler" 
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.parentElement.innerHTML += '<div class="text-xl md:text-2xl">🎰</div>';
                  }}
                />
              </div>
            </div>
          </div>

          {/* Carol - Left Side */}
          <div className="absolute" style={{ top: '30%', left: '20%', transform: 'translate(-50%, -50%)', zIndex: 10 }}>
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-purple-400 flex items-center justify-center shadow-xl border-2 border-yellow-500 overflow-hidden">
                <img 
                  src={characterImages.carol} 
                  alt="Carol the Coordinator" 
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.parentElement.innerHTML += '<div class="text-xl md:text-2xl">👵</div>';
                  }}
                />
              </div>
              <h3 className="font-bold text-xs md:text-sm text-purple-400 mt-1 text-center whitespace-nowrap">Carol the AI Coordinator</h3>
            </div>
          </div>

          {/* Odd-Job - Bottom Left */}
          <div className="absolute" style={{ bottom: '20%', left: '20%', transform: 'translate(-50%, 50%)', zIndex: 10 }}>
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-yellow-700 flex items-center justify-center shadow-xl border-2 border-yellow-500 overflow-hidden">
                <img 
                  src={characterImages.oddjob} 
                  alt="Odd-Job" 
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.parentElement.innerHTML += '<div class="text-xl md:text-2xl">🎩</div>';
                  }}
                />
              </div>
              <h3 className="font-bold text-xs md:text-sm text-yellow-400 mt-1 text-center whitespace-nowrap">Odd-Job the Oddsmaker</h3>
            </div>
          </div>

          {/* Andy - Right Side */}
          <div className="absolute" style={{ top: '30%', right: '20%', transform: 'translate(50%, -50%)', zIndex: 10 }}>
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-green-400 flex items-center justify-center shadow-xl border-2 border-yellow-500 overflow-hidden">
                <img 
                  src={characterImages.andy} 
                  alt="Andy the Analyst" 
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.parentElement.innerHTML += '<div class="text-xl md:text-2xl">📊</div>';
                  }}
                />
              </div>
              <h3 className="font-bold text-xs md:text-sm text-green-400 mt-1 text-center whitespace-nowrap">Andy the Analyst</h3>
            </div>
          </div>

          {/* Randy - Bottom Right */}
          <div className="absolute" style={{ bottom: '20%', right: '20%', transform: 'translate(50%, 50%)', zIndex: 10 }}>
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-blue-400 flex items-center justify-center shadow-xl border-2 border-yellow-500 overflow-hidden">
                <img 
                  src={characterImages.randy} 
                  alt="Randy the Researcher" 
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.parentElement.innerHTML += '<div class="text-xl md:text-2xl">🤓</div>';
                  }}
                />
              </div>
              <h3 className="font-bold text-xs md:text-sm text-blue-400 mt-1 text-center whitespace-nowrap">Randy the Researcher</h3>
            </div>
          </div>
        </div>

        {/* Bottom tagline */}
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-500 italic">
            Five AI agents working harder than your therapist to justify your gambling addiction
          </p>
        </div>
      </div>
    </div>
  )
}

const PhaseProgress = ({ loading, progress, timings, phaseData }) => {
  const phases = [
    { key: 'odds', label: 'Odds', icon: '📊' },
    { key: 'research', label: 'Research', icon: '🔍' },
    { key: 'analysis', label: 'Analysis', icon: '🧠' },
    { key: 'post', label: 'Post', icon: '✨' }
  ];
  
  return (
    <div className="p-3 rounded-lg bg-black bg-opacity-30 border border-gray-700">
      <div className="text-xs font-semibold text-gray-300 mb-2 text-center">Building Your Parlay</div>
      
      {/* Phase indicators */}
      <div className="flex items-center justify-between mb-2">
        {phases.map((phase, idx) => {
          const isActive = loading && progress === idx;
          const isDone = phaseData?.[phase.key]?.complete || (!loading && timings);
          
          return (
            <div key={phase.key} className="flex flex-col items-center space-y-1 flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-base transition-all ${
                isDone ? 'bg-green-600' : isActive ? 'bg-yellow-400 animate-pulse' : 'bg-gray-700'
              }`}>
                {isDone ? '✓' : phase.icon}
              </div>
              <span className={`text-xs ${isDone || isActive ? 'text-gray-300' : 'text-gray-500'}`}>
                {phase.label}
              </span>
              {isActive && (
                <span className="text-xs text-yellow-400 animate-pulse">Active</span>
              )}
            </div>
          );
        })}
      </div>
      
      {/* Detailed phase information */}
      {phaseData && !loading && (
        <div className="mt-2 pt-2 border-t border-gray-600 grid grid-cols-2 gap-1 text-xs">
          {phaseData.odds && (
            <div className="text-gray-300">
              📊 {phaseData.odds.games} games ({phaseData.odds.quality}%)
            </div>
          )}
          {phaseData.research && (
            <div className="text-gray-300">
              🔍 {phaseData.research.researched}/{phaseData.research.total} researched
            </div>
          )}
          {phaseData.analysis && (
            <div className="text-gray-300">
              🧠 {phaseData.analysis.model}
            </div>
          )}
          {phaseData.postProcessing && (
            <div className="text-gray-300">
              ✨ Validated
            </div>
          )}
        </div>
      )}
      
      {/* Timing details */}
      {timings && (
        <div className="mt-2 pt-2 border-t border-gray-600 text-xs text-gray-300">
          <div className="flex justify-between items-center">
            <span>⏱️ Total Time:</span>
            <span className="font-semibold text-green-400">
              {(timings.totalMs / 1000).toFixed(1)}s
            </span>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-gray-400">
            <div>Odds: {(timings.oddsMs / 1000).toFixed(1)}s</div>
            <div>Research: {(timings.researchMs / 1000).toFixed(1)}s</div>
            <div>Analysis: {(timings.analysisMs / 1000).toFixed(1)}s</div>
            <div>Post: {(timings.postProcessingMs / 1000).toFixed(1)}s</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default function MainApp() {
  const { user, isAuthenticated, signOut } = useAuth()
  const [showAuth, setShowAuth] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  const loadingMessages = [
    "Consulting with Vegas insiders...",
    "Bribing the refs for insider info...",
    "Sacrificing a prop bet to the degen gods...",
    "Checking if my bookie is watching...",
    "Doing complex math (counting on fingers)...",
    "Reading tea leaves and injury reports...",
    "Asking my Magic 8-Ball for advice...",
    "Channeling my inner degenerate...",
    "Calculating odds while ignoring reality...",
    "Pretending I know what I'm doing...",
    "Consulting the Bisque Boys...",
    "Crunching the numbers...",
    "Finding the spiciest picks...",
  ];

  const getRandomLoadingMessage = () => loadingMessages[Math.floor(Math.random() * loadingMessages.length)];

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
  const [progressPhase, setProgressPhase] = useState(0)
  const [phaseData, setPhaseData] = useState(null)
  const [timings, setTimings] = useState(null)

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
    // Require login to get suggestions
    if (!isAuthenticated) {
      setShowAuth(true)
      return
    }
    let progressInterval
    try {
      setLoading(true)
      setError('')

      // Update loading message every 3 seconds
      progressInterval = setInterval(() => {
        setLoadingMessage(getRandomLoadingMessage())
      }, 3000)

      const response = await fetch(`${API_BASE}/api/suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sports: selectedSports,
          betTypes: selectedBetTypes,
          numLegs,
          riskLevel,
          oddsPlatform,
          dateRange
        })
      })

      const data = await response.json()

      if (data.success && data.suggestions) {
        console.log('✅ Received suggestions:', data.suggestions.length, data.suggestions);
        setSuggestions(data.suggestions)
        // Extract timing and phase data if available
        if (data.timings) setTimings(data.timings)
        if (data.phaseData) setPhaseData(data.phaseData)
      } else {
        throw new Error('Invalid response format')
      }
    } catch (err) {
      const errorMsg = err.message || 'Failed to fetch suggestions'
      // Check if it's a "sport not in season" error
      if (errorMsg.includes('not available in cache') || errorMsg.includes('out of season')) {
        setError(`${errorMsg}\n\n✅ Available sports: NFL, NHL, Soccer (EPL)`)
      } else {
        setError(errorMsg)
      }
    } finally {
      if (progressInterval) clearInterval(progressInterval)
      setLoading(false)
      setProgressPhase(4) // Mark all complete
    }
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
          {isAuthenticated ? (
            <>
              <button
                onClick={() => setShowDashboard(true)}
                className="text-sm text-gray-300 hover:text-yellow-400"
              >
                Dashboard
              </button>
              <button
                onClick={signOut}
                className="text-sm text-gray-400 hover:text-white"
              >
                Sign Out
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-semibold"
            >
              Sign In / Sign Up
            </button>
          )}
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
          {loading ? loadingMessage : 'Get AI Suggestions'}
        </button>

        {selectedSports.length === 0 && <p className="text-xs text-center text-red-400">⚠️ Select at least one sport</p>}
        {selectedBetTypes.length === 0 && <p className="text-xs text-center text-red-400">⚠️ Select at least one bet type</p>}
      </div>

      {/* Progress Display */}
      {loading && (
        <div className="max-w-2xl mx-auto mt-6">
          <PhaseProgress loading={loading} progress={progressPhase} timings={timings} phaseData={phaseData} />
        </div>
      )}

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

      {/* Auth Modal */}
      {showAuth && <Auth onClose={() => setShowAuth(false)} />}

      {/* Dashboard Modal */}
      {showDashboard && <Dashboard onClose={() => setShowDashboard(false)} />}
    </div>
  );
}
