// src/App.jsx
import React, { useState, useCallback } from 'react';

// --- Mapping for Odds API ---
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

  const fetchOddsData = async () => {
    try {
      const oddsResults = [];
      const selectedBookmaker = BOOKMAKER_MAPPING[oddsPlatform];
      const apiKey = import.meta.env.VITE_ODDS_API_KEY;

      for (const sport of selectedSports) {
        const slug = SPORT_SLUGS[sport];
        const markets = selectedBetTypes.flatMap(bt => MARKET_MAPPING[bt]).join(',');

        const url = `${import.meta.env.VITE_API}/sports/${slug}/odds/?regions=us&markets=${markets}&oddsFormat=american&bookmakers=${selectedBookmaker}&apiKey=${apiKey}`;
        const res = await fetch(url);
        if (!res.ok) continue;

        const data = await res.json();
        oddsResults.push(...data);
      }

      return oddsResults;
    } catch (e) {
      console.error('Error fetching odds:', e);
      return [];
    }
  };

  const generateOpenAIPrompt = useCallback((oddsData) => {
    const sportsStr = selectedSports.join(', ');
    const betTypesStr = selectedBetTypes.join(', ');
    const riskDesc = RISK_LEVEL_DEFINITIONS[riskLevel];

    const oddsContext = oddsData.length
      ? `\n\n**Supplemental Odds Data (use if available)**:\n${JSON.stringify(oddsData.slice(0, 10), null, 2)}`
      : '';

    return `
You are a professional sports betting analyst.
Generate exactly ${numLegs}-leg parlays for today. Include a bonus lock parlay.

Rules:
1. Only include sports: ${sportsStr}
2. Only include bet types: ${betTypesStr}
3. Include real matchups with current odds if possible
4. Provide confidence 1-10 for each leg
5. Include concise degenerate humor in the parlay title or intro
6. Output structured format exactly as below

Format:
**Parlay Title**: [Funny/degenerate title]
**Legs**:
1. Game: [Team vs Team] - Bet Type: [Type] - Odds: [XXX] - Confidence: [X/10] - Notes: [Stats/Trends]
...
**Combined Odds**: [Total]
**Payout on $100**: [XXX]

**Bonus Lock Parlay**:
1. Game: [Team vs Team] - Bet Type: [Type] - Odds: [XXX] - Confidence: [X/10] - Notes: [Why safe]
...
**Combined Odds**: [Total]
**Reasoning**: [Concise explanation]

Supplemental context for odds: ${oddsContext}

Tone: Serious picks, full personality, concise degenerate-style humor.
`.trim();
  }, [selectedSports, selectedBetTypes, numLegs, riskLevel, oddsPlatform]);

  const fetchParlaySuggestion = useCallback(async () => {
    if (loading || selectedSports.length === 0 || selectedBetTypes.length === 0) return;

    setLoading(true);
    setResults('');
    setError(null);

    try {
      const oddsData = await fetchOddsData();
      const prompt = generateOpenAIPrompt(oddsData);
      const openaiKey = import.meta.env.VITE_OPENAI_API_KEY;

      const response = await fetch(`${import.meta.env.VITE_API}/openai/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a concise sports betting analyst producing actionable parlays.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) throw new Error('No content returned from OpenAI');

      setResults(content);
    } catch (e) {
      console.error('API Error:', e);
      setError(`Failed to generate parlays: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [generateOpenAIPrompt, loading, selectedSports, selectedBetTypes, oddsPlatform]);

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

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-4">
      {/* ... UI code as before ... */}
    </div>
  );
};

export default App;
