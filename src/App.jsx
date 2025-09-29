import React, { useState, useCallback } from 'react';

// --- Risk Levels ---
const RISK_LEVEL_DEFINITIONS = {
  Low: "High probability, heavy favorites, +200 to +400 odds, confidence 8/10+",
  Medium: "Balanced value favorites, +400 to +600 odds",
  High: "Value underdogs, high-variance outcomes, +600+ odds",
};

const App = () => {
  // --- UI State ---
  const [selectedSports, setSelectedSports] = useState(['NFL']);
  const [selectedBetTypes, setSelectedBetTypes] = useState(['Moneyline/Spread']);
  const [riskLevel, setRiskLevel] = useState('Low');
  const [numLegs, setNumLegs] = useState(3);
  const [aiProvider, setAiProvider] = useState('OpenAI'); // "OpenAI" or "Gemini"

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

  // --- Fetch Parlays ---
  const fetchParlaySuggestion = useCallback(async () => {
    if (loading || selectedSports.length === 0 || selectedBetTypes.length === 0) return;

    setLoading(true);
    setResults('');
    setError(null);

    try {
      const prompt = `
You are a professional sports betting analyst.
Generate exactly ${numLegs}-leg parlays for today with a bonus lock parlay.

Rules:
1. Only include sports: ${selectedSports.join(', ')}
2. Only include bet types: ${selectedBetTypes.join(', ')}
3. Include confidence 1-10 for each leg
4. Provide concise degenerate humor in the parlay title or intro
5. Output structured format with combined odds and bonus lock parlay
Tone: Serious picks with full personality and degenerate-style humor
`;

      let responseData, content;

      if (aiProvider === 'OpenAI') {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.REACT_APP_OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
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
        responseData = await response.json();
        content = responseData?.choices?.[0]?.message?.content;

      } else if (aiProvider === 'Gemini') {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${process.env.REACT_APP_GEMINI_API_KEY}`;
        const geminiPayload = {
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: 'You are a concise sports betting analyst producing actionable parlays with degenerate humor.' }] }
        };
        const geminiResponse = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiPayload)
        });
        responseData = await geminiResponse.json();
        content = responseData?.candidates?.[0]?.content?.parts?.[0]?.text;
      }

      if (!content) {
        setResults('⚠️ No results returned. Try again.');
      } else {
        setResults(content);
      }

    } catch (e) {
      console.error(e);
      setError(`Failed to generate parlays: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [loading, selectedSports, selectedBetTypes, numLegs, aiProvider]);

  // --- UI Components ---
  const CheckboxGroup = ({ label, options, selectedOptions, onToggle }) => (
    <div className="flex flex-col space-y-3">
      <label className="text-gray-200 text-sm font-semibold">{label}</label>
      <div className="grid grid-cols-2 gap-2">
        {options.map(opt => (
          <label key={opt} className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedOptions.includes(opt)}
              onChange={() => onToggle(opt)}
              className="w-4 h-4 text-yellow-500 bg-gray-700 border-gray-600 rounded focus:ring-yellow-400"
            />
            <span className="text-sm text-gray-300">{opt}</span>
          </label>
        ))}
      </div>
    </div>
  );

  const Dropdown = ({ label, value, onChange, options }) => (
    <div className="flex flex-col space-y-2">
      <label className="text-gray-200 text-sm font-semibold">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-gray-700 text-white p-3 rounded-xl border border-yellow-500 focus:ring-yellow-400"
      >
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-4">
      <header className="flex flex-col items-center justify-center py-6 mb-6 bg-gray-800 rounded-2xl shadow-2xl">
        <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-red-500">
          Cray Cray Parlays
        </h1>
      </header>

      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <CheckboxGroup
            label="1. Sports"
            options={['NFL', 'NBA', 'MLB', 'NHL', 'Soccer', 'NCAAF', 'PGA/Golf', 'Tennis']}
            selectedOptions={selectedSports}
            onToggle={toggleSport}
          />
          <CheckboxGroup
            label="2. Bet Types"
            options={['Moneyline/Spread', 'Player Props', 'Totals (O/U)', 'Team Props']}
            selectedOptions={selectedBetTypes}
            onToggle={toggleBetType}
          />
        </div>

        <div>
          <label className="text-gray-200 text-sm font-semibold">3. Number of Legs: <span className="text-yellow-400">{numLegs}</span></label>
          <input
            type="range"
            min="1"
            max="10"
            value={numLegs}
            onChange={e => setNumLegs(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg accent-yellow-500"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Dropdown
            label="4. Risk Level"
            value={riskLevel}
            onChange={setRiskLevel}
            options={Object.keys(RISK_LEVEL_DEFINITIONS)}
          />
          <Dropdown
            label="5. AI Provider"
            value={aiProvider}
            onChange={setAiProvider}
            options={['OpenAI', 'Gemini']}
          />
        </div>

        <button
          onClick={fetchParlaySuggestion}
          disabled={loading || selectedSports.length === 0 || selectedBetTypes.length === 0}
          className={`w-full py-4 mt-8 font-bold text-lg rounded-xl ${loading ? 'bg-gray-500 cursor-not-allowed' : 'bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600'}`}
        >
          {loading ? 'Generating parlays...' : `Generate ${numLegs}-Leg Parlay + Bonus Lock`}
        </button>

        {error && <div className="p-4 bg-red-800 rounded-xl text-red-100 mt-4">{error}</div>}

        {results && (
          <div className="results-box p-6 bg-gray-800 rounded-xl shadow-lg overflow-y-auto max-h-[70vh] mt-4">
            <pre className="whitespace-pre-wrap">{results}</pre>
          </div>
        )}
      </div>

      <footer className="max-w-2xl mx-auto mt-12 mb-4 text-center text-gray-700 uppercase text-xs font-bold tracking-widest">
        A BISQUE BOYS APPLICATION
      </footer>
    </div>
  );
};

export default App;
