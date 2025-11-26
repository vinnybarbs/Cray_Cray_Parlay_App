import React, { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import Auth from './Auth'
import Dashboard from './Dashboard'
import PickCard from './PickCard'
import { supabase } from '../lib/supabaseClient'
import { calculateParlay } from '../utils/oddsCalculations'

// API_BASE defaults to Railway production URL; override with VITE_API_BASE_URL env var
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://craycrayparlayapp-production.up.railway.app'
const DEFAULT_SUGGESTION_COUNT = 12

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
  const [showNavMenu, setShowNavMenu] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showWeeklySuggestions, setShowWeeklySuggestions] = useState(false);

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
  const [generationMode, setGenerationMode] = useState('AI Edge Advantages')
  const [riskLevel, setRiskLevel] = useState('Medium')
  const [oddsPlatform, setOddsPlatform] = useState('DraftKings')
  const [dateRange, setDateRange] = useState(1)
  const [unitSize, setUnitSize] = useState(25) // Default to $25 unit

  // Suggestions state
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [alert, setAlert] = useState(null)
  const [progressPhase, setProgressPhase] = useState(0)
  const [phaseData, setPhaseData] = useState(null)
  const [timings, setTimings] = useState(null)

  // Builder state
  const [selectedPicks, setSelectedPicks] = useState([])
  const [userWinRate, setUserWinRate] = useState(null)
  const [modelSuccessRate, setModelSuccessRate] = useState(null)
  const [improvementAdvice, setImprovementAdvice] = useState('')
  const [lockMessage, setLockMessage] = useState('')

  const sports = ['NFL', 'NCAAF', 'NBA', 'MLB', 'NHL', 'Soccer', 'PGA/Golf', 'Tennis', 'UFC']
  const betTypes = ['Moneyline/Spread', 'Player Props', 'TD Props', 'Totals (O/U)', 'Team Props']
  // Use bookmaker names that match server validation (MGM expected, not 'BetMGM')
  // Limit sportsbook choices to DraftKings and FanDuel only
  const sportsbooks = ['DraftKings', 'FanDuel']
  const generationModes = ['Heavy Favorites', 'AI Edge Advantages', 'Top Picks of the Day']

  // Keep internal riskLevel mapped from the selected generation mode so existing
  // backend/DB behavior continues to work without exposing Low/Medium/High directly.
  useEffect(() => {
    if (generationMode === 'Heavy Favorites') {
      setRiskLevel('Low');
    } else if (generationMode === 'AI Edge Advantages') {
      setRiskLevel('Medium');
    } else if (generationMode === 'Top Picks of the Day') {
      setRiskLevel('Medium');
    }
  }, [generationMode]);

  useEffect(() => {
    if (!isAuthenticated || !user || !supabase) return;
    let cancelled = false;
    const loadStats = async () => {
      try {
        const { data, error } = await supabase
          .from('parlays')
          .select('final_outcome')
          .eq('user_id', user.id);
        if (error || !data || cancelled) return;
        const wins = data.filter(p => p.final_outcome && ['win', 'won'].includes(p.final_outcome.toLowerCase())).length;
        const losses = data.filter(p => p.final_outcome && ['loss', 'lost'].includes(p.final_outcome.toLowerCase())).length;
        const decided = wins + losses;
        if (decided > 0) {
          const rate = ((wins / decided) * 100).toFixed(1);
          setUserWinRate(rate);
        } else {
          setUserWinRate(null);
        }
      } catch (e) {
      }
    };
    loadStats();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user]);

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

    setLoading(true)
    setError('')
    setSuggestions([])
    setAlert(null)
    setLoadingMessage(getRandomLoadingMessage())
    setSelectedPicks([])
    setLockMessage('')
    setProgressPhase(0)
    setPhaseData(null)

    // Simulate progress through phases
    const progressInterval = setInterval(() => {
      setProgressPhase(prev => (prev < 3 ? prev + 1 : prev))
    }, 2000) // Advance every 2 seconds

    try {
      // Add 120 second timeout (research + AI can take time)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      
      const response = await fetch(`${API_BASE}/api/suggest-picks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedSports,
          selectedBetTypes,
          suggestionCount: DEFAULT_SUGGESTION_COUNT,
          riskLevel,
          oddsPlatform,
          dateRange
        }),
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json()

      if (data.success && data.suggestions) {
        console.log('✅ Received suggestions:', data.suggestions.length, data.suggestions);
        setSuggestions(data.suggestions)
        
        // Set alert if provided
        if (data.alert) {
          setAlert(data.alert)
        }
        
        // Extract timing and phase data if available
        if (data.timings) {
          setTimings(data.timings)
        }
        if (data.phaseData) {
          setPhaseData(data.phaseData)
        }
      } else {
        throw new Error('Invalid response format')
      }
    } catch (err) {
      const errorMsg = err.message || 'Failed to fetch suggestions';
      // Check if it's a "sport not in season" error
      if (errorMsg.includes('not available in cache') || errorMsg.includes('out of season')) {
        setError(`${errorMsg}\n\n✅ Available sports: NFL, NHL, Soccer (EPL)`);
      } else {
        setError(errorMsg);
      }
    } finally {
      clearInterval(progressInterval)
      setLoading(false)
      setProgressPhase(4) // Mark all complete
    }
  }

  const handleAskModelImprove = () => {
    if (userWinRate == null) {
      setImprovementAdvice('Once we have enough completed parlays, this will give tailored advice on how to adjust leg count, odds profile, and bet types.');
      return;
    }
    const rate = parseFloat(userWinRate);
    if (Number.isNaN(rate)) {
      setImprovementAdvice('We need more completed bets before giving meaningful advice.');
    } else if (rate < 30) {
      setImprovementAdvice('Your hit rate is low. Consider fewer legs per parlay, prioritizing heavy favorites and limiting long-shot props. Use Heavy Favorites mode for a while and keep unit size consistent.');
    } else if (rate < 50) {
      setImprovementAdvice('You are hitting some builds but leaving value on the table. Try mixing Heavy Favorites with a few AI Edge Advantages, and avoid stacking too many correlated legs in one ticket.');
    } else {
      setImprovementAdvice('Your builds are performing well. Focus on consistency: keep unit sizes steady, avoid chasing losses, and use Top Picks of the Day only when the reasoning is very strong.');
    }
  };

  const togglePickSelection = (pick) => {
    setSelectedPicks(prev => {
      const isSelected = prev.find(p => p.id === pick.id)
      if (isSelected) {
        return prev.filter(p => p.id !== pick.id)
      } else {
        return [...prev, pick]
      }
    })
    // Any change to the current build should clear the previous lock message
    setLockMessage('')
  }

  const calculatePayout = () => {
    if (selectedPicks.length === 0) return null
    const americanOdds = selectedPicks.map(p => p.odds)
    const result = calculateParlay(americanOdds, unitSize)
    return {
      combinedOdds: result.combinedOdds,
      payout: result.payout.toFixed(2),
      profit: (result.payout - unitSize).toFixed(2)
    }
  }

  const handleLockBuild = async () => {
    if (!supabase) {
      window.alert('Database not configured')
      return
    }

    try {
      const americanOdds = selectedPicks.map(p => p.odds)
      const result = calculateParlay(americanOdds, unitSize)
      const preferenceType = selectedBetTypes.join(',').slice(0, 20)
      const generateMode = generationMode
      const lockedPicks = selectedPicks.map((p, index) => ({
        leg_number: index + 1,
        gameDate: p.gameDate,
        sport: p.sport,
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        betType: p.betType,
        pick: p.pick,
        point: p.point,
        spread: p.spread,
        odds: p.odds
      }))

      const { data: parlayData, error: parlayError } = await supabase
        .from('parlays')
        .insert({
          user_id: user.id,
          ai_model: 'gpt-4o-mini',
          generate_mode: generateMode,
          sportsbook: oddsPlatform,
          preference_type: preferenceType,
          total_legs: selectedPicks.length,
          combined_odds: result.combinedOdds,
          potential_payout: result.payout,
          metadata: { locked_picks: lockedPicks },
          // bet_amount: unitSize, // TODO: Add this after running database migration
          is_lock_bet: true,
          status: 'pending'
        })
        .select()
        .single()

      if (parlayError) throw parlayError

      setLockMessage('Parlay locked - Build another or request more suggestions!')
      setSelectedPicks([])
    } catch (err) {
      window.alert(`Failed to save parlay: ${err.message}`)
    }
  }

  const payout = calculatePayout()

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans pt-4 px-4 pb-24 md:pb-6">
      {/* Header */}
      <header className="flex flex-col items-center justify-center py-6 mb-6 bg-gray-800 rounded-2xl shadow-2xl relative">
        <div className="absolute top-4 left-4">
          <div className="relative">
            <button
              onClick={() => setShowNavMenu(!showNavMenu)}
              className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg border border-gray-600 text-gray-200"
            >
              Menu ▾
            </button>
            {showNavMenu && (
              <div className="absolute mt-2 w-44 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-20">
                <button
                  onClick={() => { setShowDashboard(true); setShowNavMenu(false); }}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700"
                >
                  Dashboard
                </button>
                <button
                  onClick={() => { setShowHowItWorks(true); setShowNavMenu(false); }}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700"
                >
                  How It Works
                </button>
                <button
                  onClick={() => { setShowWeeklySuggestions(true); setShowNavMenu(false); }}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700"
                >
                  Suggestions This Week
                </button>
              </div>
            )}
          </div>
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight mt-2 text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-red-500">
          Cray Cray
        </h1>
        <p className="text-xl font-medium text-gray-300">for Parlays</p>
        <div className="mt-4 flex flex-col items-center space-y-3">
          <div className="flex space-x-4">
            <div className="w-24 h-24 rounded-full border-2 border-yellow-400 flex flex-col items-center justify-center text-xs">
              <span className="text-gray-400">Model</span>
              <span className="text-lg font-bold text-yellow-400">{modelSuccessRate != null ? `${modelSuccessRate}%` : '--'}</span>
              <span className="text-[10px] text-gray-500 px-1 text-center">Success Rate</span>
            </div>
            <div className="w-24 h-24 rounded-full border-2 border-green-400 flex flex-col items-center justify-center text-xs">
              <span className="text-gray-400">Your Builds</span>
              <span className="text-lg font-bold text-green-400">{userWinRate != null ? `${userWinRate}%` : '--'}</span>
              <span className="text-[10px] text-gray-500 px-1 text-center">Success Rate</span>
            </div>
          </div>
          <button
            onClick={handleAskModelImprove}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-md"
          >
            Ask the model how to improve?
          </button>
          {improvementAdvice && (
            <p className="max-w-md text-xs text-gray-300 text-center px-4">{improvementAdvice}</p>
          )}
        </div>

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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="text-gray-200 text-sm font-semibold block mb-3">4. Generate Mode</label>
            <div className="flex gap-2">
              {generationModes.map(mode => (
                <button
                  key={mode}
                  onClick={() => setGenerationMode(mode)}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    generationMode === mode
                      ? 'bg-yellow-500 text-gray-900'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-gray-200 text-sm font-semibold block mb-3">5. Sportsbook</label>
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

        <div>
          <label className="text-gray-200 text-sm font-semibold block mb-3">
            6. How big's your unit? <span className="text-green-400 font-bold">${unitSize}</span>
          </label>
          <div className="flex gap-2">
            {[10, 25, 50, 100].map(amount => (
              <button
                key={amount}
                onClick={() => setUnitSize(amount)}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  unitSize === amount
                    ? 'bg-green-500 text-gray-900'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                ${amount}
              </button>
            ))}
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

      {/* Smart Alert for Limited Data */}
      {alert && (
        <div className="max-w-2xl mx-auto mt-6">
          <div className={`p-4 rounded-lg border-2 ${
            alert.severity === 'warning' 
              ? 'bg-orange-900/30 border-orange-500 text-orange-200'
              : 'bg-blue-900/30 border-blue-500 text-blue-200'
          }`}>
            <div className="flex items-start gap-3">
              <span className="text-2xl">
                {alert.severity === 'warning' ? '⚠️' : 'ℹ️'}
              </span>
              <div className="flex-1">
                <h3 className="font-bold text-lg mb-2">{alert.title}</h3>
                <p className="mb-3">{alert.message}</p>
                <ul className="space-y-1">
                  {alert.suggestions.map((suggestion, idx) => (
                    <li key={idx} className="text-sm">
                      {suggestion}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
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
                <PickCard
                  key={pick.id}
                  pick={pick}
                  onAdd={togglePickSelection}
                  isAdded={!!isSelected}
                />
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
                  <span className="text-gray-400">Unit Size:</span>
                  <span className="text-white font-semibold">${unitSize}.00</span>
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
        </div>
      )}

      {/* Sticky bottom bar for locking builds and confirmation (mobile-first) */}
      {(selectedPicks.length > 0 || lockMessage) && (
        <div className="fixed inset-x-0 bottom-0 z-40">
          <div className="max-w-2xl mx-auto px-4 pb-3">
            <div className="bg-gray-900/95 border border-gray-700 rounded-t-2xl shadow-2xl px-3 py-2 space-y-2">
              {lockMessage && (
                <div className="w-full text-center text-xs px-2 py-1 rounded-md bg-green-900/80 border border-green-500 text-green-100">
                  {lockMessage}
                </div>
              )}
              {selectedPicks.length > 0 && (
                <div className="flex items-center gap-3">
                  <div className="flex-1 text-xs text-gray-300">
                    <div className="font-semibold text-yellow-400">
                      {selectedPicks.length} pick{selectedPicks.length > 1 ? 's' : ''} parlay
                    </div>
                    {payout && (
                      <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                        <span>Combined: {payout.combinedOdds}</span>
                        <span>Payout: ${payout.payout}</span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleLockBuild}
                    disabled={!isAuthenticated || selectedPicks.length === 0}
                    className={`px-4 py-2 rounded-lg font-bold text-sm whitespace-nowrap ${
                      !isAuthenticated || selectedPicks.length === 0
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white'
                    }`}
                  >
                    🔒 Lock Build
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Agents Workflow */}
      <AIAgentsWorkflow />

      {/* Auth Modal */}
      {showAuth && <Auth onClose={() => setShowAuth(false)} />}

      {/* Dashboard Modal */}
      {showDashboard && <Dashboard onClose={() => setShowDashboard(false)} />}

      {showHowItWorks && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-gray-700 p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-yellow-400">How It Works</h2>
              <button
                onClick={() => setShowHowItWorks(false)}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ✕
              </button>
            </div>
            <AIAgentsWorkflow />
          </div>
        </div>
      )}

      {showWeeklySuggestions && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg max-w-3xl w-full max-h-[80vh] overflow-y-auto border border-gray-700 p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-yellow-400">Suggestions This Week</h2>
              <button
                onClick={() => setShowWeeklySuggestions(false)}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-gray-300 mb-2">
              This view will highlight recent locked parlays and their outcomes once more results have been reconciled.
            </p>
            <p className="text-sm text-gray-400">
              For now, use the Dashboard to review your history and see how your builds are performing over time.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
