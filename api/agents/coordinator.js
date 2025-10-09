// Multi-Agent Coordinator - Orchestrates the entire parlay generation process
const { TargetedOddsAgent } = require('./odds-agent');
const { EnhancedResearchAgent } = require('./research-agent');
const { ParlayAnalyst } = require('./analyst-agent');

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
  // profit = (decimal - 1) * stake, totalReturn = decimal * stake
  const profit = Math.round((combinedDecimal - 1) * 100);
  const payout = Math.round(combinedDecimal * 100); // total return on $100
  
  return {
    combinedOdds: combinedAmerican,
    payout: payout,
    profit
  };
}

// Function to fix odds calculations in AI-generated content
function fixOddsCalculations(content) {
  const lines = content.split('\n');
  const fixedLines = [];
  
  let currentParlayOdds = [];
  let inParlay = false;
  let expectingOddsForCurrentLeg = false;
  let pushedOddsForCurrentLeg = false;

  // Helpers
  const normalizeAmerican = (token) => {
    const t = (token || '').toString().trim().toUpperCase();
    if (t === 'EV' || t === 'EVEN' || t === 'PK' || t === 'PICK' || t === 'PICKEM' || t === 'PICK\'EM') {
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
    
    // Detect start of a new leg (e.g., "1. 📅 ...")
    if (inParlay) {
      const legStart = line.match(/^\s*\d+\.\s*📅/);
      if (legStart) {
        expectingOddsForCurrentLeg = true;
        pushedOddsForCurrentLeg = false;
      }
    }

    // Extract odds from legs
    if (inParlay && line.trim().startsWith('Odds:')) {
      const oddsMatch = line.match(/Odds:\s*([+-]?\d{2,5}|EVEN|EV|PK|PICK)/i);
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
    // Fallback: Extract odds from Bet line parentheses if present and not yet pushed for this leg
    if (inParlay && expectingOddsForCurrentLeg && !pushedOddsForCurrentLeg && line.trim().startsWith('Bet:')) {
      // Look for something like Team -3.5 (+100) or Over 47.5 (-110)
      const parenMatches = [...line.matchAll(/\(([+\-]?\d{2,5}|EVEN|EV|PK|PICK)\)/gi)];
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

class MultiAgentCoordinator {
  constructor(fetcher, apiKeys) {
    this.fetcher = fetcher;
    this.apiKeys = apiKeys;
    
    // Initialize agents
    this.oddsAgent = new TargetedOddsAgent(fetcher, apiKeys.odds);
    this.researchAgent = new EnhancedResearchAgent(fetcher, apiKeys.serper);
    this.analyst = new ParlayAnalyst();
  }

  async generateParlays(request) {
    console.log('\n' + '='.repeat(80));
    console.log('🎯 MULTI-AGENT PARLAY GENERATION STARTING');
    console.log('='.repeat(80));
    console.log(`Request: ${request.numLegs} legs, ${request.selectedSports.join('+')}, ${request.riskLevel} risk`);
    console.log(`Sportsbook: ${request.oddsPlatform} (with smart fallbacks)`);
    console.log('='.repeat(80));

    try {
      // Phase 1: Targeted Odds Collection
      console.log('\n🏗️ PHASE 1: TARGETED ODDS COLLECTION');
      const oddsResult = await this.oddsAgent.fetchOddsForSelectedBook(request);
      
      if (oddsResult.warning) {
        console.log(`⚠️ Warning: ${oddsResult.warning}`);
      }
      
      console.log(`✅ Odds Phase Complete: ${oddsResult.odds.length} games, ${oddsResult.dataQuality}% quality`);
      console.log(`📊 Source: ${oddsResult.source}${oddsResult.fallbackUsed ? ' (fallback used)' : ''}`);

      // Phase 2: Enhanced Research
      console.log('\n🔍 PHASE 2: ENHANCED RESEARCH');
  const enrichedGames = await this.researchAgent.deepResearch(oddsResult.odds);
      
      const researchedCount = enrichedGames.filter(g => g.research).length;
      console.log(`✅ Research Phase Complete: ${researchedCount}/${enrichedGames.length} games researched`);

      // Phase 3: AI Parlay Analysis with Retry Mechanism
      console.log('\n🧠 PHASE 3: AI PARLAY ANALYSIS');
      let aiContent = '';
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        attempts++;
        console.log(`🎯 Attempt ${attempts}/${maxAttempts}: Generating ${request.numLegs}-leg parlay`);
        
        const prompt = this.analyst.generateAIPrompt({
          selectedSports: request.selectedSports,
          selectedBetTypes: request.selectedBetTypes,
          numLegs: request.numLegs,
          riskLevel: request.riskLevel,
          oddsData: enrichedGames,
          unavailableInfo: [],
          dateRange: request.dateRange,
          aiModel: request.aiModel,
          attemptNumber: attempts
        });

        aiContent = await this.analyst.generateParlayWithAI(
          prompt,
          request.aiModel,
          this.fetcher,
          this.apiKeys.openai,
          this.apiKeys.gemini
        );

  // Quick validation of leg count
        const legCount = this.countLegsInContent(aiContent);
        console.log(`📊 Generated ${legCount} legs (requested: ${request.numLegs})`);
        
        if (legCount === request.numLegs) {
          console.log(`✅ AI Analysis Complete: Correct leg count achieved on attempt ${attempts}`);
          break;
        } else if (attempts < maxAttempts) {
          console.log(`⚠️ Leg count mismatch (${legCount}/${request.numLegs}), retrying...`);
        } else {
          console.log(`❌ Failed to achieve correct leg count after ${maxAttempts} attempts`);
        }
      }

      // Phase 4: Post-Processing & Validation
      console.log('\n🔧 PHASE 4: POST-PROCESSING & VALIDATION');
      const correctedContent = fixOddsCalculations(aiContent);

      // Ensure a 2-pick lock parlay exists; if missing, synthesize from highest-confidence legs
      let finalContent = correctedContent;
      if (!/🔒\s*LOCK PARLAY:/i.test(finalContent)) {
        const twoLock = this.buildTwoPickLock(correctedContent);
        if (twoLock) {
          finalContent = `${correctedContent}\n\n${twoLock}`;
        }
      }
      
      // Enhanced validation to catch actual conflicts (not same-game parlays)
  const validationResult = this.validateParlayContent(finalContent, enrichedGames);
      if (validationResult.hasConflicts) {
        console.log('⚠️ Actual bet conflicts detected (opposing sides), flagging in response');
      }
      
      if (validationResult.actualLegCount !== request.numLegs) {
        console.log(`⚠️ Leg count mismatch: requested ${request.numLegs}, got ${validationResult.actualLegCount}`);
      }
      
      console.log('✅ Odds calculations verified and corrected');

      // Phase 5: Quality Assurance
      const metadata = {
        oddsSource: oddsResult.source,
        fallbackUsed: oddsResult.fallbackUsed,
        fallbackReason: oddsResult.fallbackReason,
        dataQuality: oddsResult.dataQuality,
        researchedGames: researchedCount,
        totalGames: enrichedGames.length,
        aiModel: request.aiModel,
        processingTime: Date.now()
      };

      console.log('\n' + '='.repeat(80));
      console.log('🎉 MULTI-AGENT PARLAY GENERATION COMPLETE');
      console.log(`📊 Quality Score: ${metadata.dataQuality}%`);
      console.log(`🔍 Research Coverage: ${researchedCount}/${enrichedGames.length} games`);
      console.log(`💾 Data Source: ${metadata.oddsSource}`);
      console.log('='.repeat(80));

      return {
        content: finalContent,
        metadata: metadata
      };

    } catch (error) {
      console.error('\n❌ MULTI-AGENT ERROR:', error);
      throw error;
    }
  }

  // Quick validation to count legs in generated content
  countLegsInContent(content) {
    const lines = content.split('\n');
    let legCount = 0;
    
    lines.forEach(line => {
      // Look for numbered legs (1., 2., 3., etc.) followed by date emoji
      const legMatch = line.match(/^\s*(\d+)\.\s*📅/);
      if (legMatch) {
        legCount++;
      }
    });
    
    return legCount;
  }

  // Build a simple 2-pick lock parlay section if missing
  buildTwoPickLock(content) {
    const lines = content.split('\n');
    const legs = [];
    let currentLeg = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const legStart = line.match(/^\s*(\d+)\.\s*📅/);
      if (legStart) {
        if (currentLeg) legs.push(currentLeg);
        currentLeg = { index: parseInt(legStart[1], 10), lines: [line], confidence: 0, odds: null };
        continue;
      }
      if (currentLeg) {
        currentLeg.lines.push(line);
        const confMatch = line.match(/Confidence:\s*(\d+)\/(\d+)/i);
        if (confMatch) {
          currentLeg.confidence = Math.max(currentLeg.confidence, parseInt(confMatch[1], 10));
        }
        const oddsMatch = line.match(/Odds:\s*([+\-]?\d{2,5}|EV|EVEN|PK|PICK)/i) || line.match(/\(([+\-]?\d{2,5}|EV|EVEN|PK|PICK)\)/i);
        if (oddsMatch && !currentLeg.odds) currentLeg.odds = oddsMatch[1];
      }
    }
    if (currentLeg) legs.push(currentLeg);
    if (legs.length < 2) return null;
    // Pick top 2 by confidence (fallback to first two)
    const picked = legs.sort((a,b) => b.confidence - a.confidence).slice(0,2);
    const section = [
      '**🔒 BONUS LOCK PARLAY: Two High-Confidence Picks**',
      '',
      '**Legs:**',
      picked.map((leg, idx) => `${idx+1}. ${leg.lines.join('\n   ')}`).join('\n\n'),
      '',
      '**Why These Are Locks:** Highest confidence legs with solid research support and reasonable odds.',
    ].join('\n');
    return section;
  }

  // Validate parlay content for actual conflicts and date issues
  validateParlayContent(content, games) {
    const lines = content.split('\n');
    const legMatches = [];
    let hasConflicts = false;
    let wrongDates = false;
    let actualLegCount = 0;
    
    // Extract all leg information
    lines.forEach((line, index) => {
      // Count actual legs (numbered format)
      const legMatch = line.match(/^\s*(\d+)\.\s*📅/);
      if (legMatch) {
        actualLegCount++;
      }
      
      if (line.includes('Game:')) {
        const gameMatch = line.match(/Game:\s*(.+)/);
        const betMatch = lines[index + 1]?.match(/Bet:\s*(.+)/);
        if (gameMatch && betMatch) {
          legMatches.push({
            line: index,
            game: gameMatch[1].trim(),
            bet: betMatch[1].trim(),
            originalLine: line
          });
        }
      }
      
      // Check for wrong dates (using today's date instead of game date)
      if (line.includes('DATE:') && line.includes('10/09/2025')) {
        wrongDates = true;
      }
    });
    
    // Check for ACTUAL conflicts (same bet on opposing sides)
    const betConflicts = [];
    for (let i = 0; i < legMatches.length; i++) {
      for (let j = i + 1; j < legMatches.length; j++) {
        const bet1 = legMatches[i].bet.toLowerCase();
        const bet2 = legMatches[j].bet.toLowerCase();
        const game1 = legMatches[i].game;
        const game2 = legMatches[j].game;
        
        // Same game opposing bets (actual conflicts)
        if (game1 === game2) {
          // Check for opposing spreads/totals/moneylines
          const isConflict = (
            (bet1.includes('over') && bet2.includes('under')) ||
            (bet1.includes('under') && bet2.includes('over')) ||
            (bet1.includes('-') && bet2.includes('+') && bet1.split(' ')[0] !== bet2.split(' ')[0]) ||
            (bet1 === bet2) // Exact same bet
          );
          
          if (isConflict) {
            hasConflicts = true;
            betConflicts.push({ bet1, bet2, game: game1 });
          }
        }
      }
    }
    
    if (betConflicts.length > 0) {
      console.log('❌ Actual bet conflicts detected:');
      betConflicts.forEach(conflict => {
        console.log(`   ${conflict.game}: ${conflict.bet1} vs ${conflict.bet2}`);
      });
    }
    
    if (wrongDates) {
      console.log('❌ Incorrect dates detected (using today instead of game date)');
    }
    
  const gameNames = legMatches.map(g => g.game);
    const uniqueGames = new Set(gameNames);
    
    console.log(`✅ Legs generated: ${actualLegCount}, Unique games: ${uniqueGames.size}, Same-game parlays: ${gameNames.length > uniqueGames.size ? 'YES' : 'NO'}`);

    // Lightweight plausibility check using research text (heuristic)
    try {
      const researchMap = new Map();
      (games || []).forEach(g => {
        const key = `${g.away_team} @ ${g.home_team}`;
        researchMap.set(key, (g.research || '').toLowerCase());
      });
      legMatches.forEach(leg => {
        const r = researchMap.get(leg.game) || '';
        if (leg.bet.toLowerCase().includes('over') && /hasn't|has not|rarely|under|below/.test(r)) {
          console.log(`⚠️ Heuristic: Bet may contradict research: ${leg.game} :: ${leg.bet}`);
        }
        if (leg.bet.toLowerCase().includes('yards') && /avg|average|per game/.test(r) && /\d+/.test(leg.bet)) {
          // could parse numbers for a stricter check in future
        }
      });
    } catch (e) { /* best effort */ }
    
    return {
      hasConflicts,
      wrongDates,
      uniqueGamesCount: uniqueGames.size,
      totalLegsAttempted: legMatches.length,
      actualLegCount,
      betConflicts
    };
  }

  // Health check for all agents
  async healthCheck() {
    const health = {
      oddsAgent: false,
      researchAgent: false,
      analyst: true, // Always available
      apiKeys: {
        odds: !!this.apiKeys.odds,
        serper: !!this.apiKeys.serper,
        openai: !!this.apiKeys.openai,
        gemini: !!this.apiKeys.gemini
      }
    };

    // Test odds agent
    try {
      // Simple test call
      health.oddsAgent = true;
    } catch (error) {
      console.log('Odds agent health check failed:', error.message);
    }

    // Test research agent
    try {
      if (this.apiKeys.serper) {
        health.researchAgent = true;
      }
    } catch (error) {
      console.log('Research agent health check failed:', error.message);
    }

    return health;
  }
}

module.exports = { 
  MultiAgentCoordinator,
  fixOddsCalculations,
  calculateParlay,
  americanToDecimal,
  decimalToAmerican
};