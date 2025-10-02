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
  'Player Props': ['player_pass_tds', 'player_pass_yds', 'player_rush_yds', 'player_receptions', 'player_reception_yds', 'player_points', 'player_assists', 'player_rebounds'],
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
  
  // Research top 10 games to save API quota
  for (const game of games.slice(0, 10)) {
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
  enrichedGames.push(...games.slice(10).map(g => ({ ...g, research: null })));
  
  console.log(`✓ Research complete (${enrichedGames.filter(g => g.research).length} games enriched)\n`);
  return enrichedGames;
}

function generateAIPrompt({ selectedSports, selectedBetTypes, numLegs, riskLevel, oddsData, unavailableInfo, dateRange }) {
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
            return `Player ${propType}: ${m.outcomes.slice(0, 2).map(o => `${o.description || o.name} ${o.point || ''} (${o.price > 0 ? '+' : ''}${o.price})`).join(' | ')}`;
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

  if (!ODDS_KEY) return res.status(500).json({ error: 'Server missing ODDS_API_KEY' });

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
    const rangeEnd = new Date(now.getTime() + dateRange * 24 * 60 * 60 * 1000);

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
          const r = await fetcher(url);
          if (r.ok) {
            const data = await r.json();
            if (Array.isArray(data) && data.length > 0) {
              const upcoming = data.filter(game => {
                const gameTime = new Date(game.commence_time);
                return gameTime > now && gameTime < rangeEnd;
              });
              if (upcoming.length > 0) {
                allOddsResults.push(...upcoming);
                success = true;
                console.log(`  ✓ Regular markets: ${upcoming.length} games`);
              }
            }
          }
        } catch (err) { /* Gracefully ignore */ }

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
      dateRange 
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