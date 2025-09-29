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

const AI_MODELS = ['OpenAI', 'Gemini'];

const App = () => {
  // --- UI State ---
  const [selectedSports, setSelectedSports] = useState(['NFL']);
  const [selectedBetTypes, setSelectedBetTypes] = useState(['Moneyline/Spread']);
  const [riskLevel, setRiskLevel] = useState('Low');
  const [numLegs, setNumLegs] = useState(3);
  const [oddsPlatform, setOddsPlatform] = useState('DraftKings');
  const [aiModel, setAiModel] = useState('OpenAI');

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

  // --- Fetch Odds Data ---
  const fetchOddsData = async () => {
    try {
      const oddsResults = [];
      const selectedBookmaker = BOOKMAKER_MAPPING[oddsPlatform];
      const oddsApiKey = import.meta.env.VITE_ODDS_API_KEY;
      const oddsApiBase = import.meta.env.VITE_API;

      for (const sport of selectedSports) {
        const slug = SPORT_SLUGS[sport];
        const markets = selectedBetTypes.flatMap(bt => MARKET_MAPPING[bt]).join(',');
        const url = `${oddsApiBase}/sports/${slug}/odds/?regions=us&markets=${markets}&oddsFormat=american&bookmakers=${selectedBookmaker}&apiKey=${oddsApiKey}`;

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

  // --- Generate AI Prompt ---
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
  }, [selectedSports, selectedBetTypes, numLegs, riskLevel]);

  // --- Fetch Parlay Suggestions ---
  const fetchParlaySuggestion = useCallback(async () => {
    if (loading || selectedSports.length === 0 || selectedBetTypes.length === 0) return;

    setLoading(true);
    setResults('');
    setError(null);

    try {
      const oddsData = await fetchOddsData();
      const prompt = generateOpenAIPrompt(oddsData);

      const apiKey =
        aiModel === 'OpenAI'
          ? import.meta.env.VITE_OPENAI_API_KEY
          : import.meta.env.VITE_GEMINI_API_KEY;

      const apiUrl =
        aiModel === 'OpenAI'
          ? 'https://api.openai.com/v1/chat/completions'
          : import.meta.env.VITE_GEMINI_API_URL; // set Gemini endpoint in env

      const body =
        aiModel === 'OpenAI'
          ? {
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: 'You are a concise sports betting analyst producing actionable parlays.' },
                { role: 'user', content: prompt },
              ],
              temperature: 0.7,
              max_tokens: 2000,
            }
          : {
              model: 'gemini-prototype',
              prompt,
              temperature: 0.7,
              max_tokens: 2000,
            };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || data.output;

      if (!content) throw new Error('No content returned from AI');

      setResults(content);
    } catch (e) {
      console.error('API Error:', e);
      setError(`Failed to generate parlays: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [aiModel, generateOpenAIPrompt, loading, selectedSports, selectedBetTypes]);

  // --- UI Components (CheckboxGroup, Dropdown, etc.) ---
  // [Keep all the UI code as in your previous App.jsx, including checkboxes, dropdowns, sliders, and the generate button]

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-4">
      {/* Header and controls */}
      {/* Add AI Model selection dropdown just above the generate button */}
      <div className="max-w-2xl mx-auto space-y-6">
        <Dropdown
          label="AI Model"
          value={aiModel}
          onChange={setAiModel}
          options={AI_MODELS}
        />
        <button
          onClick={fetchParlaySuggestion}
          disabled={loading || selectedSports.length === 0 || selectedBetTypes.length === 0}
          className={`w-full py-4 mt-2 font-bold text-lg rounded-xl shadow-2xl transition duration-300 transform active:scale-95
            ${loading || selectedSports.length === 0 || selectedBetTypes.length === 0
              ? 'bg-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600'
            }`}
        >
          {loading ? 'Generating Parlays...' : `Generate ${numLegs}-Leg Parlay + Bonus`}
        </button>
      </div>

      {/* Results and footer */}
      {/* Keep the rest of your previous JSX for displaying results */}
    </div>
  );
};

export default App;
