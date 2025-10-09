import React, { useState, useCallback } from 'react';

// AI Agents Workflow Component
const AIAgentsWorkflow = () => {
  // Replace these placeholder URLs with your actual character image paths
  const characterImages = {
    degenerate: '/images/degenerate-gambler.png', // Replace with your image path
    carol: '/images/carol-coordinator.png',
    oddjob: '/images/oddjob.png',
    randy: '/images/randy-researcher.png',
    andy: '/images/andy-analyst.png'
  };

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
              <h3 className="font-bold text-xs md:text-sm text-yellow-400 mt-1">Degenerate</h3>
              <p className="text-xs text-yellow-400 text-center">(You)</p>
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
  );
};

// --- Helper UI Components ---
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

const AiModelToggle = ({ aiModel, setAiModel }) => (
  <div className="flex justify-center items-center mt-4 p-1 rounded-xl bg-gray-700">
      <button
          onClick={() => setAiModel('openai')}
          className={`w-1/2 py-2 text-sm font-bold rounded-lg transition-colors duration-300 ${
              aiModel === 'openai' ? 'bg-yellow-500 text-gray-900' : 'text-gray-300 hover:bg-gray-600'
          }`}
      >
          OpenAI
      </button>
      <button
          onClick={() => setAiModel('gemini')}
          className={`w-1/2 py-2 text-sm font-bold rounded-lg transition-colors duration-300 ${
              aiModel === 'gemini' ? 'bg-yellow-500 text-gray-900' : 'text-gray-300 hover:bg-gray-600'
          }`}
      >
          Gemini
      </button>
  </div>
);

const RISK_LEVEL_DEFINITIONS = {
  Low: "High probability to hit, heavy favorites, +200 to +400 odds.",
  Medium: "Balanced value favorites with moderate props, +400 to +600 odds.",
  High: "Value underdogs and high-variance outcomes, +600+ odds.",
};

// --- Main App Component ---
const App = () => {
  const [selectedSports, setSelectedSports] = useState(['NFL']);
  const [selectedBetTypes, setSelectedBetTypes] = useState(['Moneyline/Spread']);
  const [riskLevel, setRiskLevel] = useState('Low');
  const [numLegs, setNumLegs] = useState(3);
  const [oddsPlatform, setOddsPlatform] = useState('DraftKings');
  const [aiModel, setAiModel] = useState('openai');
  const [dateRange, setDateRange] = useState(1);
  const [copied, setCopied] = useState(false);
  const [summarycopied, setSummaryCopped] = useState(false);

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState('');
  const [error, setError] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState('');

  const loadingMessages = [
    "Consulting with Vegas insiders...", "Bribing the refs for insider info...", "Sacrificing a prop bet to the degen gods...",
    "Checking if my bookie is watching...", "Doing complex math (counting on fingers)...", "Reading tea leaves and injury reports...",
    "Asking my Magic 8-Ball for advice...", "Channeling my inner degenerate...", "Calculating odds while ignoring reality...", "Pretending I know what I'm doing...",
  ];

  const getRandomLoadingMessage = () => loadingMessages[Math.floor(Math.random() * loadingMessages.length)];

  const toggleSport = (sport) => setSelectedSports(prev => prev.includes(sport) ? prev.filter(s => s !== sport) : [...prev, sport]);
  const toggleBetType = (betType) => setSelectedBetTypes(prev => prev.includes(betType) ? prev.filter(b => b !== betType) : [...prev, betType]);

  const handleCopy = () => {
    if (results) {
      navigator.clipboard.writeText(results).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const extractSummary = (text) => {
    if (!text) return '';
    
    const lines = text.split('\n');
    let summary = '';
    let inMainParlay = false;
    let inBonusParlay = false;
    let currentParlayTitle = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Detect main parlay start
      if (line.includes('🎯') && line.includes('-Leg Parlay:')) {
        inMainParlay = true;
        inBonusParlay = false;
        currentParlayTitle = line;
        summary += line + '\n';
        continue;
      }
      
      // Detect bonus parlay start
      if (line.includes('🔒') && line.includes('LOCK PARLAY:')) {
        inBonusParlay = true;
        inMainParlay = false;
        currentParlayTitle = line;
        summary += '\n' + line + '\n';
        continue;
      }
      
      // Extract just Game and Bet lines (handle both indented and non-indented)
      if ((inMainParlay || inBonusParlay)) {
        if (line.startsWith('Game:') || line.includes('Game:')) {
          summary += line.replace(/^\s+/, '') + '\n'; // Remove leading spaces
        }
        if (line.startsWith('Bet:') || line.includes('Bet:')) {
          summary += line.replace(/^\s+/, '') + '\n'; // Remove leading spaces
        }
      }
      
      // Get payout information
      if ((inMainParlay || inBonusParlay) && (line.includes('Payout on $100:') || line.startsWith('**Payout on $100:**'))) {
        // Clean up payout line
        const cleanPayout = line.replace(/\*\*/g, '').replace('Payout on $100:', 'Payout:');
        summary += cleanPayout + '\n';
        
        // If this was the bonus parlay payout, we're done
        if (inBonusParlay) {
          break;
        }
      }
    }
    
    return summary.trim();
  };

  const handleSummaryCopy = () => {
    if (results) {
      const summary = extractSummary(results);
      navigator.clipboard.writeText(summary).then(() => {
        setSummaryCopped(true);
        setTimeout(() => setSummaryCopped(false), 2000);
      });
    }
  };

  const fetchParlaySuggestion = useCallback(async () => {
    if (loading || selectedSports.length === 0 || selectedBetTypes.length === 0) return;

    setLoading(true);
    setResults('');
    setError(null);
    setLoadingMessage(getRandomLoadingMessage());

    try {
      const response = await fetch('/api/generate-parlay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedSports,
          selectedBetTypes,
          numLegs,
          oddsPlatform,
          aiModel,
          riskLevel,
          dateRange
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Server error: ${response.status} - ${errText}`);
      }
      const data = await response.json();
      if (!data.content) throw new Error('No content returned from AI');

      setResults(data.content);
    } catch (e) {
      setError(`Failed to generate parlays: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [loading, selectedSports, selectedBetTypes, numLegs, oddsPlatform, aiModel, riskLevel, dateRange]);

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
            options={['NFL', 'NCAAF', 'NBA', 'MLB', 'NHL', 'Soccer', 'PGA/Golf', 'Tennis', 'UFC']}
            selectedOptions={selectedSports}
            onToggle={toggleSport}
          />
          <CheckboxGroup
            label="2. Bet-Type/Focus (Select Multiple)"
            options={['Moneyline/Spread', 'Player Props', 'TD Props', 'Totals (O/U)', 'Team Props']}
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
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Dropdown
            label="5. Risk Level"
            value={riskLevel}
            onChange={setRiskLevel}
            options={Object.keys(RISK_LEVEL_DEFINITIONS)}
            description={RISK_LEVEL_DEFINITIONS[riskLevel]}
          />
          <Dropdown
            label="6. Odds Platform"
            value={oddsPlatform}
            onChange={setOddsPlatform}
            options={['DraftKings', 'FanDuel', 'MGM', 'Caesars', 'Bet365']}
          />
        </div>

        <button
          onClick={fetchParlaySuggestion}
          disabled={loading || selectedSports.length === 0 || selectedBetTypes.length === 0}
          className={`w-full py-4 mt-4 font-bold text-lg rounded-xl shadow-2xl transition duration-300 transform active:scale-95 ${
            loading || selectedSports.length === 0 || selectedBetTypes.length === 0
              ? 'bg-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600'
          }`}
        >
          {loading ? 'Generating Parlays...' : `Generate ${numLegs}-Leg Parlay + Bonus`}
        </button>
        
        <AiModelToggle aiModel={aiModel} setAiModel={setAiModel} />

        {selectedSports.length === 0 && <p className="text-xs text-center text-red-400">⚠️ Select at least one sport</p>}
        {selectedBetTypes.length === 0 && <p className="text-xs text-center text-red-400">⚠️ Select at least one bet type</p>}
      </div>

      <div className="mt-8 pt-4 border-t border-gray-700 max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold mb-4 text-yellow-400">AI-Powered Parlay Analysis</h2>
        <p className="text-sm text-gray-500 mb-4 italic">I know you're gambling with your kids college fund but be patient. Odds are being pulled, external research is being done and the analyst is making custom picks....</p>

        {error && <div className="p-4 bg-red-800 rounded-xl text-red-100 shadow-md"><p className="font-bold">Error:</p><p>{error}</p></div>}
        
        {loading && (
          <div className="p-8 text-center border-2 border-yellow-500 rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 shadow-2xl">
            <div className="flex flex-col items-center space-y-4">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
                <div className="absolute inset-2 border-4 border-red-500 border-t-transparent rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '0.6s' }}></div>
              </div>
              <p className="text-xl font-bold text-yellow-400 animate-pulse">{loadingMessage}</p>
              <div className="flex space-x-1 mt-2">
                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}

        {results && !loading && (
          <div className="relative p-6 bg-gray-800 rounded-xl shadow-lg">
            <div className="absolute top-3 right-3 flex gap-2 z-10">
              <button
                onClick={handleCopy}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-1 px-3 rounded-lg text-xs transition"
              >
                {copied ? 'Copied! ✅' : 'Copy All'}
              </button>
              <button
                onClick={handleSummaryCopy}
                className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-1 px-3 rounded-lg text-xs transition"
              >
                {summarycopied ? 'Summary Copied! ✅' : 'Copy Summary'}
              </button>
            </div>
            <div className="overflow-y-auto max-h-[70vh] pt-12">
              <pre className="whitespace-pre-wrap text-gray-300 font-sans">{results}</pre>
            </div>
          </div>
        )}

        {!loading && !error && !results && (
          <div className="p-6 text-center text-gray-500 border border-dashed border-gray-700 rounded-xl">
            <p>Configure your parlay preferences above and hit Generate!</p>
          </div>
        )}
      </div>

      {/* Updated Widget with Bisque Boys header and risk box, but replaced grid with AI workflow */}
      <div className="max-w-2xl mx-auto mt-12 mb-4">
        <div className="bg-gradient-to-r from-gray-800 via-gray-900 to-gray-800 rounded-xl p-6 border border-gray-700 shadow-2xl">
          {/* A BISQUE BOYS APPLICATION header */}
          <div className="flex items-center justify-center space-x-3 mb-4">
            <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
            <p className="uppercase font-bold text-sm text-gray-400 tracking-widest">
              A BISQUE BOYS APPLICATION
            </p>
            <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
          </div>
          
          {/* Risk-level box */}
          {riskLevel === 'Low' && (
            <div className="mb-4 bg-blue-900 border-2 border-blue-500 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-blue-300">😴 SNOOZE BET 😴</p>
              <p className="text-xs text-blue-400 mt-1">Playing it safe, huh? Boring but smart.</p>
            </div>
          )}
          {riskLevel === 'Medium' && (
            <div className="mb-4 bg-yellow-900 border-2 border-yellow-500 rounded-lg p-3 text-center">
              <p className="text-xs text-yellow-400 mt-1">Mid level risk</p>
              <p className="text-xl font-bold text-yellow-300">🤪 YOU'RE LOCO AND I LIKEY 🤪</p>
              <p className="text-xs text-yellow-400 mt-1">Balanced chaos - my favorite!</p>
            </div>
          )}
          {riskLevel === 'High' && (
            <div className="mb-4 bg-red-900 border-2 border-red-500 rounded-lg p-3 text-center animate-pulse">
              <p className="text-xl font-bold text-red-300">🔥 DEGENERATE IN THE FLESH 🔥</p>
              <p className="text-xs text-red-400 mt-1">Full degen mode activated! Let's gooo!</p>
            </div>
          )}
        </div>
      </div>

      {/* AI Agents Workflow Component */}
      <AIAgentsWorkflow />
    </div>
  );
};

export default App;