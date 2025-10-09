// Multi-Agent Parlay Generation API
const { MultiAgentCoordinator } = require('./agents/coordinator');

const SPORT_SLUGS = {
  NFL: 'americanfootball_nfl',
  NBA: 'basketball_nba',
  MLB: 'baseball_mlb',
  NHL: 'icehockey_nhl',
  Soccer: 'soccer_epl',
  NCAAF: 'americanfootball_ncaaf',
  'PGA/Golf': 'golf_pga',
  Tennis: 'tennis_atp',
  UFC: 'mma_ufc',
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

// Odds calculation functions
function americanToDecimal(americanOdds) {
  const odds = parseInt(americanOdds);
  if (odds > 0) {
    return (odds / 100) + 1;
  } else {
    return (100 / Math.abs(odds)) + 1;
  }
}

function decimalToAmerican(decimalOdds) {
  if (decimalOdds >= 2) {
    return '+' + Math.round((decimalOdds - 1) * 100);
  } else {
    return '-' + Math.round(100 / (decimalOdds - 1));
  }
}

function calculateParlay(oddsArray) {
  // Convert all odds to decimal and multiply
  const decimalOdds = oddsArray.map(odds => americanToDecimal(odds));
  const combinedDecimal = decimalOdds.reduce((acc, curr) => acc * curr, 1);
  
  // Convert back to American odds
  const combinedAmerican = decimalToAmerican(combinedDecimal);
  
  // Calculate payout on $100
  const profit = Math.round((combinedDecimal - 1) * 100);
  const payout = Math.round(combinedDecimal * 100); // total return on $100
  
  return {
    combinedOdds: combinedAmerican,
    payout: payout,
    profit
  };
}

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
    // Use proper month/day format (10/9 instead of 10/10 error)
    return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
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

function generateGeminiPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, today, dateRangeText, marketAvailabilityNote, oddsContext }) {
  return `
You are a professional sports betting analyst. Your task is to create exactly ${numLegs} parlay legs using the provided data.

STRICT REQUIREMENTS:
1. ⚠️ MANDATORY: Create EXACTLY ${numLegs} legs - no more, no less ⚠️
2. Use ONLY games and odds from the data below
3. Each leg must have: Date (MM/DD/YYYY), Game, Bet, Odds, Confidence (1-10), Reasoning
4. SMART GAME USAGE:
   - PREFER different games when available
   - IF LIMITED GAMES: Use multiple bet types from same game (spread + total + props)
   - Different players for props to avoid correlation
5. Include variety in bet types if multiple types are available
6. MANDATORY: Reference specific research data in reasoning when available
7. NEVER use generic reasons like "winning record" or "home field advantage"
8. ALWAYS cite injury reports, recent performance, or specific research insights
9. ⚠️ COUNT YOUR LEGS: Must be exactly ${numLegs} legs total ⚠️

SAME GAME PARLAY STRATEGY (when limited games):
✅ Eagles @ Giants: Eagles -6.5 spread + Over 47.5 total + Hurts Over 250.5 pass yards + AJ Brown anytime TD
✅ This creates 4 different bet types from one game
✅ No conflicting bets (all support Eagles winning big in a high-scoring game)

RESEARCH ANALYSIS REQUIREMENTS:
- When research data is provided (📰 RESEARCH: section), you MUST reference it
- Cite specific injuries, lineup changes, recent form, head-to-head trends
- Base confidence levels on concrete data points from research
- Avoid generic analysis - use the provided research insights
- If no research is available for a game, acknowledge it and be more conservative

CRITICAL CONFLICT PREVENTION RULES:
- AVOID OPPOSING BETS: No Team A moneyline + Team B moneyline (same game)
- AVOID CONFLICTING SPREADS: No Team A spread + Team B spread (same game)  
- AVOID CONFLICTING TOTALS: No Over + Under (same game)
- AVOID CONFLICTING PROPS: No same player Over + Under prop
- SAME GAME ALLOWED: Different bet types from same game (spread + total + props)
- CORRELATION LOGIC: Choose bets that support each other when from same game

SMART SAME GAME COMBINATIONS:
✅ Favorite spread + Over total + Star player props (all align with blowout)
✅ Underdog moneyline + Under total + Defensive props (align with upset)
✅ Different players props from same team (QB yards + RB yards + WR TD)

EXAMPLES OF FORBIDDEN CONFLICTS:
❌ Giants moneyline + Eagles moneyline (same game) = FORBIDDEN
❌ Cowboys +3.5 + Eagles -3.5 (same game) = FORBIDDEN  
❌ Over 45.5 + Under 45.5 (same game) = FORBIDDEN
❌ Player Over 250 yards + Same Player Under 250 yards = FORBIDDEN

EXAMPLES OF ALLOWED SAME GAME PARLAYS:
✅ Eagles -6.5 spread + Over 47.5 total + Hurts Over 250.5 pass yards = ALLOWED
✅ Chiefs moneyline + Mahomes Over 2.5 pass TDs + Kelce anytime TD = ALLOWED

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
   Reasoning: Why this will hit (cite specific research data)

2. 📅 DATE: MM/DD/YYYY
   Game: Away Team @ Home Team
   Bet: Specific bet with line
   Odds: +XXX or -XXX
   Confidence: X/10
   Reasoning: Why this will hit (cite specific research data)

[Continue for ${numLegs} total legs]

**Combined Odds:** [WILL BE CALCULATED AUTOMATICALLY]
**Payout on $100:** $[WILL BE CALCULATED AUTOMATICALLY]
**Overall Confidence:** X/10

---

**🔒 BONUS LOCK PARLAY: [Title]**

**Legs:**
1. 📅 DATE: MM/DD/YYYY
   Game: Away Team @ Home Team
   Bet: Specific bet with line
   Odds: +XXX or -XXX
   Confidence: X/10
   Reasoning: Why this is safe (cite research data)

2. 📅 DATE: MM/DD/YYYY
   Game: Away Team @ Home Team
   Bet: Specific bet with line
   Odds: +XXX or -XXX
   Confidence: X/10
   Reasoning: Why this is safe (cite research data)

**Combined Odds:** Calculate combined odds
**Payout on $100:** $XXX
**Why These Are Locks:** Brief explanation

CRITICAL FINAL CHECK:
1. ⚠️ COUNT CHECK: You MUST create exactly ${numLegs} legs in the main parlay ⚠️
2. Each leg MUST be from a different game
3. NO conflicting bets (opposing sides of same wager)
4. NO duplicate teams/players across legs  
5. NO same team with different bet types (e.g., Giants ML + Giants spread)
6. MANDATORY: Use research data to justify picks with specific details
7. Cite actual injuries, trends, or performance data in reasoning
8. Follow the exact format above
9. ⚠️ FINAL COUNT: Main parlay has exactly ${numLegs} legs ⚠️

REASONING QUALITY REQUIREMENTS:
- BAD: "Since they have a winning record I'm leaning toward them covering"
- GOOD: "QB Smith is questionable with ankle injury (per research), backup has struggled in road games this season"
- BAD: "Home field advantage should help"
- GOOD: "Research shows they're 6-1 ATS at home this season, averaging 28 PPG vs 19 on road"

DO NOT DEVIATE FROM THESE RULES.
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
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY
  };

  console.log('\n🔍 ENVIRONMENT CHECK:');
  console.log(`ODDS_KEY exists: ${!!apiKeys.odds} (length: ${apiKeys.odds?.length || 0})`);
  console.log(`OPENAI_KEY exists: ${!!apiKeys.openai} (length: ${apiKeys.openai?.length || 0})`);
  console.log(`SERPER_KEY exists: ${!!apiKeys.serper} (length: ${apiKeys.serper?.length || 0})`);
  console.log(`GEMINI_KEY exists: ${!!apiKeys.gemini} (length: ${apiKeys.gemini?.length || 0})`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);

  if (!apiKeys.odds) {
    console.log('❌ CRITICAL: Missing ODDS_API_KEY in environment');
    return res.status(500).json({ error: 'Server missing ODDS_API_KEY' });
  }

  try {
    // Extract request parameters
    let { selectedSports, selectedBetTypes, numLegs, oddsPlatform, aiModel, riskLevel, dateRange } = req.body;
    
    // Validate and set defaults
    selectedSports = selectedSports || ['NFL'];
    selectedBetTypes = selectedBetTypes || ['Moneyline/Spread'];
    
    // Handle "ALL" bet types by expanding to all available types
    if (selectedBetTypes.includes('ALL') || selectedBetTypes.includes('All') || selectedBetTypes.includes('all')) {
      selectedBetTypes = Object.keys(MARKET_MAPPING); // Expand to all bet types
      console.log(`🔥 ALL bet types selected - expanding to: ${selectedBetTypes.join(', ')}`);
    }
    
    numLegs = parseInt(numLegs) || 3;
    oddsPlatform = oddsPlatform || 'DraftKings';
    aiModel = aiModel || 'openai';
    riskLevel = riskLevel || 'Medium';
    dateRange = parseInt(dateRange) || 1;

    console.log('\n' + '='.repeat(60));
    console.log('🎯 MULTI-AGENT PARLAY GENERATION REQUEST');
    console.log('='.repeat(60));
    console.log(`Sports: ${selectedSports.join(', ')}`);
    console.log(`Bet Types: ${selectedBetTypes.join(', ')}`);
    console.log(`Legs: ${numLegs} | Risk: ${riskLevel} | Platform: ${oddsPlatform}`);
    console.log(`AI Model: ${aiModel} | Date Range: ${dateRange} days`);
    console.log('='.repeat(60) + '\n');

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
      dateRange
    });

    console.log('✅ Multi-agent parlay generation successful!\n');

    return res.status(200).json(result);

  } catch (err) {
    console.error('\n❌ MULTI-AGENT ERROR:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}

module.exports = handler;

module.exports = handler;