import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, setLogLevel } from 'firebase/firestore';

// --- API Configuration ---
// !!! IMPORTANT: FOR PUBLIC DEPLOYMENT, YOUR GEMINI API KEY IS HARDCODED HERE !!!
const API_KEY = "AIzaSyDTj7cJ5lNh2_MXyFW6bTyHkU1CcThZr18"; 
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;
const MAX_RETRIES = 5;

// Global variables provided by the Canvas environment for Firebase setup
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Application Component ---
const App = () => {
    // --- State Management ---
    const [selections, setSelections] = useState({
        sport: 'NFL/Football',
        riskLevel: 'medium',
        legs: '2',
        betType: 'moneyline',
        platform: 'draftkings',
    });
    const [loading, setLoading] = useState(false);
    const [report, setReport] = useState(null);
    const [error, setError] = useState(null);
    const [sources, setSources] = useState([]);

    // --- Firebase/Auth State ---
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    // Removed userId state as requested, keeping internal setup for stability if needed

    // --- Firebase Initialization and Auth ---
    useEffect(() => {
        try {
            if (Object.keys(firebaseConfig).length > 0) {
                setLogLevel('debug'); // Enable Firestore logging
                const app = initializeApp(firebaseConfig);
                const firestore = getFirestore(app);
                const authInstance = getAuth(app);

                setDb(firestore);
                setAuth(authInstance);

                const authenticate = async () => {
                    try {
                        if (initialAuthToken) {
                            await signInWithCustomToken(authInstance, initialAuthToken);
                        } else {
                            await signInAnonymously(authInstance);
                        }
                    } catch (e) {
                        console.error("Firebase Auth failed:", e);
                    }
                };

                authenticate();
            }
        } catch (e) {
            console.error("Critical Firebase Initialization Error:", e);
        }
    }, []);

    // --- Data Definitions ---
    const sportsOptions = [
        { value: 'NFL/Football', label: 'NFL/Football' },
        { value: 'NBA/Basketball', label: 'NBA/Basketball' },
        { value: 'MLB/Baseball', label: 'MLB/Baseball' },
        { value: 'NHL/Hockey', label: 'NHL/Hockey' },
        { value: 'UFC/MMA', label: 'UFC/MMA' },
        { value: 'PGA/Golf', label: 'PGA/Golf' },
        { value: 'Tennis/ATP/WTA', label: 'Tennis/ATP/WTA' },
    ];

    const riskLevelOptions = [
        { value: 'low', label: 'Low Risk (High Probability)', desc: 'Focus on high-confidence, heavily favored outcomes. Combined odds likely between +150 and +250.' },
        { value: 'medium', label: 'Medium Risk (Balanced)', desc: 'Focus on value bets, slight underdogs, and balanced odds. Combined odds likely between +300 and +500.' },
        { value: 'high', label: 'High Risk (Longshot)', desc: 'Focus on deep underdogs and high-payout props. Combined odds likely above +600.' },
    ];

    const betTypeOptions = [
        { value: 'moneyline', label: 'Moneyline (Winner)' },
        { value: 'spread', label: 'Spread (Handicap)' },
        { value: 'prop', label: 'Player/Game Props' },
        { value: 'combo', label: 'Combo, Surprise Me' },
    ];

    // --- Logic ---

    const getRiskDescription = (level) => {
        const option = riskLevelOptions.find(o => o.value === level);
        return option ? option.desc : '';
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setSelections(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const generateGeminiPrompt = () => {
        const { sport, riskLevel, legs, betType, platform } = selections;
        let riskInstruction;

        switch (riskLevel) {
            case 'low':
                riskInstruction = "Focus heavily on heavy favorites and high-confidence, data-backed picks, keeping the combined odds modest (approx. +150 to +250).";
                break;
            case 'medium':
                riskInstruction = "Focus on balanced value bets, positive correlation, and sharp money trends. Target combined odds between +300 and +500.";
                break;
            case 'high':
                riskInstruction = "Focus on longshot value, deep underdogs, and high-payout correlations. Target combined odds above +600.";
                break;
            default:
                riskInstruction = "Use a balanced approach focusing on value bets and positive correlations.";
        }

        let betInstruction;
        if (betType === 'combo') {
            betInstruction = "You have full freedom to combine any market (Moneyline, Spread, Player/Game Props) that offers the best value and correlation.";
        } else {
            betInstruction = `All suggested legs MUST use the ${betType} market.`;
        }

        return `
            You are a world-class sports betting analyst with access to real-time odds, team and player stats, historical performance, injury reports, weather, venue data, rest and travel schedules, and public betting trends.

            Your current task: Suggest three high-probability ${legs}-leg parlays based on today's games in the ${sport} league.
            
            **Instructions:**
            1. **Risk/Odds Goal:** This must be a ${riskLevel} risk parlay. ${riskInstruction}
            2. **Market Focus:** ${betInstruction}
            3. **Platform:** Ensure the odds and lines are sourced from the ${platform} platform if possible.
            4. **Data Grounding:** Use your live search access to provide up-to-date, real-time data for all picks. **Do not use historical or static data for odds or lines.**

            **For EACH parlay (3 total), include:**
            - Total combined odds (in American format, e.g., +250).
            - Cumulative implied probability.
            - Detailed reasoning for why these legs are combined (statistical or tactical fit).

            **For EACH leg, include:**
            - Sport and league (e.g., 'NFL').
            - Teams or players involved.
            - Market (moneyline, spread, total, prop).
            - Odds (in American format, e.g., -110 or +150).
            - Confidence rating (1–10).
            - Key data points backing the pick (e.g., recent performance, injury reports).
            - Risk flags (e.g., key injury status, severe travel fatigue).

            Provide full, clear reasoning for every selection. Structure the output clearly in Markdown.
        `;
    };

    const runParlayAnalysis = async () => {
        setLoading(true);
        setError(null);
        setReport(null);
        setSources([]);

        const systemPrompt = "You are a world-class sports betting analyst. Always use current, real-time data. Output your full analysis in clear Markdown format. Ensure all suggested parlays meet the required risk level and market focus.";
        const userQuery = generateGeminiPrompt();

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            // Enable Google Search grounding for real-time odds and data
            tools: [{ "google_search": {} }],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
        };

        try {
            let response = null;
            let success = false;
            let lastError = null;

            for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                const fetchPromise = fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                response = await fetchPromise;

                if (response.ok) {
                    success = true;
                    break;
                } else if (response.status === 429) {
                    // Exponential backoff for rate limiting
                    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                    lastError = `Rate limit hit. Retrying in ${Math.round(delay / 1000)}s...`;
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    lastError = `API Error: ${response.status} ${response.statusText}`;
                    break; // Non-recoverable error
                }
            }

            if (!success || !response) {
                throw new Error(`Failed to generate content after ${MAX_RETRIES} attempts. Last error: ${lastError}`);
            }

            const result = await response.json();
            const candidate = result.candidates?.[0];

            if (candidate && candidate.content?.parts?.[0]?.text) {
                const text = candidate.content.parts[0].text;
                setReport(text);

                // Extract grounding sources
                let extractedSources = [];
                const groundingMetadata = candidate.groundingMetadata;
                if (groundingMetadata && groundingMetadata.groundingAttributions) {
                    extractedSources = groundingMetadata.groundingAttributions
                        .map(attribution => ({
                            uri: attribution.web?.uri,
                            title: attribution.web?.title,
                        }))
                        .filter(source => source.uri && source.title);
                }
                setSources(extractedSources);

            } else {
                throw new Error("Gemini returned an empty or malformed response.");
            }

        } catch (e) {
            console.error("Analysis failed:", e);
            setError(`Analysis failed: ${e.message}. Please try again later.`);
        } finally {
            setLoading(false);
        }
    };

    // --- UI Rendering ---
    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 font-sans p-4 sm:p-8">
            <style jsx global>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
                body { font-family: 'Inter', sans-serif; }
            `}</style>

            {/* Header */}
            <div className="max-w-4xl mx-auto mb-8 bg-gray-800 p-6 rounded-xl shadow-2xl border border-yellow-500/30">
                <h1 className="text-4xl sm:text-5xl font-extrabold text-center text-yellow-400 mb-2 tracking-tight">
                    CRAY CRAY FOR PARLAYS
                </h1>
                <p className="text-center text-gray-400 text-lg">
                    AI-Driven Parlay Analysis
                </p>
            </div>

            {/* Input Configuration Card */}
            <div className="max-w-4xl mx-auto bg-gray-800 p-6 rounded-xl shadow-2xl border border-gray-700/50 mb-8">
                <h2 className="text-2xl font-bold text-gray-200 mb-6 border-b border-gray-700 pb-2">Parlay Criteria</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">

                    {/* Sport Dropdown */}
                    <div className="lg:col-span-1">
                        <label htmlFor="sport" className="block text-sm font-medium text-gray-300 mb-1">Sport/League</label>
                        <select
                            id="sport"
                            name="sport"
                            value={selections.sport}
                            onChange={handleChange}
                            className="w-full p-2.5 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:ring-yellow-500 focus:border-yellow-500 transition duration-150"
                        >
                            {sportsOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Risk Level Dropdown */}
                    <div className="lg:col-span-2">
                        <label htmlFor="riskLevel" className="block text-sm font-medium text-gray-300 mb-1">Risk Level</label>
                        <select
                            id="riskLevel"
                            name="riskLevel"
                            value={selections.riskLevel}
                            onChange={handleChange}
                            className="w-full p-2.5 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:ring-yellow-500 focus:border-yellow-500 transition duration-150"
                        >
                            {riskLevelOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-400 mt-2 p-1 bg-gray-700/50 rounded-md">
                            **{selections.riskLevel.toUpperCase()}** Risk: {getRiskDescription(selections.riskLevel)}
                        </p>
                    </div>

                    {/* Legs Dropdown */}
                    <div className="lg:col-span-1">
                        <label htmlFor="legs" className="block text-sm font-medium text-gray-300 mb-1">Number of Legs</label>
                        <select
                            id="legs"
                            name="legs"
                            value={selections.legs}
                            onChange={handleChange}
                            className="w-full p-2.5 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:ring-yellow-500 focus:border-yellow-500 transition duration-150"
                        >
                            {['2', '3', '4', '5'].map(num => (
                                <option key={num} value={num}>{num} Legs</option>
                            ))}
                        </select>
                    </div>

                    {/* Bet Type Dropdown */}
                    <div className="lg:col-span-1">
                        <label htmlFor="betType" className="block text-sm font-medium text-gray-300 mb-1">Bet Type Focus</label>
                        <select
                            id="betType"
                            name="betType"
                            value={selections.betType}
                            onChange={handleChange}
                            className="w-full p-2.5 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:ring-yellow-500 focus:border-yellow-500 transition duration-150"
                        >
                            {betTypeOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Platform Dropdown (Full Width for alignment) */}
                    <div className="md:col-span-2 lg:col-span-2">
                        <label htmlFor="platform" className="block text-sm font-medium text-gray-300 mb-1">Preferred Odds Platform</label>
                        <select
                            id="platform"
                            name="platform"
                            value={selections.platform}
                            onChange={handleChange}
                            className="w-full p-2.5 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 focus:ring-yellow-500 focus:border-yellow-500 transition duration-150"
                        >
                            {['draftkings', 'fanduel', 'mgm', 'bet365'].map(plat => (
                                <option key={plat} value={plat}>{plat.charAt(0).toUpperCase() + plat.slice(1)}</option>
                            ))}
                        </select>
                    </div>

                    {/* Generate Button (Full Width) */}
                    <div className="md:col-span-2 lg:col-span-3 flex justify-end">
                        <button
                            onClick={runParlayAnalysis}
                            disabled={loading}
                            className={`w-full md:w-auto px-6 py-3 mt-6 text-lg font-semibold rounded-lg shadow-lg transform transition duration-150 ${
                                loading
                                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                    : 'bg-yellow-600 hover:bg-yellow-500 text-gray-900 hover:scale-[1.02]'
                            }`}
                        >
                            {loading ? (
                                <span className="flex items-center justify-center">
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-gray-900" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Analyzing {selections.sport}...
                                </span>
                            ) : (
                                `Generate ${selections.legs}-Leg ${selections.riskLevel.toUpperCase()} Parlay`
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Output Card */}
            <div className="max-w-4xl mx-auto bg-gray-800 p-6 rounded-xl shadow-2xl border border-gray-700/50">
                <h2 className="text-2xl font-bold text-gray-200 mb-4 border-b border-gray-700 pb-2">Parlay Analyst Report</h2>

                {error && (
                    <div className="bg-red-900 p-4 rounded-lg text-red-300 text-sm">
                        <p className="font-semibold">Error:</p>
                        <p>{error}</p>
                    </div>
                )}

                {!loading && report && (
                    <div className="prose prose-invert max-w-none text-gray-300">
                        <div dangerouslySetInnerHTML={{ __html: report.replaceAll('\n', '<br>') }} />
                        
                        {sources.length > 0 && (
                            <div className="mt-6 pt-4 border-t border-gray-700">
                                <h4 className="text-sm font-bold text-gray-400 mb-2">Sources (Real-Time Grounding)</h4>
                                <ul className="list-disc list-inside space-y-1 text-xs text-gray-500">
                                    {sources.map((src, index) => (
                                        <li key={index}>
                                            <a href={src.uri} target="_blank" rel="noopener noreferrer" className="hover:text-yellow-500 transition duration-150">
                                                {src.title || 'Source link'}
                                            </a>
                                            <span className="text-gray-600 ml-2">({new URL(src.uri).hostname})</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}

                {!loading && !report && !error && (
                    <p className="text-gray-500 italic text-center py-12">
                        Configure your parlay above and click 'Generate' to receive your data-driven analysis.
                    </p>
                )}
            </div>

            {/* Footer */}
            <div className="text-center mt-8">
                <p className="text-xs font-bold tracking-widest uppercase text-gray-500">
                    A BISQUE BOYS APPLICATION
                </p>
            </div>
        </div>
    );
};

export default App;
