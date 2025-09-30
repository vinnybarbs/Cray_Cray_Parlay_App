// Enhanced backend with web search fallback for odds
// Replace your current /api/generate-parlay.js with this version

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

// Web search for odds when API data is insufficient
async function searchWebForOdds(selectedSports, selectedBetTypes, oddsPlatform, fetcher) {
  try {
    const SERPER_API_KEY = process.env.SERPER_API_KEY; // Google Search API
    
    if (!SERPER_API_KEY) {
      console.warn('No SERPER_API_KEY found - skipping web search fallback');
      return null;
    }

    const sportsQuery = selectedSports.join(' ');
    const betTypesQuery = selectedBetTypes.join(' ');
    const today = new Date().toISOString().split('T')[0];
    
    // Search for today's games and odds
    const query = `${sportsQuery} ${betTypesQuery} odds ${oddsPlatform} today ${today}`;
    
    console.log('Searching web for:', query);
    
    const response = await fetcher('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: query,
        num: 10
      })
    });

    if (!response.ok) {
      console.warn('Web search failed:', response.status);
      return null;
    }

    const data = await response.json();
    
    // Extract relevant snippets and links
    const searchResults = data.organic?.slice(0, 5).map(result => ({
      title: result.title,
      snippet: result.snippet,
      link: result.link
    })) || [];

    return {
      query,
      results: searchResults,
      searchedAt: new Date().toISOString()
    };

  } catch (err) {
    console.error('Web search error:', err);
    return null;
  }
}

function generateAIPrompt({ selectedSports, selectedBetTypes, numLegs, riskLevel, oddsData, webSearchData }) {
  const sportsStr = (selectedSports || []).join(', ');
  const betTypesStr = (selectedBetTypes || []).join(', ');
  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

  // Format odds data from API
  const formatDate = (iso) => {
    if (!iso) return 'TBD';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    } catch (e) {
      return 'TBD';
    }
  };

  let oddsContext = '';
  let dataSource = '';
  let availableGames = [];

  // Primary: Use Odds API data if available
  if (oddsData && oddsData.length > 0) {
    const marketKeys = (selectedBetTypes || []).flatMap(bt => MARKET_MAPPING[bt] || []);
    
    oddsData.slice(0, 15).forEach((ev, idx) => {
      const gameDate = formatDate(ev.commence_time);
      const teams = `${ev.away_team || '?'} @ ${ev.home_team || '?'}`;
      const bm = (ev.bookmakers && ev.bookmakers[0]) || null;
      
      let marketsSummary = '';
      if (bm && Array.isArray(bm.markets)) {
        const parts = [];
        for (const m of bm.markets) {
          if (!marketKeys.includes(m.key)) continue;
          if (!Array.isArray(m.outcomes)) continue;
          
          if (m.key === 'h2h') {
            const h2h = m.outcomes.map(o => `${o.name}: ${o.price > 0 ? '+' : ''}${o.price}`).join(' vs ');
            parts.push(`Moneyline: ${h2h}`);
          } else if (m.key === 'spreads') {
            const spread = m.outcomes.map(o => `${o.name} ${o.point > 0 ? '+' : ''}${o.point} (${o.price > 0 ? '+' : ''}${o.price})`).join(' vs ');
            parts.push(`Spread: ${spread}`);
          } else if (m.key === 'totals') {
            const totals = m.outcomes.map(o => `${o.name} ${o.point} (${o.price > 0 ? '+' : ''}${o.price})`).join(' / ');
            parts.push(`Total: ${totals}`);
          }
        }
        marketsSummary = parts.join(' | ');
      }
      
      if (marketsSummary) {
        availableGames.push({
          number: idx + 1,
          date: gameDate,
          teams: teams,
          markets: marketsSummary
        });
      }
    });
    
    if (availableGames.length > 0) {
      dataSource = 'Odds API';
      const gamesList = availableGames.map(g => 
        `GAME #${g.number}:\nDATE: ${g.date}\nMATCHUP: ${g.teams}\nAVAILABLE BETS: ${g.markets}`
      ).join('\n\n');
      
      oddsContext = `\n\n════════════════════════════════════════════════════════════════
🔥 AVAILABLE GAMES WITH REAL ODDS - YOU MUST USE THESE EXACT GAMES 🔥
════════════════════════════════════════════════════════════════

${gamesList}

════════════════════════════════════════════════════════════════
TOTAL AVAILABLE GAMES: ${availableGames.length}
════════════════════════════════════════════════════════════════`;
    }
  }

  // Fallback: Use web search data if API has insufficient data
  if (availableGames.length < 3 && webSearchData && webSearchData.results.length > 0) {
    const searchItems = webSearchData.results.map((result, idx) => {
      return `SEARCH RESULT #${idx + 1}:\nTITLE: ${result.title}\nINFO: ${result.snippet}\nSOURCE: ${result.link}`;
    });

    dataSource = 'Web Search (API had insufficient data)';
    
    const webContext = `\n\n════════════════════════════════════════════════════════════════
🌐 WEB SEARCH RESULTS - EXTRACT GAMES AND ODDS FROM THESE 🌐
════════════════════════════════════════════════════════════════

SEARCH QUERY: "${webSearchData.query}"

${searchItems.join('\n\n')}

════════════════════════════════════════════════════════════════`;
    
    oddsContext = oddsContext ? `${oddsContext}\n${webContext}` : webContext;
  }

  // No data warning
  if (!oddsContext || availableGames.length === 0) {
    return `ERROR: NO GAME DATA AVAILABLE

Tell the user: "I couldn't find any upcoming games with odds data. Please try:
1. Selecting different sports (NFL, NBA have most games)
2. Different bet types
3. Checking back during peak sports season
4. Verifying API keys are configured correctly"

Do not generate fake games or odds.`;
  }

  return `
TODAY'S DATE: ${today}
DATA SOURCE: ${dataSource}
YOUR ROLE: Professional sports betting analyst

⚠️⚠️⚠️ CRITICAL INSTRUCTIONS - FAILURE TO FOLLOW = INVALID OUTPUT ⚠️⚠️⚠️

1. YOU MUST ONLY USE GAMES LISTED IN THE "AVAILABLE GAMES" SECTION BELOW
2. EVERY LEG MUST REFERENCE A SPECIFIC GAME NUMBER (e.g., "GAME #1", "GAME #3")
3. EVERY LEG MUST INCLUDE THE EXACT DATE SHOWN FOR THAT GAME
4. USE ONLY THE EXACT ODDS PROVIDED FOR EACH GAME
5. DO NOT INVENT, IMAGINE, OR HALLUCINATE ANY GAMES NOT IN THE DATA
6. IF YOU USE A GAME NOT IN THE LIST, YOUR OUTPUT IS INVALID
7. CREATE EXACTLY ${numLegs} LEGS FOR THE MAIN PARLAY

${oddsContext}

════════════════════════════════════════════════════════════════

YOUR TASK:
Using ONLY the ${availableGames.length} games listed above, create:
- ONE main parlay with EXACTLY ${numLegs} legs
- ONE bonus lock parlay with 2-3 high-confidence legs

REQUIRED OUTPUT FORMAT:

**🎯 ${numLegs}-Leg Parlay: [Funny Title]**

**Legs:**
1. 📅 DATE: [Exact date from game]
   GAME: [From GAME #X above]
   Matchup: [Away] @ [Home]
   Bet: [Specific bet with exact line]
   Odds: [Exact odds from data]
   Confidence: [X/10]
   Reasoning: [Why this hits]

2. 📅 DATE: [Exact date from game]
   GAME: [From GAME #X above]
   [Continue same format]

[Repeat for exactly ${numLegs} legs]

**Combined Odds:** [Calculate]
**Payout on $100:** [Calculate]
**Overall Confidence:** [X/10]

---

**🔒 BONUS LOCK PARLAY: [Conservative Title]**

**Legs:**
1-3. [Same format as above, 2-3 safer picks]

**Combined Odds:** [Calculate]
**Payout on $100:** [Calculate]
**Why These Are Locks:** [Brief explanation]

════════════════════════════════════════════════════════════════

VALIDATION CHECKLIST (Verify before responding):
✓ Used only games from the provided list (${availableGames.length} available)
✓ Referenced game numbers (GAME #1, GAME #2, etc.)
✓ Included exact dates for every leg
✓ Used exact odds from the data
✓ Created exactly ${numLegs} legs in main parlay
✓ Did not invent any teams, games, or odds

Risk Level: ${riskLevel}
Sports Focus: ${sportsStr}
Bet Types: ${betTypesStr}

TONE: Professional with subtle humor. Be concise.
`.trim();
}

module.exports = async function handler(req, res) {
  // Resolve fetch implementation
  let fetcher = globalThis.fetch;
  if (!fetcher) {
    try {
      const nf = await import('node-fetch');
      fetcher = nf.default || nf;
    } catch (err) {
      console.error('Could not load fetch implementation:', err);
      return res.status(500).json({ error: 'Server missing fetch implementation' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { 
    selectedSports = [], 
    selectedBetTypes = [], 
    numLegs = 3, 
    oddsPlatform = 'DraftKings', 
    aiModel = 'openai',
    riskLevel = 'Medium'
  } = req.body || {};

  // Server-side API keys
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const ODDS_KEY = process.env.ODDS_API_KEY;

  // Configurable model lists
  const OPENAI_MODELS = (process.env.OPENAI_MODELS || 'gpt-4o,gpt-4o-mini,gpt-4,gpt-3.5-turbo').split(',').map(s => s.trim()).filter(Boolean);
  const GEMINI_MODELS = (process.env.GEMINI_MODELS || 'gemini-2.0-flash-exp,gemini-1.5-pro').split(',').map(s => s.trim()).filter(Boolean);

  try {
    // Step 1: Fetch real odds data from API
    console.log('Fetching odds for:', selectedSports);
    const oddsResults = [];
    
    if (ODDS_KEY) {
      const selectedBookmaker = BOOKMAKER_MAPPING[oddsPlatform];

      for (const sport of selectedSports) {
        const slug = SPORT_SLUGS[sport];
        if (!slug) {
          console.warn(`Unknown sport slug for: ${sport}`);
          continue;
        }

        const markets = (selectedBetTypes || [])
          .flatMap(bt => MARKET_MAPPING[bt] || [])
          .join(',');
        
        if (!markets) {
          console.warn(`No markets for bet types: ${selectedBetTypes}`);
          continue;
        }

        const url = `https://api.the-odds-api.com/v4/sports/${slug}/odds/?regions=us&markets=${encodeURIComponent(markets)}&oddsFormat=american&bookmakers=${selectedBookmaker}&apiKey=${ODDS_KEY}`;
        
        try {
          const r = await fetcher(url);
          if (!r.ok) {
            console.warn(`Odds API returned ${r.status} for ${sport}`);
            continue;
          }
          const data = await r.json();
          if (Array.isArray(data)) {
            console.log(`Found ${data.length} games for ${sport} from API`);
            oddsResults.push(...data);
          }
        } catch (fetchErr) {
          console.error(`Error fetching ${sport}:`, fetchErr);
          continue;
        }
      }
    } else {
      console.warn('No ODDS_API_KEY - will rely on web search only');
    }

    console.log(`Total games from Odds API: ${oddsResults.length}`);

    // Log first game for debugging
    if (oddsResults.length > 0) {
      console.log('Sample game data:', JSON.stringify(oddsResults[0], null, 2));
    }

    // Step 2: Fallback to web search if insufficient data
    let webSearchData = null;
    const MIN_GAMES_THRESHOLD = 3; // Trigger web search if less than this

    if (oddsResults.length < MIN_GAMES_THRESHOLD) {
      console.log(`Only ${oddsResults.length} games found, triggering web search fallback...`);
      webSearchData = await searchWebForOdds(selectedSports, selectedBetTypes, oddsPlatform, fetcher);
      
      if (webSearchData) {
        console.log(`Web search returned ${webSearchData.results.length} results`);
      }
    }

    // Step 3: Generate enhanced prompt with available data
    const prompt = generateAIPrompt({ 
      selectedSports, 
      selectedBetTypes, 
      numLegs, 
      riskLevel,
      oddsData: oddsResults,
      webSearchData
    });

    // Diagnostic mode
    const diagnose = req.query?.diagnose === 'true' || req.body?.diagnose === true;
    if (diagnose) {
      return res.status(200).json({ 
        prompt, 
        oddsResults,
        webSearchData,
        gamesFound: oddsResults.length,
        webSearchTriggered: oddsResults.length < MIN_GAMES_THRESHOLD
      });
    }

    // Step 4: Call AI with fallback logic
    let content = '';

    const tryOpenAIModel = async (model) => {
      const response = await fetcher('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${OPENAI_KEY}` 
        },
        body: JSON.stringify({
          model,
          messages: [
            { 
              role: 'system', 
              content: 'You are a precise sports betting analyst. You ONLY use real game data provided (from APIs or web search) and ALWAYS include exact dates in MM/DD/YYYY format for every game. You can extract odds from web search snippets when needed.' 
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 3000
        })
      });
      return response;
    };

    const tryGeminiModel = async (model) => {
      const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${GEMINI_KEY}`;
      const response = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ 
            parts: [{ 
              text: prompt 
            }] 
          }],
          generationConfig: { 
            temperature: 0.3, 
            maxOutputTokens: 6000 
          }
        })
      });
      return response;
    };

    if (aiModel === 'openai') {
      if (!OPENAI_KEY) {
        return res.status(500).json({ error: 'Server missing OPENAI_API_KEY' });
      }

      let lastErrText = '';
      for (const model of OPENAI_MODELS) {
        try {
          console.log(`Trying OpenAI model: ${model}`);
          const response = await tryOpenAIModel(model);
          
          if (!response.ok) {
            lastErrText = await response.text();
            if (response.status === 401) {
              return res.status(401).json({ error: `OpenAI auth error: ${lastErrText}` });
            }
            console.warn(`Model ${model} failed:`, lastErrText);
            continue;
          }
          
          const data = await response.json();
          content = data.choices?.[0]?.message?.content || '';
          
          if (content) {
            console.log(`Success with model: ${model}`);
            break;
          }
        } catch (err) {
          lastErrText = err.message || String(err);
          console.error(`Error with ${model}:`, lastErrText);
          continue;
        }
      }
      
      if (!content) {
        return res.status(500).json({ 
          error: `OpenAI failed all models: ${lastErrText}` 
        });
      }

    } else if (aiModel === 'gemini') {
      if (!GEMINI_KEY) {
        return res.status(500).json({ error: 'Server missing GEMINI_API_KEY' });
      }

      let lastErrText = '';
      for (const model of GEMINI_MODELS) {
        try {
          console.log(`Trying Gemini model: ${model}`);
          const response = await tryGeminiModel(model);
          
          if (!response.ok) {
            lastErrText = await response.text();
            if (response.status === 401) {
              return res.status(401).json({ error: `Gemini auth error: ${lastErrText}` });
            }
            console.warn(`Model ${model} failed:`, lastErrText);
            continue;
          }
          
          const data = await response.json();
          content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          
          if (content) {
            console.log(`Success with model: ${model}`);
            break;
          }
        } catch (err) {
          lastErrText = err.message || String(err);
          console.error(`Error with ${model}:`, lastErrText);
          continue;
        }
      }

      if (!content) {
        return res.status(500).json({ 
          error: `Gemini failed all models: ${lastErrText}` 
        });
      }
    } else {
      return res.status(400).json({ error: 'Invalid AI model selection' });
    }

    // Step 5: Return results
    return res.status(200).json({ 
      content,
      gamesFound: oddsResults.length,
      webSearchUsed: webSearchData !== null,
      dataSource: oddsResults.length >= MIN_GAMES_THRESHOLD ? 'Odds API' : 'Web Search Fallback'
    });

  } catch (err) {
    console.error('generate-parlay error:', err);
    return res.status(500).json({ 
      error: err.message || 'Server error',
      details: err.stack
    });
  }
}