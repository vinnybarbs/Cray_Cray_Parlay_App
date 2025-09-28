import React, { useState, useEffect, useCallback } from 'react';

// --- Firebase Imports (Mandatory Setup) ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, setLogLevel } from 'firebase/firestore';

// Define the global variables provided by the environment
// NOTE: These variables are replaced with dummy values in the deployment_guide.md 
// for public hosting, but kept here for Canvas execution.
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'cray-cray-app-id';

// API Key Placeholder
// !!! IMPORTANT: FOR PUBLIC DEPLOYMENT, PASTE YOUR GEMINI API KEY HERE !!!
const API_KEY = "AIzaSyDTj7cJ5lNh2_MXyFW6bTyHkU1CcThZr18"; // Your key has been inserted here!

// Risk Level Definitions for the UI
const RISK_LEVEL_DEFINITIONS = {
  'Low': "High probability to hit the bet, focusing on heavy favorites and well-correlated outcomes. Lower payout, higher win chance.",
  'Medium': "Balanced approach combining strong data-backed favorites with one moderate underdog/prop. Target: +200 to +400 odds.",
  'High': "Focus on value underdogs and high-variance outcomes for massive payouts. Higher risk, target: +500+ odds.",
};

const App = () => {
  // --- UI State ---
  const [sport, setSport] = useState('NFL');
  const [riskLevel, setRiskLevel] = useState('Low'); // Default to Low as requested in description
  const [numLegs, setNumLegs] = useState(2);
  const [betType, setBetType] = useState('Moneyline/Spread');
  const [oddsPlatform, setOddsPlatform] = useState('DraftKings');

  // --- API State ---
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState('');
  const [error, setError] = useState(null);

  // --- Firebase State (Setup) ---
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // --- Firebase Initialization and Authentication ---
  useEffect(() => {
    try {
      if (Object.keys(firebaseConfig).length === 0) {
          console.error("Firebase config is missing. Cannot initialize Firebase.");
          return;
      }
      setLogLevel('debug');
      const app = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(app);
      const firebaseAuth = getAuth(app);

      setDb(firestoreDb);
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          setUserId(user.uid);
        } else {
          // If no user is signed in, sign in anonymously or use custom token
          try {
            if (initialAuthToken) {
              const userCredential = await signInWithCustomToken(firebaseAuth, initialAuthToken);
              setUserId(userCredential.user.uid);
            } else {
              const userCredential = await signInAnonymously(firebaseAuth);
              setUserId(crypto.randomUUID());
            }
          } catch (e) {
            console.error("Firebase Auth Error on startup:", e);
            // Fallback: use a random ID if auth fails
            setUserId(crypto.randomUUID());
          }
        }
        setIsAuthReady(true);
      });
      return () => unsubscribe();
    } catch (e) {
      console.error("Critical Firebase Initialization Error:", e);
      setIsAuthReady(true); // Mark ready to proceed without Firebase features
      setUserId(crypto.randomUUID());
    }
  }, []); // Run only once for setup

  // --- Prompt Generation Logic ---
  const generateGeminiPrompt = useCallback(() => {
    const riskDescription = RISK_LEVEL_DEFINITIONS[riskLevel];
    
    // Determine the Bet Type instruction based on the selection
    let betTypeInstruction = `Focus primarily on ${betType} markets.`;
    if (betType === 'Combo, Surprise Me') {
        betTypeInstruction = `You are free to use any combination of markets (Moneyline, Spread, Player Props, Totals, etc.) that you believe creates the best value and correlation for this parlay.`;
    }

    // UPDATED: Added explicit instruction to use Google Search tool for current data.
    return `
      You are a top-tier sports betting analyst. **You MUST use your access to Google Search to find and incorporate the latest odds and data.** Suggest three high-probability ${numLegs}-leg parlays based on analysis of **REAL-TIME** odds, team/player stats, historical performance, injury reports, and public trends for **TODAY'S** ${sport} games. The required risk profile is **${riskLevel}** (${riskDescription}). ${betTypeInstruction}

      Target: Each parlay must have combined American odds of at least +200 (for Low/Medium risk) and at least +500 (for High risk).

      Required Output Structure for Each Parlay:
      1. Three high-confidence parlays (P1, P2, P3).
      2. For each leg, detail: Sport/League, Teams/Players, Market, **Current Odds (from ${oddsPlatform} data)**, Confidence (1-10), Key Data Points, and Risk Flags (e.g., weather, injury, schedule fatigue).
      3. Include the Cumulative Implied Probability and the statistical/tactical reasoning for combining the legs (positive correlation).
      4. Optional: 1 backup parlay (P_Backup) with higher win probability and lower payout.

      Analyze the current environment based on the assumption the odds platform is **${oddsPlatform}**. Provide full reasoning for every selection. Format the response strictly using Markdown.
    `.trim();
  }, [sport, riskLevel, numLegs, betType, oddsPlatform]);

  // --- Gemini API Call Logic with Exponential Backoff ---
  const fetchParlaySuggestion = useCallback(async () => {
    const userQuery = generateGeminiPrompt();

    if (loading) return;

    setLoading(true);
    setResults('');
    setError(null);

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;
    const payload = {
      contents: [{ parts: [{ text: userQuery }] }],
      // Use Google Search for grounding (real-time data)
      tools: [{ "google_search": {} }],
      systemInstruction: {
          parts: [{ text: "You are a highly analytical and concise sports betting expert." }]
      },
    };

    const maxRetries = 5;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        const candidate = result.candidates?.[0];

        if (candidate && candidate.content?.parts?.[0]?.text) {
          const text = candidate.content.parts[0].text;
          setResults(text);
          setLoading(false);
          return;
        } else {
          throw new Error('Invalid response structure from Gemini API.');
        }
      } catch (e) {
        if (i < maxRetries - 1) {
          // Exponential backoff
          const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error("Gemini API call failed after max retries:", e);
          setError("Failed to fetch parlay suggestions. Please check your network or try again.");
          setLoading(false);
        }
      }
    }
  }, [generateGeminiPrompt, loading]);

  // --- UI Components ---

  const Dropdown = ({ label, value, onChange, options, description }) => (
    <div className="flex flex-col space-y-2">
      {/* Label and description now uses a more distinct color */}
      <label className="text-gray-300 text-sm font-semibold tracking-wide flex items-center">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Redesigned select: Darker background, bright green focus/border
        className="bg-gray-700 text-white p-3 rounded-lg border border-gray-600 focus:ring-green-500 focus:border-green-500 transition duration-200 shadow-md appearance-none cursor-pointer hover:border-green-500/50"
      >
        {options.map((opt) => (
          <option key={opt} value={opt} className="text-sm">
            {opt}
          </option>
        ))}
      </select>
      {description && (
        <p className="text-xs text-gray-500 mt-1 italic leading-tight">{description}</p>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-4 sm:p-8">
      <style>{`
        /* Custom Scrollbar for better UX (Matching the green/gold theme) */
        .results-box::-webkit-scrollbar {
          width: 8px;
        }
        .results-box::-webkit-scrollbar-thumb {
          background-color: #10b981; /* Emerald Green */
          border-radius: 4px;
        }
        .results-box::-webkit-scrollbar-track {
           background-color: #1f2937;
        }
        .results-box {
          scrollbar-width: thin;
          scrollbar-color: #10b981 #1f2937;
        }

        /* Basic Markdown Styling inside the results box */
        .results-box h3 {
            font-size: 1.5rem; /* text-xl */
            font-weight: 700; /* font-bold */
            margin-top: 1rem;
            margin-bottom: 0.5rem;
            color: #f59e0b; /* Amber */
        }
        .results-box strong {
            color: #10bb81; /* Emerald Green */
        }
      `}</style>

      {/* Main App Content Wrapper: Centered and responsive */}
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex flex-col items-center justify-center py-8 bg-gray-800 rounded-xl shadow-xl border-b border-green-500/50">
          <h1 className="text-6xl font-extrabold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-yellow-400 drop-shadow-lg">
            Cray Cray
          </h1>
          <p className="text-2xl font-light text-gray-400 tracking-wide mt-1">for Parlays</p>
        </header>

        {/* Input/Form Card */}
        <div className="bg-gray-800 p-6 sm:p-8 rounded-xl shadow-2xl border border-gray-700 space-y-6">
          <h2 className="text-2xl font-bold text-gray-100 border-b border-gray-700 pb-3 mb-4">
              Parlay Generation Settings
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Dropdown
              label="1. Sport"
              value={sport}
              onChange={setSport}
              options={['NFL', 'NBA', 'MLB', 'NHL', 'Soccer', 'NCAAF', 'PGA/Golf', 'Tennis/ATP/WTA']}
            />
            <Dropdown
              label="2. Risk Level"
              value={riskLevel}
              onChange={setRiskLevel}
              options={Object.keys(RISK_LEVEL_DEFINITIONS)}
              description={RISK_LEVEL_DEFINITIONS[riskLevel]}
            />
            <Dropdown
              label="3. Number of Legs"
              value={numLegs}
              onChange={val => setNumLegs(parseInt(val))}
              options={[2, 3, 4, 5, 6]}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
            <Dropdown
              label="4. Bet Type Focus"
              value={betType}
              onChange={setBetType}
              options={['Moneyline/Spread', 'Player Props', 'Totals (Over/Under)', 'Team Props', 'Combo, Surprise Me']}
            />
            <Dropdown
              label="5. Preferred Odds Platform"
              value={oddsPlatform}
              onChange={setOddsPlatform}
              options={['DraftKings', 'FanDuel', 'MGM', 'Caesars', 'Bet365']}
            />
          </div>

          <button
            onClick={fetchParlaySuggestion}
            disabled={loading}
            className={`w-full py-4 mt-6 font-extrabold text-xl rounded-xl transition duration-300 transform active:scale-[0.98] border-b-4 ${loading
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed border-gray-700 shadow-inner'
                : 'bg-gradient-to-r from-green-500 to-lime-600 text-gray-900 hover:from-green-400 hover:to-lime-500 shadow-green-500/50 shadow-xl border-green-700'
              }`}
          >
            {loading ? (
              <div className="flex items-center justify-center space-x-3">
                <svg className="animate-spin h-5 w-5 text-gray-900" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeLinecap="round"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-gray-900">Analyzing Current Odds...</span>
              </div>
            ) : (
              `🔥 Generate ${numLegs}-Leg Parlay Suggestions`
            )}
          </button>
        </div>

        {/* User ID Display */}
        {userId && (
          <p className="text-xs text-center text-gray-600 pt-2">
            User ID: {userId} (Used for session identification)
          </p>
        )}

        {/* Results Display Area */}
        <div className="pt-4">
          <h2 className="text-3xl font-bold mb-4 text-yellow-400 text-center">Analyst Report</h2>

          {error && (
            <div className="p-4 bg-red-900 border border-red-700 rounded-xl text-red-100 shadow-md">
              <p className="font-bold">Error Encountered:</p>
              <p>{error}</p>
            </div>
          )}

          {results && (
            // Custom CSS ensures markdown elements within this box are styled beautifully
            <div className="results-box p-6 bg-gray-800 rounded-xl shadow-2xl border border-gray-700 overflow-y-auto max-h-[80vh]">
              <div dangerouslySetInnerHTML={{ __html: results.replace(/\n/g, '<br/>') }} />
            </div>
          )}

          {!loading && !error && !results && (
              <div className="p-10 text-center text-gray-500 border-2 border-dashed border-gray-700 rounded-xl">
                  <p className="text-xl font-medium">Ready for the Data Drop?</p>
                  <p className="mt-2">Select your criteria above and click **Generate** to receive a highly detailed, data-backed parlay analysis tailored to your risk profile.</p>
              </div>
          )}
        </div>
      
        {/* Footer Text */}
        <div className="mt-12 mb-4 text-center">
          <p className="uppercase font-medium text-xs text-gray-700 tracking-[0.2em] pb-8">
            A BISQUE BOYS APPLICATION
          </p>
        </div>
      </div>
    </div>
  );
};

export default App;
