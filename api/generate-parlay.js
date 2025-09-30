const SPORT_SLUGS = {
  NFL: 'americanfootball_nfl',
  NBA: 'basketball_nba',
  MLB: 'baseball_mlb',
  NHL: 'icehockey_nhl',
  Soccer: 'soccer_epl',
  NCAAF: 'americanfootball_ncaaf', // This was already here, ready for the frontend change
  'PGA/Golf': 'golf_pga',
  Tennis: 'tennis_atp',
};

const MARKET_MAPPING = {
  'Moneyline/Spread': ['h2h', 'spreads'],
  'Totals (O/U)': ['totals'],
  'Player Props': ['player_points'], // Note: Player props are often sport-specific (e.g., player_pass_yds, player_rebounds)
  'Team Props': ['team_points'],
};

const BOOKMAKER_MAPPING = {
  DraftKings: 'draftkings',
  FanDuel: 'fanduel',
  MGM: 'mgm',
  Caesars: 'caesars',
  Bet365: 'bet365',
};

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
      
      let marketsSummary = 'no-odds';
      if (bm && Array.isArray(bm.markets)) {
        const parts = bm.markets.map(m => {
          if (!Array.isArray(m.outcomes)) return '';
          if (m.key === 'h2h') return `ML: ${m.outcomes.map(o => `${o.name}: ${o.price > 0 ? '+' : ''}${o.price}`).join(' vs ')}`;
          if (m.key === 'spreads') return `Spread: ${m.outcomes.map(o => `${o.name}: ${o.point > 0 ? '+' : ''}${o.point} (${o.price > 0 ? '+' : ''}${o.price})`).join(' vs ')}`;
          if (m.key === 'totals') return `Total: ${m.outcomes.map(o => `${o.name} ${o.point} (${o.price > 0 ? '+' : ''}${o.price})`).join(' / ')}`;
          return ''; // Add other market keys here if needed
        }).filter(Boolean).join(' | ');
        if (parts) marketsSummary = parts;
      }
      return `${idx + 1}. DATE: ${gameDate} - ${teams}\n   ${marketsSummary}`;
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
1. USE ONLY GAMES FROM THE DATA PROVIDED BELOW.
2. INCLUDE EXACT DATES (MM/DD/YYYY) FOR EVERY LEG.
3. USE ONLY THE ACTUAL ODDS PROVIDED.
4. If there aren't enough games for ${numLegs} legs, create fewer legs and explain why.
5. Work with whatever markets are available - do not complain about missing data.

${oddsContext}

YOUR TASK:
Create a ${numLegs}-leg parlay based on the user's risk level. Add a bonus "lock" parlay with 2-3 high-confidence picks.

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
    dateRange = 1 // UPDATED: Default to 1 day instead of 7
  } = req.body || {};

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const ODDS_KEY = process.env.ODDS_API_KEY;

  if (!ODDS_KEY) return res.status(500).json({ error: 'Server missing ODDS_API_KEY' });

  try {
    const allOddsResults = [];
    const selectedBookmaker = BOOKMAKER_MAPPING[oddsPlatform];
    const requestedMarkets = (selectedBetTypes || []).flatMap(bt => MARKET_MAPPING[bt] || []);
    const unavailableInfo = [];

    for (const sport of selectedSports) {
      const slug = SPORT_SLUGS[sport];
      if (!slug) continue;

      const marketsStr = requestedMarkets.join(',');
      const url = `https://api.the-odds-api.com/v4/sports/${slug}/odds/?regions=us&markets=${encodeURIComponent(marketsStr)}&oddsFormat=american&bookmakers=${selectedBookmaker}&apiKey=${ODDS_KEY}`;
      
      let success = false;
      try {
        const r = await fetcher(url);
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data) && data.length > 0) {
            const now = new Date();
            const rangeEnd = new Date(now.getTime() + dateRange * 24 * 60 * 60 * 1000);
            const upcoming = data.filter(game => {
              const gameTime = new Date(game.commence_time);
              return gameTime > now && gameTime < rangeEnd;
            });
            if (upcoming.length > 0) {
              allOddsResults.push(...upcoming);
              success = true;
            }
          }
        }
      } catch (err) { /* Gracefully ignore and let fallback handle it */ }

      if (!success) {
        // Fallback logic for individual markets (your existing code was great for this)
        const sportSuccessfulMarkets = new Set();
        for (const market of requestedMarkets) {
          try {
            const singleMarketUrl = `https://api.the-odds-api.com/v4/sports/${slug}/odds/?regions=us&markets=${market}&oddsFormat=american&bookmakers=${selectedBookmaker}&apiKey=${ODDS_KEY}`;
            const r = await fetcher(singleMarketUrl);
            if (r.ok) {
              const data = await r.json();
              if (Array.isArray(data) && data.length > 0) {
                 const now = new Date();
                 const rangeEnd = new Date(now.getTime() + dateRange * 24 * 60 * 60 * 1000);
                 const upcoming = data.filter(game => new Date(game.commence_time) > now && new Date(game.commence_time) < rangeEnd);
                 if (upcoming.length > 0) {
                   allOddsResults.push(...upcoming);
                   sportSuccessfulMarkets.add(market);
                 }
              }
            }
          } catch (err) { /* Gracefully ignore */ }
        }
        const foundMarkets = Array.from(sportSuccessfulMarkets);
        if (foundMarkets.length > 0) {
          const missing = requestedMarkets.filter(m => !foundMarkets.includes(m));
          unavailableInfo.push(`✓ ${sport}: Found odds for ${foundMarkets.join(', ')}` + (missing.length > 0 ? ` (not for ${missing.join(', ')})` : ''));
        } else {
          unavailableInfo.push(`✗ ${sport}: No odds available for any requested markets.`);
        }
      }
    }

    const uniqueGames = Array.from(new Map(allOddsResults.map(game => [game.id, game])).values());

    if (uniqueGames.length === 0) {
      return res.status(200).json({ content: `⚠️ NO UPCOMING GAMES FOUND\n\nTry:\n• Different sports\n• A different bookmaker\n• A longer date range` });
    }

    const prompt = generateAIPrompt({ selectedSports, selectedBetTypes, numLegs, riskLevel, oddsData: uniqueGames, unavailableInfo, dateRange });

    let content = '';
    if (aiModel === 'openai') {
      if (!OPENAI_KEY) return res.status(500).json({ error: 'Server missing OPENAI_API_KEY' });
      const response = await fetcher('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: 'You are a sports betting analyst.' }, { role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 3000
        })
      });
      if (!response.ok) throw new Error('OpenAI API call failed');
      const data = await response.json();
      content = data.choices?.[0]?.message?.content || '';
    
    // --- UPDATED: Gemini API Implementation ---
    } else if (aiModel === 'gemini') {
      if (!GEMINI_KEY) return res.status(500).json({ error: 'Server missing GEMINI_API_KEY. Add it to use Gemini.' });
      
      const geminiModel = 'gemini-1.5-flash-latest';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${GEMINI_API_KEY}`;
      
      try {
        const response = await fetcher(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 3000 }
          }),
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          console.error('Gemini API Error:', errorData);
          throw new Error(`Gemini API responded with status: ${response.status}`);
        }
        
        const data = await response.json();
        content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!content) throw new Error('Gemini returned an empty response.');
        
      } catch (err) {
        console.error('Error with Gemini model:', err.message);
        return res.status(500).json({ error: `Gemini API call failed: ${err.message}` });
      }
    }

    return res.status(200).json({ content });

  } catch (err) {
    console.error('generate-parlay error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}

module.exports = handler;