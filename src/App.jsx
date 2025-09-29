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
  Bet365: 'bet365'
};

const RISK_LEVEL_DEFINITIONS = {
  Low: "High probability to hit, heavy favorites, +200 to +400 odds, confidence 8/10+",
  Medium: "Balanced value favorites with moderate props, +400 to +600 odds",
  High: "Value underdogs and high-variance outcomes, +600+ odds",
};

// --- Odds Widget ---
const OddsWidget = ({ sport, bookmaker }) => {
  if (!sport || !bookmaker) return null;
  const slug = SPORT_SLUGS[sport];
  const bookKey = BOOKMAKER_MAPPING[bookmaker];
  const widgetSrc = `https://widget.the-odds-api.com/v1/sports/${slug}/events/?accessKey=${process.env.REACT_APP_ODDS_API_KEY}&bookmakerKeys=${bookKey}&oddsFormat=american&markets=h2h,spreads,totals`;

  return (
    <div className="mt-8 flex justify-center">
      <iframe
        title="Sports Odds Widget"
        style={{ width: '20rem', height: '25rem', border: '1px solid black' }}
        src={widgetSrc}
      />
    </div>
  );
};

const App = () => {
  // --- UI State ---
  const [selectedSports, setSelectedSports] = useState(['NFL']);
  const [selectedBetTypes, setSelectedBetTypes] = useState(['Moneyline/Spread']);
  const [riskLevel, setRiskLevel] = useState('Low');
  const [numLegs, setNumLegs] = useState(3);
  const [oddsPlatform, setOddsPlatform] = useState('DraftKings');

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState('');
  const [error, setError] = useState(null);

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

  // --- Fetch Odds Data for all selected sports ---
  const fetchOddsData = async () => {
    try {
      const allOdds = [];

      for (const sport of selectedSports) {
        const sportSlug = SPORT_SLUGS[sport];
        const response = await fetch(
          `https://api.the-odds-api.com/v4/sports/${sportSlug}/odds/?regions=us&markets=h2h&apiKey=${process.env.REACT_APP_ODDS_API_KEY}`
        );

        if (!response.ok) continue; // skip if API fails for a sport

        const data = await response.json();
        if (data && data.length > 0) allOdds.push({ sport, data: data.slice(0, 5) });
      }

      return allOdds.length > 0 ? allOdds : null;
    } catch (e) {
      console.error("Error fetching odds:", e);
      return null;
    }
  };

  // --- Generate OpenAI Prompt ---
  const generatePrompt = useCallback((oddsData) => {
    const sportsStr = selectedSports.join(', ');
    const betTypesStr = selectedBetTypes.join(', ');
    const riskDesc = RISK_LEVEL_DEFINITIONS[riskLevel];

    const oddsContext = oddsData
      ? `\n\n**SUPPLEMENTAL ODDS DATA (per sport, if available)**:\n${JSON.stringify(oddsData, null, 2)}`
      : '\n\n(No current odds data available, generate picks based on today\'s games)';

    return `
You are a professional sports betting analyst.
Generate exactly ${numLegs}-leg parlays for today with a bonus lock parlay.

Rules:
1. Only include sports: ${sportsStr}
2. Only include bet types: ${betTypesStr}
3. Include real matchups with current odds if possible${oddsData ? '' : ' (otherwise estimate realistic outcomes)'}
4. Provide confidence 1-10 for each leg
5. Include concise degenerate humor in the parlay title or intro
6. Output structured format:

${oddsContext}

**Parlay Title**: [Funny/degenerate title]
**Legs**:
1. Game: [Team vs Team] - Bet Type: [Type] - Odds: [XXX] - Confidence: [X/10] - Notes: [Stats/Trends]

**Combined Odds**: [Total]
**Payout on $100**: [XXX]

**Bonus Lock Parlay**:
1. Game: [Team vs Team] - Bet Type: [Type] - Odds: [XXX] - Confidence: [X/10] - Notes: [Why safe]
**Combined Odds**: [Total]
**Reasoning**: [Concise explanation]

Tone: Serious picks, full personality, concise degenerate-style humor.
`.trim();
  }, [selectedSports, selectedBetTypes, numLegs, riskLevel]);

  // --- Fetch Parlay ---
  const fetchParlaySuggestion = useCallback(async () => {
    if (loading || selectedSports.length === 0 || selectedBetTypes.length === 0) return;

    setLoading(true);
    setResults('');
    setError(null);

    try {
      const oddsData = await fetchOddsData();
      const prompt = generatePrompt(oddsData);

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.REACT_APP_OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a concise sports betting analyst producing actionable parlays with degenerate humor.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 2000
        })
      });

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      setResults(content || '');
    } catch (e) {
      console.error(e);
      setError(`Failed to generate parlays: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [generatePrompt, loading, selectedSports, selectedBetTypes]);

  // --- UI Components ---
  const CheckboxGroup = ({ label, options, selectedOptions, onToggle }) => (
    <div className="flex flex-col space-y-3">
      <label className="text-gray-200 text-sm font-semibold">{label}</label>
      <div className="grid grid-cols-2 gap-2">
        {options.map(opt => (
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
        onChange={e => onChange(e.target.value)}
        className="bg-gray-700 text-white p-3 rounded-xl border border-yellow-500 focus:ring-yellow-400 focus:border-yellow-400 transition shadow-lg appearance-none cursor-pointer"
      >
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
      {description && <p className="text-xs text-gray-400 mt-1 italic">{description}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-4">
      <header className="flex flex-col items-center justify-center py-6 mb-6 bg-gray-800 rounded-2xl shadow-2xl">
        <h1 className="text-4xl font-extrabold tracking-tight mt-2 text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-red-500">Cray Cray</h1>
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
            onChange={e => setNumLegs(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1</span><span>10</span>
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
            options={Object.keys(BOOKMAKER_MAPPING)}
          />
        </div>

        <button
          onClick={fetchParlaySuggestion}
          disabled={loading || selectedSports.length === 0 || selectedBetTypes.length === 0}
          className={`w-full py-4 mt-8 font-bold text-lg rounded-xl shadow-2xl transition duration-300 transform active:scale-95
            ${loading || selectedSports.length === 0 || selectedBetTypes.length === 0
              ? 'bg-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600'
            }`}
        >
          {loading ? 'Generating Parlay...' : `Generate ${numLegs}-Leg Parlay + Bonus Lock`}
        </button>

        {results && (
          <>
            <div className="p-6 bg-gray-800 rounded-xl shadow-lg overflow-y-auto max-h-[70vh] mt-6">
              <pre className="whitespace-pre-wrap text-gray-300">{results}</pre>
            </div>
            <OddsWidget sport={selectedSports[0]} bookmaker={oddsPlatform} />
          </>
        )}

        {error && <p className="text-red-400 mt-4 text-center">{error}</p>}
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
   
