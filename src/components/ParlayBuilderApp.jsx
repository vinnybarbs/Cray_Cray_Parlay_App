import React, { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import Auth from './Auth'
import PickCard from './PickCard'
import ParlayBuilder from './ParlayBuilder'
import Dashboard from './Dashboard'
import { supabase } from '../lib/supabaseClient'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

export default function ParlayBuilderApp() {
  const { user, isAuthenticated, signOut } = useAuth()
  const [showAuth, setShowAuth] = useState(false)
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
  
  // Parlay builder state
  const [selectedPicks, setSelectedPicks] = useState([])

  const sports = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'Soccer', 'UFC', 'Tennis']
  const betTypes = ['Moneyline/Spread', 'Totals', 'Player Props', 'TD Props', 'Team Props']
  const sportsbooks = ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'Bet365']
  const riskLevels = ['Low', 'Medium', 'High']

  const fetchSuggestions = async () => {
    setLoading(true)
    setError('')
    setSuggestions([])
    
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

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

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

  const handleAddPick = (pick) => {
    if (!selectedPicks.find(p => p.id === pick.id)) {
      setSelectedPicks([...selectedPicks, pick])
    }
  }

  const handleRemovePick = (pickId) => {
    setSelectedPicks(selectedPicks.filter(p => p.id !== pickId))
  }

  const handleLockBuild = async () => {
    if (!isAuthenticated || !supabase) {
      setShowAuth(true)
      return
    }

    try {
      // Calculate combined odds
      const americanOdds = selectedPicks.map(p => p.odds)
      const { calculateParlay } = await import('../../shared/oddsCalculations')
      const result = calculateParlay(americanOdds, 100)

      // Save to Supabase
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

      // Save legs
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-700 py-4 px-6">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold text-yellow-400">🎰 Cray Cray Parlay Builder</h1>
          <div>
            {isAuthenticated ? (
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setShowDashboard(true)}
                  className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm font-semibold"
                >
                  📊 Dashboard
                </button>
                <span className="text-sm text-gray-400">
                  {user?.email}
                </span>
                <button
                  onClick={signOut}
                  className="text-sm text-gray-400 hover:text-white"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAuth(true)}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-semibold"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-6">
        {/* Configuration Panel */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
          <h2 className="text-xl font-bold mb-4">Configure Your Preferences</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {/* Sports */}
            <div>
              <label className="block text-sm font-semibold mb-2">Sport (Or Multiple)</label>
              <div className="flex flex-wrap gap-2">
                {sports.map(sport => (
                  <button
                    key={sport}
                    onClick={() => {
                      setSelectedSports(prev =>
                        prev.includes(sport)
                          ? prev.filter(s => s !== sport)
                          : [...prev, sport]
                      )
                    }}
                    className={`px-3 py-1 rounded text-sm ${
                      selectedSports.includes(sport)
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300'
                    }`}
                  >
                    {sport}
                  </button>
                ))}
              </div>
            </div>

            {/* Bet Types */}
            <div>
              <label className="block text-sm font-semibold mb-2">Bet Types (Or Multiple)</label>
              <div className="flex flex-wrap gap-2">
                {betTypes.map(type => (
                  <button
                    key={type}
                    onClick={() => {
                      setSelectedBetTypes(prev =>
                        prev.includes(type)
                          ? prev.filter(t => t !== type)
                          : [...prev, type]
                      )
                    }}
                    className={`px-3 py-1 rounded text-sm ${
                      selectedBetTypes.includes(type)
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-700 text-gray-300'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Risk Level */}
            <div>
              <label className="block text-sm font-semibold mb-2">Risk Level</label>
              <div className="flex gap-2">
                {riskLevels.map(level => (
                  <button
                    key={level}
                    onClick={() => setRiskLevel(level)}
                    className={`flex-1 px-3 py-2 rounded text-sm font-semibold ${
                      riskLevel === level
                        ? level === 'Low' ? 'bg-green-600' : level === 'Medium' ? 'bg-yellow-600' : 'bg-red-600'
                        : 'bg-gray-700 text-gray-300'
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {/* Sportsbook */}
            <div>
              <label className="block text-sm font-semibold mb-2">Sportsbook</label>
              <select
                value={oddsPlatform}
                onChange={(e) => setOddsPlatform(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
              >
                {sportsbooks.map(book => (
                  <option key={book} value={book}>{book}</option>
                ))}
              </select>
            </div>

            {/* Number of Legs */}
            <div>
              <label className="block text-sm font-semibold mb-2">
                Target Legs: {numLegs}
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={numLegs}
                onChange={(e) => setNumLegs(parseInt(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-400 mt-1">
                Will suggest {numLegs <= 3 ? '10' : '15-30'} picks
              </div>
            </div>

            {/* Date Range */}
            <div>
              <label className="block text-sm font-semibold mb-2">
                Date Range: {dateRange} day{dateRange > 1 ? 's' : ''}
              </label>
              <input
                type="range"
                min="1"
                max="4"
                value={dateRange}
                onChange={(e) => setDateRange(parseInt(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          <button
            onClick={fetchSuggestions}
            disabled={loading || selectedSports.length === 0 || selectedBetTypes.length === 0}
            className={`w-full py-3 rounded-lg font-bold text-lg ${
              loading || selectedSports.length === 0 || selectedBetTypes.length === 0
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600'
            }`}
          >
            {loading ? '🔄 Getting Suggestions...' : '🎯 Get AI Suggestions'}
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-900 border border-red-700 rounded-lg p-4 mb-6">
            <p className="text-red-200">❌ {error}</p>
          </div>
        )}

        {/* Dual Panel Layout */}
        {suggestions.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Suggestions */}
            <div className="lg:col-span-2">
              <h2 className="text-2xl font-bold mb-4">
                AI Suggestions ({suggestions.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {suggestions.map(pick => (
                  <PickCard
                    key={pick.id}
                    pick={pick}
                    onAdd={handleAddPick}
                    isAdded={selectedPicks.some(p => p.id === pick.id)}
                  />
                ))}
              </div>
            </div>

            {/* Right: Parlay Builder */}
            <div>
              <ParlayBuilder
                selectedPicks={selectedPicks}
                onRemove={handleRemovePick}
                onLockBuild={handleLockBuild}
                isAuthenticated={isAuthenticated}
              />
            </div>
          </div>
        )}
      </div>

      {/* Auth Modal */}
      {showAuth && <Auth onClose={() => setShowAuth(false)} />}
      
      {/* Dashboard Modal */}
      {showDashboard && <Dashboard onClose={() => setShowDashboard(false)} />}
    </div>
  )
}
