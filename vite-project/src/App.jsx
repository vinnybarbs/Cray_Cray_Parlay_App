import React, { useState, useCallback } from 'react';

// --- Mappings ---
const SPORT_SLUGS = {
  NFL: 'americanfootball_nfl',
  NBA: 'basketball_nba',
  MLB: 'baseball_mlb',
  NHL: 'icehockey_nhl',
  Soccer: 'soccer_epl',
  NCAAF: 'americanfootball_ncaaf',
  'PGA/Golf': 'golf_pga',
  Tennis: 'tennis_atp',
};

const MARKET_MAPPING = {
  'Moneyline/Spread': ['h2h', 'spreads'],
  'Totals (O/U)': ['totals'],
  'Player Props': ['player_points'],
  'Team Props': ['team_points'],
};

const BOOKMAKER_MAPPING = {
  DraftKings: 'draftkings',
  FanDuel: 'fanduel',
  MGM: 'mgm',
  Caesars: 'caesars',
  Bet365: 'bet365',
};

const RISK_LEVEL_DEFINITIONS = {
  Low: "High probability to hit, heavy favorites, +200 to +400 odds, confidence 8/10+",
  Medium: "Balanced value favorites with moderate props, +400 to +600 odds",
  High: "Value underdogs and high-variance outcomes, +600+ odds",
};

 

const App = () => {
  // --- UI State ---
  const [selectedSports, setSelectedSports] = useState(['NFL']);
  const [selectedBetTypes, setSelectedBetTypes] = useState(['Moneyline/Spread']);
  const [riskLevel, setRiskLevel] = useState('Low');
  const [numLegs, setNumLegs] = useState(3);
  const [oddsPlatform, setOddsPlatform] = useState('DraftKings');
  

  // --- API State ---
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState('');
  const [error, setError] = useState(null);

  // --- Toggle Handlers ---
  const toggleSport = (sport) => {
    setSelectedSports(prev =>
      prev.includes(sport) ? prev.filter(s => s !== sport) : [...prev, sport]
    );
  };

  const toggleBetType = (betType) => {
    setSelectedBetTypes(prev =>
      prev.includes(betType) ? prev.filter(b => b !== betType) : [...prev, betType]
    );
  };

  // Backend handles odds fetch and analysis now

  // Backend handles prompt generation and analysis

  // --- Fetch Parlay Suggestions ---
  const fetchParlaySuggestion = useCallback(async () => {
    if (loading || selectedSports.length === 0 || selectedBetTypes.length === 0) return;

    setLoading(true);
    setResults('');
    setError(null);

    try {
      const response = await fetch('/api/generate-parlay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedSports,
          selectedBetTypes,
          numLegs,
          oddsPlatform,
          riskLevel,
          dateRange: 1
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      if (!data.content) throw new Error('No content returned from backend');
      setResults(data.content);
    } catch (e) {
      console.error('API Error:', e);
      setError(`Failed to generate parlays: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [loading, selectedSports, selectedBetTypes, numLegs, oddsPlatform, riskLevel]);

  // --- UI Components ---
  const CheckboxGroup = ({ label, options, selectedOptions, onToggle }) => (
    <div className="flex flex-col space-y-3">
      <label className="text-gray-200 text-sm font-semibold">{label}</label>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <label key={opt} className="flex items-center space-x-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={selectedOptions.includes(opt)}
              onChange={() => onToggle(opt)}
              className="w-4 h-4 text-yellow-500 bg-gray-700 border-gray-600 rounded focus:ring-yellow-400 focus:ring-2 cursor-pointer"
            />
            <span className="text-sm text-gray-300 group-hover:text-yellow-400 transition">{opt}</span>
          </label>
        ))}
      </div>
    </div>
  );

  const Dropdown = ({ label, value, onChange, options, description }) => (
    <div className="flex flex-col space-y-2">
      <label className="text-gray-200 text-sm font-semibold">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-gray-700 text-white p-3 rounded-xl border border-yellow-500 focus:ring-yellow-400 focus:border-yellow-400 transition shadow-lg appearance-none cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      {description && <p className="text-xs text-gray-400 mt-1 italic">{description}</p>}
    </div>
  );

  // --- Render ---
  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-4">
      <header className="flex flex-col items-center justify-center py-6 mb-6 bg-gray-800 rounded-2xl shadow-2xl">
        <h1 className="text-4xl font-extrabold tracking-tight mt-2 text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-red-500">
          Cray Cray
        </h1>
        <p className="text-xl font-medium text-gray-300">for Parlays</p>
      </header>

      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <CheckboxGroup
            label="1. Sports (Select Multiple)"
            options={['NFL', 'NBA', 'MLB', 'NHL', 'Soccer', 'NCAAF', 'PGA/Golf', 'Tennis']}
            selectedOptions={selectedSports}
            onToggle={toggleSport}
          />
          <CheckboxGroup
            label="2. Bet-Type/Focus (Select Multiple)"
            options={['Moneyline/Spread', 'Player Props', 'Totals (O/U)', 'Team Props']}
            selectedOptions={selectedBetTypes}
            onToggle={toggleBetType}
          />
        </div>

        <div>
          <label className="text-gray-200 text-sm font-semibold block mb-3">
            3. Number of Legs: <span className="text-yellow-400 text-lg font-bold">{numLegs}</span>
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
            <span>1</span>
            <span>10</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Dropdown
            label="4. Risk Level"
            value={riskLevel}
            onChange={setRiskLevel}
            options={Object.keys(RISK_LEVEL_DEFINITIONS)}
            description={RISK_LEVEL_DEFINITIONS[riskLevel]}
          />
          <Dropdown
            label="5. Odds Platform"
            value={oddsPlatform}
            onChange={setOddsPlatform}
            options={['DraftKings', 'FanDuel', 'MGM', 'Caesars', 'Bet365']}
          />
        </div>

        

        <button
          onClick={fetchParlaySuggestion}
          disabled={loading || selectedSports.length === 0 || selectedBetTypes.length === 0}
          className={`w-full py-4 mt-4 font-bold text-lg rounded-xl shadow-2xl transition duration-300 transform active:scale-95
            ${loading || selectedSports.length === 0 || selectedBetTypes.length === 0
              ? 'bg-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600'
            }`}
        >
          {loading ? 'Generating Parlays...' : `Generate ${numLegs}-Leg Parlay + Bonus`}
        </button>

        {selectedSports.length === 0 && (
          <p className="text-xs text-center text-red-400">⚠️ Select at least one sport</p>
        )}
        {selectedBetTypes.length === 0 && (
          <p className="text-xs text-center text-red-400">⚠️ Select at least one bet type</p>
        )}
      </div>

      <div className="mt-8 pt-4 border-t border-gray-700 max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold mb-4 text-yellow-400">AI-Powered Parlay Analysis</h2>

        {error && (
          <div className="p-4 bg-red-800 rounded-xl text-red-100 shadow-md">
            <p className="font-bold">Error:</p>
            <p>{error}</p>
          </div>
        )}

        {results && (
          <div className="p-6 bg-gray-800 rounded-xl shadow-lg overflow-y-auto max-h-[70vh]">
            <pre className="whitespace-pre-wrap text-gray-300">{results}</pre>
          </div>
        )}

        {!loading && !error && !results && (
          <div className="p-6 text-center text-gray-500 border border-dashed border-gray-700 rounded-xl">
            <p>Configure your parlay preferences above and hit Generate to receive AI-powered picks with a bonus high-probability parlay!</p>
          </div>
        )}
      </div>

      <div className="max-w-2xl mx-auto mt-12 mb-4 text-center">
        <p className="uppercase font-bold text-xs text-gray-700 tracking-widest">
          A BISQUE BOYS APPLICATION
        </p>
      </div>
    </div>
  );
};

export default App;
