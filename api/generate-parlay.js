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

function generateAIPrompt({ selectedSports, selectedBetTypes, numLegs, riskLevel, oddsData, availableMarkets, unavailableInfo, dateRange }) {
  const sportsStr = (selectedSports || []).join(', ');
  const betTypesStr = (selectedBetTypes || []).join(', ');
  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const dateRangeText = `${dateRange || 7} days`;

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
  if (oddsData && oddsData.length > 0) {
    const items = oddsData
      .slice(0, 15)
      .map((ev, idx) => {
        const gameDate = formatDate(ev.commence_time);
        const teams = `${ev.away_team || '?'} @ ${ev.home_team || '?'}`;
        const bm = (ev.bookmakers && ev.bookmakers[0]) || null;
        
        let marketsSummary = 'no-odds';
        if (bm && Array.isArray(bm.markets)) {
          const parts = [];
          for (const m of bm.markets) {
            if (!Array.isArray(m.outcomes)) continue;
            
            if (m.key === 'h2h') {
              const h2h = m.outcomes.map(o => `${o.name}: ${o.price > 0 ? '+' : ''}${o.price}`).join(' vs ');
              parts.push(`ML: ${h2h}`);
            } else if (m.key === 'spreads') {
              const spread = m.outcomes.map(o => `${o.name}: ${o.point > 0 ? '+' : ''}${o.point} (${o.price > 0 ? '+' : ''}${o.price})`).join(' vs ');
              parts.push(`Spread: ${spread}`);
            } else if (m.key === 'totals') {
              const totals = m.outcomes.map(o => `${o.name} ${o.point} (${o.price > 0 ? '+' : ''}${o.price})`).join(' / ');
              parts.push(`Total: ${totals}`);
            }
          }
          if (parts.length > 0) marketsSummary = parts.join(' | ');
        }
        
        return `${idx + 1}. DATE: ${gameDate} - ${teams}\n   ${marketsSummary}`;
      });
    
    oddsContext = `\n\n🔥 AVAILABLE GAMES & ODDS 🔥\n${items.join('\n\n')}`;
  } else {
    oddsContext = '\n\n⚠️ NO LIVE ODDS DATA AVAILABLE';
  }

  // Show what was available vs what was requested
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
1. USE ONLY GAMES FROM THE DATA BELOW
2. INCLUDE EXACT DATES (MM/DD/YYYY) FOR EVERY LEG
3. USE ONLY ACTUAL ODDS PROVIDED
4. If there aren't enough games for ${numLegs} legs, create fewer legs and explain why
5. Work with whatever markets are available - don't complain about missing data

${oddsContext}

YOUR TASK:
Create a ${numLegs}-leg parlay using available games, plus a bonus "lock" parlay with 2-3 high-confidence picks.

REQUIRED FORMAT:

**🎯 ${numLegs}-Leg Parlay: [Creative Title]**

**Legs:**
1. 📅 DATE: MM/DD/YYYY
   Game: [Away] @ [Home]
   Bet: [Specific bet with line]
   Odds: [Exact odds]
   Confidence: [X/10]
   Reasoning: [Why this hits]

[Continue for all legs]

**Combined Odds:** [Calculate]
**Payout on $100:** $[Amount]
**Overall Confidence:** [X/10]

---

**🔒 BONUS LOCK PARLAY: [Conservative Title]**

[Same format, 2-3 safer picks]

**Combined Odds:** [Calculate]
**Payout on $100:** $[Amount]

TONE: Professional with subtle humor. Be concise.
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
    dateRange = 7
  } = req.body || {};

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const ODDS_KEY = process.env.ODDS_API_KEY;

  const OPENAI_MODELS = (process.env.OPENAI_MODELS || 'gpt-4o,gpt-4o-mini').split(',').map(s => s.trim()).filter(Boolean);
  const GEMINI_MODELS = (process.env.GEMINI_MODELS || 'gemini-2.0-flash-exp,gemini-1.5-flash-002').split(',').map(s => s.trim()).filter(Boolean);

  if (!ODDS_KEY) {
    return res.status(500).json({ error: 'Server missing ODDS_API_KEY' });
  }

  try {
    console.log('Fetching odds for:', selectedSports);
    const allOddsResults = [];
    const selectedBookmaker = BOOKMAKER_MAPPING[oddsPlatform];
    const requestedMarkets = (selectedBetTypes || []).flatMap(bt => MARKET_MAPPING[bt] || []);
    
    const unavailableInfo = [];
    const successfulFetches = new Map(); // Track what actually worked

    // Try each sport with ALL requested markets first
    for (const sport of selectedSports) {
      const slug = SPORT_SLUGS[sport];
      if (!slug) continue;

      // Try fetching with all markets at once
      const marketsStr = requestedMarkets.join(',');
      const url = `https://api.the-odds-api.com/v4/sports/${slug}/odds/?regions=us&markets=${encodeURIComponent(marketsStr)}&oddsFormat=american&bookmakers=${selectedBookmaker}&apiKey=${ODDS_KEY}`;
      
      try {
        const r = await fetcher(url);
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data) && data.length > 0) {
            // Filter by date range
            const now = new Date();
            const rangeEnd = new Date(now.getTime() + dateRange * 24 * 60 * 60 * 1000);
            
            const upcoming = data.filter(game => {
              const gameTime = new Date(game.commence_time);
              return gameTime > now && gameTime < rangeEnd;
            });

            if (upcoming.length > 0) {
              console.log(`✓ ${sport}: Found ${upcoming.length} games with requested markets`);
              allOddsResults.push(...upcoming);
              successfulFetches.set(sport, requestedMarkets);
              continue; // Success, move to next sport
            }
          }
        }
      } catch (err) {
        console.log(`✗ ${sport}: Error with all markets:`, err.message);
      }

      // If that failed, try each market individually (graceful fallback)
      console.log(`Trying individual markets for ${sport}...`);
      const sportSuccessfulMarkets = [];
      
      for (const market of requestedMarkets) {
        const singleMarketUrl = `https://api.the-odds-api.com/v4/sports/${slug}/odds/?regions=us&markets=${market}&oddsFormat=american&bookmakers=${selectedBookmaker}&apiKey=${ODDS_KEY}`;
        
        try {
          const r = await fetcher(singleMarketUrl);
          if (r.ok) {
            const data = await r.json();
            if (Array.isArray(data) && data.length > 0) {
              // Filter by date range
              const now = new Date();
              const rangeEnd = new Date(now.getTime() + dateRange * 24 * 60 * 60 * 1000);
              
              const upcoming = data.filter(game => {
                const gameTime = new Date(game.commence_time);
                return gameTime > now && gameTime < rangeEnd;
              });

              if (upcoming.length > 0) {
                console.log(`  ✓ ${sport}/${market}: ${upcoming.length} games`);
                allOddsResults.push(...upcoming);
                sportSuccessfulMarkets.push(market);
              }
            }
          }
        } catch (err) {
          console.log(`  ✗ ${sport}/${market}: ${err.message}`);
        }
      }

      if (sportSuccessfulMarkets.length > 0) {
        successfulFetches.set(sport, sportSuccessfulMarkets);
        const missingMarkets = requestedMarkets.filter(m => !sportSuccessfulMarkets.includes(m));
        if (missingMarkets.length > 0) {
          unavailableInfo.push(`✓ ${sport}: Using ${sportSuccessfulMarkets.join(', ')} (${missingMarkets.join(', ')} not available)`);
        }
      } else {
        unavailableInfo.push(`✗ ${sport}: No odds available for any requested markets`);
      }
    }

    // Deduplicate games (same game might be fetched for different markets)
    const uniqueGames = Array.from(
      new Map(allOddsResults.map(game => [game.id, game])).values()
    );

    console.log(`Total unique games found: ${uniqueGames.length}`);

    if (uniqueGames.length === 0) {
      return res.status(200).json({
        content: `⚠️ NO UPCOMING GAMES FOUND\n\nRequested: ${selectedSports.join(', ')}\nBet Types: ${selectedBetTypes.join(', ')}\nBookmaker: ${oddsPlatform}\nDate Range: Next ${dateRange} days\n\nTry:\n• Different sports\n• Different bookmaker\n• Longer date range\n• Different bet types`
      });
    }

    // Generate prompt with availability info
    const prompt = generateAIPrompt({ 
      selectedSports, 
      selectedBetTypes, 
      numLegs, 
      riskLevel,
      oddsData: uniqueGames,
      availableMarkets: successfulFetches,
      unavailableInfo,
      dateRange
    });

    // Call AI
    let content = '';

    if (aiModel === 'openai') {
      if (!OPENAI_KEY) {
        return res.status(500).json({ error: 'Server missing OPENAI_API_KEY' });
      }

      for (const model of OPENAI_MODELS) {
        try {
          console.log(`Trying OpenAI model: ${model}`);
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
                  content: 'You are a sports betting analyst. Use only real game data provided and include exact dates.' 
                },
                { role: 'user', content: prompt }
              ],
              temperature: 0.7,
              max_tokens: 3000
            })
          });
          
          if (response.ok) {
            const data = await response.json();
            content = data.choices?.[0]?.message?.content || '';
            if (content) break;
          }
        } catch (err) {
          console.error(`Error with ${model}:`, err.message);
        }
      }
      
      if (!content) {
        return res.status(500).json({ error: 'OpenAI failed all models' });
      }

    } else if (aiModel === 'gemini') {
      return res.status(500).json({ error: 'Gemini temporarily unavailable - use OpenAI' });
    }

    return res.status(200).json({ 
      content,
      gamesFound: uniqueGames.length,
      dataAvailability: unavailableInfo
    });

  } catch (err) {
    console.error('generate-parlay error:', err);
    return res.status(500).json({ 
      error: err.message || 'Server error',
      details: err.stack
    });
  }
}

module.exports = handler;