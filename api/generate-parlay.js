// Multi-Agent Parlay Generation API
const { MultiAgentCoordinator } = require('../lib/agents/coordinator');
const { SPORT_SLUGS, MARKET_MAPPING, BOOKMAKER_MAPPING } = require('../shared/constants');
const { calculateParlay } = require('../shared/oddsCalculations');
const { createLogger } = require('../shared/logger');

const logger = createLogger('GenerateParlay');

// Build a mock result for local/dev without external APIs
function buildMockParlayResponse({ aiModel = 'mock', selectedSports = ['NFL'], selectedBetTypes = ['Moneyline/Spread'], numLegs = 3 }) {
  const legs = Array.from({ length: numLegs }, (_, i) => {
    const n = i + 1;
    const odds = i % 2 === 0 ? '+100' : '-110';
    return `
${n}. 📅 DATE: 10/10/2025
   Game: TeamA @ TeamB
   Bet: TeamA -${n}.5 (${odds})
   Odds: ${odds}
   Confidence: ${Math.min(9, 7 + (i % 3))}/10
   Reasoning: Mock reasoning with research references.`.trim();
  }).join('\n\n');

  const oddsList = Array.from({ length: numLegs }, (_, i) => (i % 2 === 0 ? '+100' : '-110'));
  const calc = calculateParlay(oddsList);

  const content = `**🎯 ${numLegs}-Leg Parlay: Mock Data-Driven Picks**

**Legs:**
${legs}

**Combined Odds:** ${calc.combinedOdds}
**Payout on $100:** $${calc.payout}
**Overall Confidence:** 8/10

---

**🔒 BONUS LOCK PARLAY: Two High-Confidence Picks**

**Legs:**
1. 📅 DATE: 10/10/2025
   Game: TeamC @ TeamD
   Bet: TeamC ML (+100)
   Odds: +100
   Confidence: 9/10

2. 📅 DATE: 10/10/2025
   Game: TeamE @ TeamF
   Bet: Under 45.5 (-110)
   Odds: -110
   Confidence: 8/10

**Why These Are Locks:** Mock highest confidence legs.`;

  return {
    content,
    metadata: {
      aiModel,
      oddsSource: 'mock',
      fallbackUsed: false,
      dataQuality: 100,
      researchedGames: 0,
      totalGames: 0,
      timings: {
        oddsMs: 10,
        researchMs: 0,
        analysisMs: 20,
        postProcessingMs: 5,
        totalMs: 35
      },
      processingTime: Date.now()
    }
  };
}

// NEW: Research function using Serper API
async function fetchGameResearch(games, fetcher) {
  const SERPER_API_KEY = process.env.SERPER_API_KEY;
  
  if (!SERPER_API_KEY) {
    logger.warn('SERPER_API_KEY not found - skipping research enhancement');
    return games.map(g => ({ ...g, research: null }));
  }
  
  logger.info('Starting game research', { gameCount: Math.min(games.length, 10) });
  const enrichedGames = [];
  
  // Research top 30 games to save API quota
  for (const game of games.slice(0, 30)) {
    const gameDate = new Date(game.commence_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' });
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
        })
      });

      if (response.ok) {
        const data = await response.json();
        const organic = data.organic || [];
        const snippets = organic.slice(0, 3).map(r => r.snippet || '').join(' ');
        enrichedGames.push({ ...game, research: snippets || null });
      } else {
        enrichedGames.push({ ...game, research: null });
      }
    } catch (error) {
      logger.error('Research failed for game', { 
        game: `${game.away_team} vs ${game.home_team}`,
        error: error.message 
      });
      enrichedGames.push({ ...game, research: null });
    }
  }
  
  const enrichedCount = enrichedGames.filter(g => g.research).length;
  logger.info('Research complete', { 
    enrichedCount, 
    totalCount: enrichedGames.length 
  });
  
  // Add remaining games without research
  enrichedGames.push(...games.slice(30).map(g => ({ ...g, research: null })));
  
  return enrichedGames;
}

// Helper function to format dates in US Mountain Time
function formatDateMT(iso) {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  // Format in Mountain Time (America/Denver)
  return d.toLocaleDateString('en-US', { 
    month: 'numeric', 
    day: 'numeric', 
    year: 'numeric',
    timeZone: 'America/Denver'
  });
}

function formatDateTimeMT(iso) {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  // Format date and time in Mountain Time
  return d.toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Denver'
  }) + ' MT';
}

function generateAIPrompt({ selectedSports, selectedBetTypes, numLegs, riskLevel, oddsData, unavailableInfo, dateRange, aiModel = 'openai' }) {
  const sportsStr = (selectedSports || []).join(', ');
  const betTypesStr = (selectedBetTypes || []).join(', ');
  const today = formatDateMT(new Date().toISOString());
  const dateRangeText = `${dateRange || 1} day(s)`;

  const formatDate = formatDateMT;

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

  // Always use OpenAI prompt
  return generateOpenAIPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, today, dateRangeText, marketAvailabilityNote, oddsContext });
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
- PREFER different games when available, BUT if limited games:
  * Use MULTIPLE BET TYPES from the same game (e.g., spread + total + player props)
  * Different players for props to avoid correlation
  * Mix of moneyline/spread + totals + player props from same game
- Prioritize HIGH PROBABILITY bets that match the ${riskLevel} risk level
- USE THE RESEARCH DATA to inform your picks - don't just pick favorites blindly
- If you have both regular markets (spreads/totals/ML) AND props, combine them for variety

SAME GAME STRATEGY (when few games available):
- Game 1: Team A spread + Over total + Player X rushing yards + Player Y receiving yards
- This creates 4 legs from one game using different bet types
- Avoid conflicting bets (don't bet opposing spreads/moneylines)

Example for limited games scenario:
- Eagles @ Giants: Eagles -6.5 spread (-110)
- Eagles @ Giants: Over 47.5 total (-110)  
- Eagles @ Giants: Hurts Over 250.5 pass yards (-120)
- Eagles @ Giants: Saquon Over 75.5 rush yards (+105)
- Eagles @ Giants: AJ Brown anytime TD (+180)
- Dolphins @ Jets: Dolphins ML (+150)
- Dolphins @ Jets: Under 44.5 total (-105)
- Dolphins @ Jets: Tua Over 275.5 pass yards (-115)

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

**Combined Odds:** [WILL BE CALCULATED AUTOMATICALLY]
**Payout on $100:** $[WILL BE CALCULATED AUTOMATICALLY]
**Overall Confidence:** [Average]/10

NOTE: If you provided fewer than ${numLegs} legs, explain why (e.g., "Only 7 unique games available in the data").

---

**🔒 BONUS LOCK PARLAY: [Conservative Title]**

[Same format, 2-3 safer picks based on research and odds]

**Combined Odds:** [WILL BE CALCULATED AUTOMATICALLY]
**Payout on $100:** $[WILL BE CALCULATED AUTOMATICALLY]
**Why These Are Locks:** [Brief data backed explanation citing research]

TONE: Professional with subtle humor. Be concise but reference research insights.
`.trim();
}

 

// Function to fix odds calculations in AI-generated content
function fixOddsCalculations(content) {
  const lines = content.split('\n');
  const fixedLines = [];
  
  let currentParlayOdds = [];
  let inParlay = false;
  let expectingOddsForCurrentLeg = false;
  let pushedOddsForCurrentLeg = false;

  const normalizeAmerican = (token) => {
    const t = (token || '').toString().trim().toUpperCase();
    if (t === 'EV' || t === 'EVEN' || t === 'PK' || t === 'PICK' || t === 'PICKEM' || t === "PICK'EM") {
      return '+100';
    }
    const m = t.match(/^([+-]\d{2,5})/);
    return m ? m[1] : null;
  };
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect start of a parlay
    if (line.includes('🎯') && line.includes('-Leg Parlay:')) {
      inParlay = true;
      currentParlayOdds = [];
      expectingOddsForCurrentLeg = false;
      pushedOddsForCurrentLeg = false;
      fixedLines.push(line);
      continue;
    }
    
    // Detect start of bonus parlay
    if (line.includes('🔒') && line.includes('LOCK PARLAY:')) {
      inParlay = true;
      currentParlayOdds = [];
      expectingOddsForCurrentLeg = false;
      pushedOddsForCurrentLeg = false;
      fixedLines.push(line);
      continue;
    }

    // Detect start of a new leg
    if (inParlay) {
      const legStart = line.match(/^\s*\d+\.\s*📅/);
      if (legStart) {
        expectingOddsForCurrentLeg = true;
        pushedOddsForCurrentLeg = false;
      }
    }
    
    // Extract odds from legs
    if (inParlay && line.trim().startsWith('Odds:')) {
      const oddsMatch = line.match(/Odds:\s*([+\-]?\d{2,5}|EV|EVEN|PK|PICK)/i);
      if (oddsMatch) {
        const norm = normalizeAmerican(oddsMatch[1]);
        if (norm) {
          currentParlayOdds.push(norm);
          pushedOddsForCurrentLeg = true;
          expectingOddsForCurrentLeg = false;
        }
      }
      fixedLines.push(line);
      continue;
    }

    // Fallback: extract from Bet line parentheses
    if (inParlay && expectingOddsForCurrentLeg && !pushedOddsForCurrentLeg && line.trim().startsWith('Bet:')) {
      const parenMatches = [...line.matchAll(/\(([+\-]?\d{2,5}|EV|EVEN|PK|PICK)\)/gi)];
      if (parenMatches.length > 0) {
        const last = parenMatches[parenMatches.length - 1];
        const norm = normalizeAmerican(last[1]);
        if (norm) {
          currentParlayOdds.push(norm);
          pushedOddsForCurrentLeg = true;
          expectingOddsForCurrentLeg = false;
        }
      }
      fixedLines.push(line);
      continue;
    }
    
    // Fix Combined Odds calculation
    if (line.includes('**Combined Odds:**') && currentParlayOdds.length > 0) {
      try {
        const calculation = calculateParlay(currentParlayOdds);
        fixedLines.push(`**Combined Odds:** ${calculation.combinedOdds}`);
        continue;
      } catch (err) {
        console.log('Error calculating odds:', err);
        fixedLines.push(line);
        continue;
      }
    }
    
    // Fix Payout calculation
    if (line.includes('**Payout on $100:**') && currentParlayOdds.length > 0) {
      try {
        const calculation = calculateParlay(currentParlayOdds);
        fixedLines.push(`**Payout on $100:** $${calculation.payout}`); // total return
        continue;
      } catch (err) {
        console.log('Error calculating payout:', err);
        fixedLines.push(line);
        continue;
      }
    }
    
    // End of parlay section
    if (line.trim() === '' && inParlay) {
      // Don't reset immediately, might be spacing within parlay
      fixedLines.push(line);
      continue;
    }
    
    // Reset when we hit a new section or end
    if (line.includes('---') || line.includes('**Why These Are Locks:**')) {
      inParlay = false;
      currentParlayOdds = [];
      expectingOddsForCurrentLeg = false;
      pushedOddsForCurrentLeg = false;
    }
    
    fixedLines.push(line);
  }
  
  return fixedLines.join('\n');
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

  // Gather API keys
  const apiKeys = {
    odds: process.env.ODDS_API_KEY,
    serper: process.env.SERPER_API_KEY,
    openai: process.env.OPENAI_API_KEY
  };

  logger.debug('Environment check', {
    hasOddsKey: !!apiKeys.odds,
    hasOpenAIKey: !!apiKeys.openai,
    hasSerperKey: !!apiKeys.serper,
    nodeEnv: process.env.NODE_ENV || 'undefined'
  });

  const mockMode = String(process.env.MOCK_MODE || '').toLowerCase() === '1' || String(process.env.MOCK_MODE || '').toLowerCase() === 'true';

  if (!apiKeys.odds) {
    logger.error('Missing ODDS_API_KEY');
    if (mockMode || req.body?.mock) {
      logger.info('Returning mock parlay response');
      return res.status(200).json(buildMockParlayResponse({
        aiModel: 'mock',
        selectedSports: req.body?.selectedSports || ['NFL'],
        selectedBetTypes: req.body?.selectedBetTypes || ['Moneyline/Spread'],
        numLegs: parseInt(req.body?.numLegs) || 3
      }));
    }
    return res.status(500).json({ error: 'Server missing ODDS_API_KEY' });
  }

  try {
    // Extract request parameters
  let { selectedSports, selectedBetTypes, numLegs, oddsPlatform, aiModel, riskLevel, dateRange, fastMode } = req.body;
    
    // Validate and set defaults
    selectedSports = selectedSports || ['NFL'];
    selectedBetTypes = selectedBetTypes || ['Moneyline/Spread'];
    
    // Handle "ALL" bet types by expanding to all available types
    if (selectedBetTypes.includes('ALL') || selectedBetTypes.includes('All') || selectedBetTypes.includes('all')) {
      selectedBetTypes = Object.keys(MARKET_MAPPING); // Expand to all bet types
      logger.info('ALL bet types selected', { expandedTo: selectedBetTypes });
    }
    
    numLegs = parseInt(numLegs) || 3;
    oddsPlatform = oddsPlatform || 'DraftKings';
    aiModel = 'openai'; // force OpenAI-only
    riskLevel = riskLevel || 'Medium';
  dateRange = parseInt(dateRange) || 1;
  fastMode = !!fastMode; // optional latency-optimized mode

    // Preflight: ensure OpenAI key is present or serve mock
    if (!apiKeys.openai) {
      if (mockMode || req.body?.mock) {
        logger.info('Returning mock parlay (no AI keys)');
        return res.status(200).json(buildMockParlayResponse({ aiModel: 'mock', selectedSports, selectedBetTypes, numLegs }));
      }
      logger.error('Missing OPENAI_API_KEY');
      return res.status(500).json({ error: 'Server missing OPENAI_API_KEY' });
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎯 MULTI-AGENT PARLAY GENERATION REQUEST');
    console.log('='.repeat(60));
    console.log(`Sports: ${selectedSports.join(', ')}`);
    console.log(`Bet Types: ${selectedBetTypes.join(', ')}`);
    console.log(`Legs: ${numLegs} | Risk: ${riskLevel} | Platform: ${oddsPlatform}`);
    console.log(`AI Model: openai | Date Range: ${dateRange} days`);
    console.log('='.repeat(60) + '\n');

    // Generate unique request ID for progress tracking
    const requestId = `parlay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Initialize multi-agent coordinator
    const coordinator = new MultiAgentCoordinator(fetcher, apiKeys);

    // Generate parlays using multi-agent system
    const result = await coordinator.generateParlays({
      selectedSports,
      selectedBetTypes,
      numLegs,
      oddsPlatform,
      aiModel,
      riskLevel,
      dateRange,
      fastMode,
      requestId  // Pass requestId for progress tracking
    });

    console.log('✅ Multi-agent parlay generation successful!\n');

    return res.status(200).json(result);

  } catch (err) {
    console.error('\n❌ MULTI-AGENT ERROR:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}

module.exports = handler;