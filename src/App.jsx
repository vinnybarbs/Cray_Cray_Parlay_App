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
      <label className="text-gray-200 text-sm font-semibold">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-gray-700 text-white p-3 rounded-xl border border-yellow-500 focus:ring-yellow-400 focus:border-yellow-400 transition duration-150 shadow-lg appearance-none cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt} value={opt} className="text-sm">
            {opt}
          </option>
        ))}
      </select>
      {description && (
        <p className="text-xs text-gray-400 mt-1 italic">{description}</p>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-4">
      <style>{`
        /* Custom Scrollbar for better UX */
        .results-box::-webkit-scrollbar {
          width: 8px;
        }
        .results-box::-webkit-scrollbar-thumb {
          background-color: #f59e0b;
          border-radius: 4px;
        }
        .results-box {
          scrollbar-width: thin;
          scrollbar-color: #f59e0b #1f2937;
        }
      `}</style>
      <header className="flex flex-col items-center justify-center py-6 mb-6 bg-gray-800 rounded-2xl shadow-2xl">
        {/* LOGO REMOVED - Clean, title-only header now */}
        <h1 className="text-4xl font-extrabold tracking-tight mt-2 text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-red-500">
          Cray Cray
        </h1>
        <p className="text-xl font-medium text-gray-300">for Parlays</p>
      </header>

      <div className="space-y-6 max-w-lg mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Dropdown
            label="3. Number of Legs"
            value={numLegs}
            onChange={val => setNumLegs(parseInt(val))}
            options={[2, 3, 4, 5, 6]}
          />
          <Dropdown
            label="4. Bet Type Focus"
            value={betType}
            onChange={setBetType}
            options={['Moneyline/Spread', 'Player Props', 'Totals (Over/Under)', 'Team Props', 'Combo, Surprise Me']}
          />
        </div>

        <Dropdown
          label="5. Preferred Odds Platform"
          value={oddsPlatform}
          onChange={setOddsPlatform}
          options={['DraftKings', 'FanDuel', 'MGM', 'Caesars', 'Bet365']}
        />

        <button
          onClick={fetchParlaySuggestion}
          disabled={loading}
          className={`w-full py-4 mt-8 font-bold text-lg rounded-xl shadow-2xl transition duration-300 transform active:scale-95
            ${loading
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
              Analyzing Current Odds...
            </div>
          ) : (
            `Generate ${numLegs}-Leg Parlay Suggestions`
          )}
        </button>

        {userId && (
            <p className="text-xs text-center text-gray-500 pt-2">
                User ID: {userId}
            </p>
        )}
      </div>

      {/* Results Display Area */}
      <div className="mt-8 pt-4 border-t border-gray-700 max-w-lg mx-auto">
        <h2 className="text-2xl font-bold mb-4 text-yellow-400">Parlay Analyst Report</h2>

        {error && (
          <div className="p-4 bg-red-800 rounded-xl text-red-100 shadow-md">
            <p className="font-bold">Error:</p>
            <p>{error}</p>
          </div>
        )}

        {results && (
          <div className="results-box p-4 bg-gray-800 rounded-xl shadow-lg overflow-y-auto max-h-[70vh]">
            {/* The dangerouslySetInnerHTML is used to render the Markdown output from Gemini correctly. */}
            <article className="prose prose-invert prose-p:text-gray-300 prose-li:text-gray-300 prose-strong:text-yellow-400 max-w-none">
              <div dangerouslySetInnerHTML={{ __html: results.replace(/\n/g, '<br/>') }} />
            </article>
          </div>
        )}

        {!loading && !error && !results && (
            <div className="p-6 text-center text-gray-500 border border-dashed border-gray-700 rounded-xl">
                <p>Select your criteria above and click "Generate" to receive a highly detailed, data-backed parlay analysis.</p>
            </div>
        )}
      </div>
      
      {/* Footer Text: A BISQUE BOYS APPLICATION */}
      <div className="max-w-lg mx-auto mt-12 mb-4 text-center">
        <p className="uppercase font-bold text-xs text-gray-700 tracking-widest">
          A BISQUE BOYS APPLICATION
        </p>
      </div>

    </div>
  );
};

export default App;