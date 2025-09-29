import React, { useState, useCallback } from 'react';

// API Keys
const GEMINI_API_KEY = "AIzaSyDTj7cJ5lNh2_MXyFW6bTyHkU1CcThZr18";
const OPENAI_API_KEY = "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";
const ODDS_API_KEY = "cbe6d816b76d4f89efd44f1bb4c86cec";

// Risk Level Definitions
const RISK_LEVEL_DEFINITIONS = {
  'Low': "High probability to hit, heavy favorites, +200 to +400 odds",
  'Medium': "Balanced value favorites with moderate props, +400 to +600 odds",
  'High': "Value underdogs and high-variance outcomes, +600+ odds",
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

  // --- Fetch Current Odds Data ---
  const fetchOddsData = async () => {
    try {
      const response = await fetch(`https://api.the-odds-api.com/v4/sports/upcoming/odds/?regions=us&markets=h2h&apiKey=${ODDS_API_KEY}`);
      if (!response.ok) return null;
      const data = await response.json();
      return data;
    } catch (e) {
      console.error("Error fetching odds:", e);
      return null;
    }
  };

  // --- Prompt Generation ---
  const generateGeminiPrompt = useCallback((oddsData) => {
    const sportsStr = selectedSports.join(', ');
    const betTypesStr = selectedBetTypes.join(', ');
    const riskDesc = RISK_LEVEL_DEFINITIONS[riskLevel];
    
    const oddsContext = oddsData ? `\n\nCurrent Odds Data Available:\n${JSON.stringify(oddsData.slice(0, 20), null, 2)}` : '';

    return `You are a professional sports betting analyst. Generate parlay suggestions based on TODAY'S games using real-time data.

PARAMETERS:
- Sports: ${sportsStr}
- Bet Types/Focus: ${betTypesStr}
- Number of Legs: ${numLegs}
- Risk Level: ${riskLevel} (${riskDesc})
- Odds Platform: ${oddsPlatform}

RESEARCH SOURCES (Use these for injury updates and analysis):
- NFL.com for injury reports
- FantasyPros.com for player status
- CBSSports.com for team news
- ESPN.com for game previews
- General sports news search
${oddsContext}

OUTPUT REQUIREMENTS:
Provide exactly ${numLegs} parlay picks for today's games, formatted as:

**PARLAY 1** (Target: ${riskLevel === 'Low' ? '+200 to +400' : riskLevel === 'Medium' ? '+400 to +600' : '+600+'})
1. [Game/Match] - [Bet Type] - [Selection] - Odds: [+XXX] - Confidence: [X/10]
   Analysis: [2-3 sentence reasoning with key stats/injuries/trends]
2. [Continue for ${numLegs} legs]
   
Combined Odds: [Total American Odds]
Why This Works: [2-3 sentences on correlation and value]

---

**BONUS 3-LEG HIGH PROBABILITY PARLAY** 🔥
1. [Heavy Favorite Bet] - Odds: [-XXX] - Confidence: 9/10
   Analysis: [Why this is a lock]
2. [Heavy Favorite Bet] - Odds: [-XXX] - Confidence: 9/10
   Analysis: [Why this is a lock]
3. [Heavy Favorite Bet] - Odds: [-XXX] - Confidence: 9/10
   Analysis: [Why this is a lock]

Combined Odds: [Total]
The Winner: [Brief explanation of why this bonus parlay has the highest probability]

Keep responses concise, data-driven, and formatted exactly as shown. No disclaimers about hypotheticals or data limitations.`.trim();
  }, [selectedSports, selectedBetTypes, numLegs, riskLevel, oddsPlatform]);

  // --- API Call with OpenAI as Final Output ---
  const fetchParlaySuggestion = useCallback(async () => {
    if (loading || selectedSports.length === 0 || selectedBetTypes.length === 0) return;

    setLoading(true);
    setResults('');
    setError(null);

    try {
      // Step 1: Fetch current odds data
      const oddsData = await fetchOddsData();

      // Step 2: Generate Gemini response
      const geminiPrompt = generateGeminiPrompt(oddsData);
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`;
      
      const geminiPayload = {
        contents: [{ parts: [{ text: geminiPrompt }] }],
        tools: [{ "google_search": {} }],
        systemInstruction: {
          parts: [{ text: "You are a concise, data-driven sports betting analyst. Provide actionable parlay suggestions with zero disclaimers." }]
        },
      };

      const geminiResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload)
      });

      if (!geminiResponse.ok) {
        throw new Error(`Gemini API error: ${geminiResponse.status}`);
      }

      const geminiResult = await geminiResponse.json();
      const geminiText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!geminiText) {
        throw new Error('Invalid Gemini response');
      }

      // Step 3: Send Gemini output to OpenAI for refinement
      const openaiUrl = 'https://api.openai.com/v1/chat/completions';
      const openaiPayload = {
        model: 'gpt-5-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a sports betting expert. Take the provided parlay analysis and refine it into a clear, actionable format. Keep all the picks and reasoning but make it more readable and engaging. Maintain the bonus parlay section.'
          },
          {
            role: 'user',
            content: `Refine this parlay analysis into a clean, easy-to-read format:\n\n${geminiText}`
          }
        ],
        temperature: 0.7,
        max_tokens: 5000
      };

      const openaiResponse = await fetch(openaiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify(openaiPayload)
      });

      if (!openaiResponse.ok) {
        const errorData = await openaiResponse.text();
        console.error("OpenAI Error Details:", errorData);
        // If OpenAI fails, fall back to Gemini results
        console.log("OpenAI failed, using Gemini results directly");
        setResults(geminiText);
        setLoading(false);
        return;
      }

      const openaiResult = await openaiResponse.json();
      const finalText = openaiResult.choices?.[0]?.message?.content;

      if (!finalText) {
        console.log("No OpenAI response, using Gemini results");
        setResults(geminiText);
      } else {
        setResults(finalText);
      }
    } catch (e) {
      console.error("API Error:", e);
      setError(`Failed to generate parlays: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [generateGeminiPrompt, loading, selectedSports, selectedBetTypes]);

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
      <style>{`
        .results-box::-webkit-scrollbar { width: 8px; }
        .results-box::-webkit-scrollbar-thumb { background-color: #f59e0b; border-radius: 4px; }
        .results-box { scrollbar-width: thin; scrollbar-color: #f59e0b #1f2937; }
      `}</style>
      
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
          className={`w-full py-4 mt-8 font-bold text-lg rounded-xl shadow-2xl transition duration-300 transform active:scale-95
            ${loading || selectedSports.length === 0 || selectedBetTypes.length === 0
              ? 'bg-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600'
            }`}
        >
          {loading ? (
            <div className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Analyzing Current Odds & Generating Picks...
            </div>
          ) : (
            `Generate ${numLegs}-Leg Parlay + Bonus Winner`
          )}
        </button>

        {selectedSports.length === 0 && (
          <p className="text-xs text-center text-red-400">⚠️ Select at least one sport</p>
        )}
        {selectedBetTypes.length === 0 && (
          <p className="text-xs text-center text-red-400">⚠️ Select at least one bet type</p>
        )}
      </div>

      {/* Results Display */}
      <div className="mt-8 pt-4 border-t border-gray-700 max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold mb-4 text-yellow-400">AI-Powered Parlay Analysis</h2>

        {error && (
          <div className="p-4 bg-red-800 rounded-xl text-red-100 shadow-md">
            <p className="font-bold">Error:</p>
            <p>{error}</p>
          </div>
        )}

        {results && (
          <div className="results-box p-6 bg-gray-800 rounded-xl shadow-lg overflow-y-auto max-h-[70vh]">
            <div className="prose prose-invert prose-headings:text-yellow-400 prose-strong:text-yellow-400 prose-p:text-gray-300 max-w-none whitespace-pre-wrap">
              {results}
            </div>
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
