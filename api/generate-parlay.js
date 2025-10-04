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
  'Player Props': ['player_pass_yds', 'player_rush_yds', 'player_receptions', 'player_reception_yds', 'player_points', 'player_assists', 'player_rebounds'],
  'TD Props': ['player_pass_tds', 'player_tds_over', 'player_anytime_td', 'player_rush_tds', 'player_reception_tds'],
  'Team Props': ['team_totals'],
};

const BOOKMAKER_MAPPING = {
  DraftKings: 'draftkings',
  FanDuel: 'fanduel',
  MGM: 'mgm',
  Caesars: 'caesars',
  Bet365: 'bet365',
};

// NEW: Research function using Serper API
async function fetchGameResearch(games, fetcher) {
  console.log('🔍 Checking SERPER_API_KEY...');
  console.log('Key exists:', !!process.env.SERPER_API_KEY);
  console.log('Key length:', process.env.SERPER_API_KEY?.length);
  console.log('Key preview:', process.env.SERPER_API_KEY?.substring(0, 10) + '...');
  
  const SERPER_API_KEY = process.env.SERPER_API_KEY;
  
  if (!SERPER_API_KEY) {
    console.log('⚠️  No SERPER_API_KEY - skipping research enhancement');
    return games.map(g => ({ ...g, research: null }));
  }
  
  console.log('✅ SERPER_API_KEY loaded successfully');

  console.log(`\n🔍 Researching top ${Math.min(games.length, 10)} games...`);
  const enrichedGames = [];
  
  // Research top 30 games to save API quota
  for (const game of games.slice(0, 30)) {
    const gameDate = new Date(game.commence_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const query = `${game.away_team} vs ${game.home_team} ${gameDate} injury report recent performance analysis prediction`;
    
    try {
      const response = await fetcher('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          q: query,
          num: 3
        })
      });

      if (response.ok) {
        const data = await response.json();
        
        // Extract insights from top results
        const insights = data.organic?.slice(0, 3)
          .map(result => result.snippet)
          .filter(Boolean)
          .join(' | ') || null;
        
        enrichedGames.push({
          ...game,
          research: insights
        });
        
        console.log(`  ✓ ${game.away_team} @ ${game.home_team}`);
      } else {
        enrichedGames.push({ ...game, research: null });
        console.log(`  ⚠️  ${game.away_team} @ ${game.home_team} - API error`);
      }
    } catch (err) {
      enrichedGames.push({ ...game, research: null });
      console.log(`  ✗ ${game.away_team} @ ${game.home_team} - ${err.message}`);
    }
  }
  
  // Add remaining games without research
  enrichedGames.push(...games.slice(30).map(g => ({ ...g, research: null })));
  
  console.log(`✓ Research complete (${enrichedGames.filter(g => g.research).length} games enriched)\n`);
  return enrichedGames;
}

function generateAIPrompt({ selectedSports, selectedBetTypes, numLegs, riskLevel, oddsData, unavailableInfo, dateRange, aiModel = 'openai' }) {
  const sportsStr = (selectedSports || []).join(', ');
  const betTypesStr = (selectedBetTypes || []).join(', ');
  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const dateRangeText = `${dateRange || 1} day(s)`;

  const formatDate = (iso) => {
    if (!iso) return 'TBD';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  };

  let oddsContext = '';
  if (oddsData && oddsData.length > 0) {
    const items = oddsData.slice(0, 20).map((ev, idx) => {
      const gameDate = formatDate(ev.commence_time);
      const teams = `${ev.away_team || '?'} @ ${ev.home_team || '?'}`;
      const bm = (ev.bookmakers && ev.bookmakers[0]) || null;
      
      // NEW: Add research context if available
      const researchNote = ev.research ? `\n   📰 RESEARCH: ${ev.research}` : '';
      
      let marketsSummary = 'no-odds';
      if (bm && Array.isArray(bm.markets)) {
        const parts = bm.markets.map(m => {
          if (!Array.isArray(m.outcomes)) return '';
          if (m.key === 'h2h') return `ML: ${m.outcomes.map(o => `${o.name}: ${o.price > 0 ? '+' : ''}${o.price}`).join(' vs ')}`;
          if (m.key === 'spreads') return `Spread: ${m.outcomes.map(o => `${o.name}: ${o.point > 0 ? '+' : ''}${o.point} (${o.price > 0 ? '+' : ''}${o.price})`).join(' vs ')}`;
          if (m.key === 'totals') return `Total: ${m.outcomes.map(o => `${o.name} ${o.point} (${o.price > 0 ? '+' : ''}${o.price})`).join(' / ')}`;
          if (m.key.startsWith('player_')) {
            const propType = m.key.replace('player_', '').replace(/_/g, ' ');
            // Special handling for TD props
            if (m.key.includes('td') || m.key.includes('touchdown')) {
              return `TD Prop ${propType}: ${m.outcomes.slice(0, 2).map(o => `${o.description || o.name} ${o.point || ''} (${o.price > 0 ? '+' : ''}${o.price})`).join(' | ')}`;
            } else {
              return `Player ${propType}: ${m.outcomes.slice(0, 2).map(o => `${o.description || o.name} ${o.point || ''} (${o.price > 0 ? '+' : ''}${o.price})`).join(' | ')}`;
            }
          }
          if (m.key === 'team_totals') return `Team Total: ${m.outcomes.map(o => `${o.name} ${o.point} (${o.price > 0 ? '+' : ''}${o.price})`).join(' | ')}`;
          return '';
        }).filter(Boolean).join(' | ');
        if (parts) marketsSummary = parts;
      }
      return `${idx + 1}. DATE: ${gameDate} - ${teams}\n   ${marketsSummary}${researchNote}`;
    });
    oddsContext = `\n\n🔥 AVAILABLE GAMES & ODDS 🔥\n${items.join('\n\n')}`;
  } else {
    oddsContext = '\n\n⚠️ NO LIVE ODDS DATA AVAILABLE';
  }

  let marketAvailabilityNote = '';
  if (unavailableInfo && unavailableInfo.length > 0) {
    marketAvailabilityNote = `\n\n📊 DATA AVAILABILITY:\n${unavailableInfo.join('\n')}`;
  }

  // Different prompts for different AI models
  if (aiModel === 'gemini') {
    return generateGeminiPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, today, dateRangeText, marketAvailabilityNote, oddsContext });
  } else {
    return generateOpenAIPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, today, dateRangeText, marketAvailabilityNote, oddsContext });
  }
}

function generateOpenAIPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, today, dateRangeText, marketAvailabilityNote, oddsContext }) {
  return `
TODAY'S DATE: ${today}
TIME WINDOW: Next ${dateRangeText}

USER REQUESTED:
- Sports: ${sportsStr}
- Bet Types: ${betTypesStr}
- Risk Level: ${riskLevel}

${marketAvailabilityNote}

🚨 CRITICAL RULES 🚨
1. USE ONLY GAMES FROM THE DATA PROVIDED BELOW
2. INCLUDE EXACT DATES (MM/DD/YYYY) FOR EVERY LEG
3. USE ONLY THE ACTUAL ODDS PROVIDED
4. CONSIDER THE RESEARCH DATA when making picks - injuries, trends, recent form are CRITICAL factors
5. In your reasoning, reference specific research insights when available
6. Do not include games that have already started or have already finished
7. Do not conflict same-game bets, moneyline or spread on one team and another leg shouldn't be moneyline or spread on the other team. Similarly an over on a prop bet shoudn't have an under on the same bet as another leg
8. If you take a team or pick for moneyline, do not reapeat as another leg against the spread
9. do NOT repeat the same exact bet as multiple legs
10. Work with whatever markets are available - do not complain about missing data

${oddsContext}

YOUR TASK:
Create a ${numLegs}-leg parlay using VARIETY across different bet types and games. 

CRITICAL REQUIREMENTS:
- You MUST create exactly ${numLegs} legs (not fewer)
- MIX bet types: If user selected multiple types (spreads, totals, props), use a variety
- SPREAD across different games: Don't use same game multiple times
- Prioritize HIGH PROBABILITY bets that match the ${riskLevel} risk level
- USE THE RESEARCH DATA to inform your picks - don't just pick favorites blindly
- If you have both regular markets (spreads/totals/ML) AND props, combine them for variety

Example for 10-leg parlay with all bet types selected:
- 3 spreads from different games
- 2 moneylines from different games  
- 2 over/unders from different games
- 2 player props from different games
- 1 team prop

DO NOT create fewer than ${numLegs} legs unless there literally aren't enough unique games in the data.

REQUIRED FORMAT:

**🎯 ${numLegs}-Leg Parlay: [Creative Title]**

**Legs:**
1. 📅 DATE: MM/DD/YYYY
   Game: [Away] @ [Home]
   Bet: [Specific bet with line]
   Odds: [Exact odds]
   Confidence: [X/10]
   Reasoning: [Why this hits - reference research if available]

[Continue for all legs]

**Combined Odds:** [Calculate by converting to decimal, multiply, convert back]
**Payout on $100:** $[Amount]
**Overall Confidence:** [Average]/10

NOTE: If you provided fewer than ${numLegs} legs, explain why (e.g., "Only 7 unique games available in the data").

---

**🔒 BONUS LOCK PARLAY: [Conservative Title]**

[Same format, 2-3 safer picks based on research and odds]

**Combined Odds:** [Calculate]
**Payout on $100:** $[Amount]
**Why These Are Locks:** [Brief data backed explanation citing research]

TONE: Professional with subtle humor. Be concise but reference research insights.
`.trim();
}

function generateGeminiPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, today, dateRangeText, marketAvailabilityNote, oddsContext }) {
  return `
You are a professional sports betting analyst. Your task is to create exactly ${numLegs} parlay legs using the provided data.

STRICT REQUIREMENTS:
1. Create EXACTLY ${numLegs} legs - no more, no less
2. Use ONLY games and odds from the data below
3. Each leg must have: Date (MM/DD/YYYY), Game, Bet, Odds, Confidence (1-10), Reasoning
4. Use different games for each leg - NO REPEATING GAMES
5. Include variety in bet types if multiple types are available
6. Reference research data in reasoning when available

CRITICAL CONFLICT PREVENTION RULES:
- If you pick Team A moneyline, DO NOT pick Team B moneyline in same game
- If you pick Team A spread, DO NOT pick Team B spread in same game  
- If you pick Team A moneyline, DO NOT pick Team A spread in same game
- If you pick OVER total, DO NOT pick UNDER total in same game
- If you pick player OVER prop, DO NOT pick same player UNDER prop
- NO conflicting bets from the same game
- Each leg must be from a DIFFERENT game
- NO duplicate bet types on same team/player

TODAY: ${today}
SPORTS: ${sportsStr}
BET TYPES: ${betTypesStr}
RISK LEVEL: ${riskLevel}

${marketAvailabilityNote}

${oddsContext}

BEFORE YOU START - CHECK FOR CONFLICTS:
- Review each leg to ensure NO conflicting bets
- Verify each leg is from a DIFFERENT game
- Confirm no duplicate teams or players
- Double-check no opposing sides of same bet

OUTPUT FORMAT - Follow this EXACT structure:

**🎯 ${numLegs}-Leg Parlay: [Title]**

**Legs:**
1. 📅 DATE: MM/DD/YYYY
   Game: Away Team @ Home Team
   Bet: Specific bet with line
   Odds: +XXX or -XXX
   Confidence: X/10
   Reasoning: Why this will hit

2. 📅 DATE: MM/DD/YYYY
   Game: Away Team @ Home Team
   Bet: Specific bet with line
   Odds: +XXX or -XXX
   Confidence: X/10
   Reasoning: Why this will hit

[Continue for ${numLegs} total legs]

**Combined Odds:** Calculate combined odds
**Payout on $100:** $XXX
**Overall Confidence:** X/10

---

**🔒 BONUS LOCK PARLAY: [Title]**

**Legs:**
1. 📅 DATE: MM/DD/YYYY
   Game: Away Team @ Home Team
   Bet: Specific bet with line
   Odds: +XXX or -XXX
   Confidence: X/10
   Reasoning: Why this is safe

2. 📅 DATE: MM/DD/YYYY
   Game: Away Team @ Home Team
   Bet: Specific bet with line
   Odds: +XXX or -XXX
   Confidence: X/10
   Reasoning: Why this is safe

**Combined Odds:** Calculate combined odds
**Payout on $100:** $XXX
**Why These Are Locks:** Brief explanation

CRITICAL FINAL CHECK:
1. You MUST create exactly ${numLegs} legs in the main parlay
2. Each leg MUST be from a different game
3. NO conflicting bets (opposing sides of same wager)
4. NO duplicate teams/players across legs
5. Use research data to justify picks
6. Follow the exact format above

DO NOT DEVIATE FROM THESE RULES.
`.trim();
}

async function handler(req, res) {
  let fetcher = globalThis.fetch;
  if (!fetcher) {
    try {
      const nf = await import('node-fetch');
      fetcher = nf.default || nf;
    } catch (err) {
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
    riskLevel = 'Medium',
    dateRange = 1
  } = req.body || {};

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const ODDS_KEY = process.env.ODDS_API_KEY;

  // Enhanced environment variable checking for deployment
  console.log('\n🔍 ENVIRONMENT CHECK:');
  console.log(`ODDS_KEY exists: ${!!ODDS_KEY} (length: ${ODDS_KEY?.length || 0})`);
  console.log(`OPENAI_KEY exists: ${!!OPENAI_KEY} (length: ${OPENAI_KEY?.length || 0})`);
  console.log(`SERPER_KEY exists: ${!!process.env.SERPER_API_KEY} (length: ${process.env.SERPER_API_KEY?.length || 0})`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);

  if (!ODDS_KEY) {
    console.log('❌ CRITICAL: Missing ODDS_API_KEY in environment');
    return res.status(500).json({ error: 'Server missing ODDS_API_KEY' });
  }

  try {
    console.log('\n' + '='.repeat(60));
    console.log('🎯 PARLAY GENERATION REQUEST');
    console.log('='.repeat(60));
    console.log(`Sports: ${selectedSports.join(', ')}`);
    console.log(`Bet Types: ${selectedBetTypes.join(', ')}`);
    console.log(`Legs: ${numLegs} | Risk: ${riskLevel} | Platform: ${oddsPlatform}`);
    console.log('='.repeat(60) + '\n');

    const allOddsResults = [];
    const selectedBookmaker = BOOKMAKER_MAPPING[oddsPlatform];
    const requestedMarkets = (selectedBetTypes || []).flatMap(bt => MARKET_MAPPING[bt] || []);
    const unavailableInfo = [];

    const now = new Date();
    
    // Handle "Today only" vs multi-day ranges
    let rangeEnd;
    if (dateRange === 1) {
      // For "Today only", set end to end of today (11:59:59 PM)
      rangeEnd = new Date(now);
      rangeEnd.setHours(23, 59, 59, 999);
    } else {
      // For multi-day, use the original logic
      rangeEnd = new Date(now.getTime() + dateRange * 24 * 60 * 60 * 1000);
    }

    for (const sport of selectedSports) {
      const slug = SPORT_SLUGS[sport];
      if (!slug) continue;

      console.log(`\n📊 Fetching ${sport}...`);

      const regularMarkets = requestedMarkets.filter(m => 
        !m.startsWith('player_') && !m.startsWith('team_')
      );
      const propMarkets = requestedMarkets.filter(m => 
        m.startsWith('player_') || m.startsWith('team_')
      );

      // Fetch regular markets
      if (regularMarkets.length > 0) {
        const marketsStr = regularMarkets.join(',');
        const url = `https://api.the-odds-api.com/v4/sports/${slug}/odds/?regions=us&markets=${encodeURIComponent(marketsStr)}&oddsFormat=american&bookmakers=${selectedBookmaker}&apiKey=${ODDS_KEY}`;
        
        let success = false;
        try {
          console.log(`  📡 Calling Odds API: ${url.substring(0, 100)}...`);
          const r = await fetcher(url);
          console.log(`  📊 Response status: ${r.status}`);
          
          if (r.ok) {
            const data = await r.json();
            console.log(`  📈 Raw data length: ${Array.isArray(data) ? data.length : 'not array'}`);
            
            if (Array.isArray(data) && data.length > 0) {
              const upcoming = data.filter(game => {
                const gameTime = new Date(game.commence_time);
                return gameTime > now && gameTime < rangeEnd;
              });
              console.log(`  ⏰ Games in time range: ${upcoming.length} (from ${data.length} total)`);
              
              if (upcoming.length > 0) {
                allOddsResults.push(...upcoming);
                success = true;
                console.log(`  ✓ Regular markets: ${upcoming.length} games`);
              } else {
                console.log(`  ⚠️  No games in time window (${dateRange} days from now)`);
              }
            } else {
              console.log(`  ⚠️  API returned empty or invalid data`);
            }
          } else {
            const errorText = await r.text();
            console.log(`  ❌ API Error ${r.status}: ${errorText}`);
          }
        } catch (err) { 
          console.log(`  ❌ Fetch error: ${err.message}`);
        }

        if (!success) {
          for (const market of regularMarkets) {
            try {
              const singleMarketUrl = `https://api.the-odds-api.com/v4/sports/${slug}/odds/?regions=us&markets=${market}&oddsFormat=american&bookmakers=${selectedBookmaker}&apiKey=${ODDS_KEY}`;
              const r = await fetcher(singleMarketUrl);
              if (r.ok) {
                const data = await r.json();
                if (Array.isArray(data) && data.length > 0) {
                  const upcoming = data.filter(game => new Date(game.commence_time) > now && new Date(game.commence_time) < rangeEnd);
                  if (upcoming.length > 0) {
                    allOddsResults.push(...upcoming);
                  }
                }
              }
            } catch (err) { /* Gracefully ignore */ }
          }
        }
      }

      // Two-step fetching for props
      if (propMarkets.length > 0) {
        console.log(`  🎯 Fetching props...`);
        const eventsUrl = `https://api.the-odds-api.com/v4/sports/${slug}/events?apiKey=${ODDS_KEY}`;
        
        try {
          const eventsRes = await fetcher(eventsUrl);
          if (eventsRes.ok) {
            const events = await eventsRes.json();
            
            if (Array.isArray(events) && events.length > 0) {
              const upcomingEvents = events.filter(event => {
                const gameTime = new Date(event.commence_time);
                return gameTime > now && gameTime < rangeEnd;
              });

              const eventsToFetch = upcomingEvents.slice(0, 10);
              let propsFound = 0;

              for (const event of eventsToFetch) {
                const eventId = event.id;
                const propUrl = `https://api.the-odds-api.com/v4/sports/${slug}/events/${eventId}/odds?regions=us&markets=${propMarkets.join(',')}&oddsFormat=american&bookmakers=${selectedBookmaker}&apiKey=${ODDS_KEY}`;
                
                try {
                  const propRes = await fetcher(propUrl);
                  if (propRes.ok) {
                    const propData = await propRes.json();
                    
                    if (propData && propData.bookmakers && propData.bookmakers.length > 0) {
                      const hasMarkets = propData.bookmakers.some(bm => 
                        bm.markets && bm.markets.length > 0
                      );
                      
                      if (hasMarkets) {
                        allOddsResults.push(propData);
                        propsFound++;
                      }
                    }
                  }
                } catch (propErr) {
                  // Silent fail
                }
              }

              if (propsFound > 0) {
                console.log(`  ✓ Props: ${propsFound} games`);
              } else {
                unavailableInfo.push(`⚠️ ${sport}: Props not available for ${oddsPlatform}`);
                console.log(`  ⚠️  No props available`);
              }
            }
          }
        } catch (eventsErr) {
          unavailableInfo.push(`⚠️ ${sport}: Couldn't fetch props`);
        }
      }
    }

    const uniqueGames = Array.from(new Map(allOddsResults.map(game => [game.id, game])).values());

    console.log(`\n📈 Total unique games found: ${uniqueGames.length}`);

    if (uniqueGames.length === 0) {
      return res.status(200).json({ content: `⚠️ NO UPCOMING GAMES FOUND\n\nTry:\n• Different sports\n• A different bookmaker\n• A longer date range` });
    }

    // NEW: Add research enrichment
    const researchedGames = await fetchGameResearch(uniqueGames, fetcher);

    const prompt = generateAIPrompt({ 
      selectedSports, 
      selectedBetTypes, 
      numLegs, 
      riskLevel, 
      oddsData: researchedGames,  // Using researched games
      unavailableInfo, 
      dateRange,
      aiModel
    });

    console.log(`🤖 Calling ${aiModel.toUpperCase()} API...\n`);

    let content = '';
    if (aiModel === 'openai') {
      if (!OPENAI_KEY) return res.status(500).json({ error: 'Server missing OPENAI_API_KEY' });
      const response = await fetcher('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an expert sports betting analyst who uses research data and odds analysis to build informed parlays.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 3500
        })
      });
      if (!response.ok) throw new Error('OpenAI API call failed');
      const data = await response.json();
      content = data.choices?.[0]?.message?.content || '';
    
    } else if (aiModel === 'gemini') {
      if (!GEMINI_KEY) return res.status(500).json({ error: 'Server missing GEMINI_API_KEY' });
      
      const geminiModel = 'gemini-2.0-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${GEMINI_KEY}`;
      
      try {
        const response = await fetcher(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 3500 }
          }),
        });
        
        if (!response.ok) {
          const errorData = await response.text();
          console.error('Gemini API Error:', errorData);
          throw new Error(`Gemini API responded with status: ${response.status}`);
        }
        
        const data = await response.json();
        content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!content) throw new Error('Gemini returned empty response');
        
      } catch (err) {
        console.error('Gemini error:', err.message);
        return res.status(500).json({ error: `Gemini API failed: ${err.message}` });
      }
    }

    console.log('✅ Parlay generated successfully!\n');

    return res.status(200).json({ content });

  } catch (err) {
    console.error('\n❌ ERROR:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}

module.exports = handler;