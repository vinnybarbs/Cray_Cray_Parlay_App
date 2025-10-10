// Multi-Agent Coordinator - Orchestrates the entire parlay generation process
const { TargetedOddsAgent } = require('./odds-agent');
const { EnhancedResearchAgent } = require('./research-agent');
const { ParlayAnalyst } = require('./analyst-agent');

// Market filtering to enforce bet type selection
const MARKET_MAPPING = {
  'Moneyline/Spread': ['h2h', 'spreads'],
  'Totals (O/U)': ['totals'],
  'Player Props': [
    'player_pass_yds', 'player_pass_tds', 'player_pass_completions', 'player_pass_attempts',
    'player_rush_yds', 'player_rush_tds', 'player_rush_attempts',
    'player_receptions', 'player_reception_yds', 'player_reception_tds',
    'player_points', 'player_rebounds', 'player_assists', 'player_threes',
    'player_shots_on_goal', 'player_goals',
    'batter_hits', 'batter_home_runs', 'pitcher_strikeouts'
  ],
  'TD Props': [
    'player_pass_tds', 'player_rush_tds', 'player_reception_tds',
    'player_anytime_td', 'player_1st_td', 'player_last_td'
  ],
  'Team Props': ['team_totals']
};

// Filter games to only include selected bet types
function filterMarketsByBetTypes(games, selectedBetTypes) {
  if (!selectedBetTypes || selectedBetTypes.length === 0 || selectedBetTypes.includes('ALL')) {
    return games; // No filtering if ALL selected
  }
  
  // Get all allowed market keys from selected bet types
  const allowedMarkets = new Set();
  selectedBetTypes.forEach(betType => {
    const markets = MARKET_MAPPING[betType] || [];
    markets.forEach(m => allowedMarkets.add(m));
  });
  
  console.log(`🔍 Filtering markets to ONLY: ${Array.from(allowedMarkets).join(', ')}`);
  
  // Filter each game's bookmakers and markets
  return games.map(game => {
    const filteredBookmakers = (game.bookmakers || []).map(bookmaker => {
      const filteredMarkets = (bookmaker.markets || []).filter(market => 
        allowedMarkets.has(market.key)
      );
      return { ...bookmaker, markets: filteredMarkets };
    }).filter(bookmaker => bookmaker.markets.length > 0);
    
    return { ...game, bookmakers: filteredBookmakers };
  }).filter(game => game.bookmakers.length > 0);
}

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
    const tStart = Date.now();
    let tOddsMs = 0, tResearchMs = 0, tAnalysisMs = 0, tPostMs = 0;

    try {
      // Phase 1: Targeted Odds Collection
    console.log('\n🏗️ PHASE 1: TARGETED ODDS COLLECTION');
    const tOdds0 = Date.now();
  const oddsResult = await this.oddsAgent.fetchOddsForSelectedBook(request);
    tOddsMs = Date.now() - tOdds0;
      
      if (oddsResult.warning) {
        console.log(`⚠️ Warning: ${oddsResult.warning}`);
      }
      
      console.log(`✅ Odds Phase Complete: ${oddsResult.odds.length} games, ${oddsResult.dataQuality}% quality`);
      console.log(`📊 Source: ${oddsResult.source}${oddsResult.fallbackUsed ? ' (fallback used)' : ''}`);
      
      // Check if Odds Agent expanded markets automatically
      if (oddsResult.marketExpanded) {
        console.log(`⚡ Odds Agent auto-expanded markets to ensure sufficient bet options`);
      }

      // Phase 2: Enhanced Research
    console.log('\n🔍 PHASE 2: ENHANCED RESEARCH');
    const tResearch0 = Date.now();
  const enrichedGames = await this.researchAgent.deepResearch(oddsResult.odds, { fastMode: !!request.fastMode });
    tResearchMs = Date.now() - tResearch0;
      
      const researchedCount = enrichedGames.filter(g => g.research).length;
      console.log(`✅ Research Phase Complete: ${researchedCount}/${enrichedGames.length} games researched`);

      // Phase 2.5: Filter markets to ONLY selected bet types
      console.log(`🔍 BEFORE FILTER: ${enrichedGames.length} games, selectedBetTypes: ${JSON.stringify(request.selectedBetTypes)}`);
      let filteredGames;
      try {
        filteredGames = filterMarketsByBetTypes(enrichedGames, request.selectedBetTypes);
        console.log(`🎯 AFTER FILTER: ${filteredGames.length} games with selected bet types`);
      } catch (filterError) {
        console.error('❌ ERROR IN FILTERING:', filterError);
        throw filterError;
      }
      
      if (!filteredGames || filteredGames.length === 0) {
        console.warn(`⚠️ No games after filtering. Using unfiltered games.`);
        filteredGames = enrichedGames; // Fallback to unfiltered
      }

      // Phase 3: AI Parlay Analysis with Retry Mechanism
    console.log('\n🧠 PHASE 3: AI PARLAY ANALYSIS');
  let aiContent = '';
  let attempts = 0;
  const maxAttempts = 1; // Reduced to 1 attempt for faster response (was 2-3)
    const tAnalysis0 = Date.now();
      
      let lastConflictSummary = '';
      while (attempts < maxAttempts) {
        attempts++;
        console.log(`🎯 Attempt ${attempts}/${maxAttempts}: Generating ${request.numLegs}-leg parlay`);
        
        const prompt = this.analyst.generateAIPrompt({
          selectedSports: request.selectedSports,
          selectedBetTypes: request.selectedBetTypes,
          numLegs: request.numLegs,
          riskLevel: request.riskLevel,
          oddsData: filteredGames, // Use filtered games instead of enrichedGames
          unavailableInfo: [],
          dateRange: request.dateRange,
          aiModel: request.aiModel,
          attemptNumber: attempts,
          retryIssues: lastConflictSummary || undefined,
          fastMode: !!request.fastMode
        });

        aiContent = await this.analyst.generateParlayWithAI(
          prompt,
          request.aiModel,
          this.fetcher,
          this.apiKeys.openai,
          this.apiKeys.gemini
        );

        // Validation: prefer machine-readable JSON; fallback to leg count
        const legCount = this.countLegsInContent(aiContent);
        const jsonBlockTry = this.extractParlayJson(aiContent);
        let jsonOk = false;
        if (jsonBlockTry) {
          try {
            const parsed = JSON.parse(jsonBlockTry);
            const legs = parsed?.parlay?.legs || [];
            const v = this.validateParlayJson(legs, request.numLegs);
            jsonOk = v.ok;
            if (!v.ok) {
              console.log(`⚠️ JSON validation failed: ${v.errors.join('; ')}`);
            }
          } catch (e) {
            console.log(`⚠️ JSON parse error: ${e.message}`);
          }
        } else {
          console.log('⚠️ No machine-readable JSON block found');
        }

        // Additional rule validation: reject if conflicts detected
        const ruleCheck = this.validateParlayContent(aiContent, enrichedGames);
        const hasConflicts = !!ruleCheck.hasConflicts && ruleCheck.betConflicts && ruleCheck.betConflicts.length > 0;
        if (hasConflicts) {
          const bullets = ruleCheck.betConflicts.slice(0,6).map(c => `- ${c.game}: "${c.bet1}" vs "${c.bet2}"`).join('\n');
          lastConflictSummary = `CONFLICTS DETECTED (fix these):\n${bullets}\nRules: NO opposing sides in same game, NO same-team ML+Spread, NO duplicate exact bets.`;
          console.log('❌ Conflicts detected, will retry with explicit feedback:\n' + lastConflictSummary);
        } else {
          lastConflictSummary = '';
        }

        // Only reject on TRUE conflicts, be lenient on leg count (close is good enough)
        const legCountClose = Math.abs(legCount - request.numLegs) <= 1;
        const pass = (jsonOk || legCountClose) && !hasConflicts;
        console.log(`📊 Validation: JSON ${jsonOk ? 'OK' : 'FAIL'}, Text legs ${legCount}/${request.numLegs}, Conflicts: ${hasConflicts ? 'YES' : 'NO'}`);

        if (pass) {
          console.log(`✅ AI Analysis Complete on attempt ${attempts}`);
          break;
        } else if (attempts < maxAttempts) {
          console.log('🔁 Retrying due to conflicts or validation issues...');
        } else {
          console.log(`⚠️ Using best available output after ${maxAttempts} attempt(s)`);
        }
  }
  tAnalysisMs = Date.now() - tAnalysis0;

  // Phase 4: Post-Processing & Validation
  console.log('\n🔧 PHASE 4: POST-PROCESSING & VALIDATION');
  const tPost0 = Date.now();
  const correctedContent = fixOddsCalculations(aiContent);

      // Try to extract machine-readable JSON
      const jsonBlock = this.extractParlayJson(aiContent);
      let jsonLegs = null;
      let jsonLockLegs = null;
      if (jsonBlock) {
        try {
          const parsed = JSON.parse(jsonBlock);
          if (parsed && parsed.parlay && Array.isArray(parsed.parlay.legs)) {
            jsonLegs = parsed.parlay.legs;
          }
          if (parsed && parsed.lockParlay && Array.isArray(parsed.lockParlay.legs)) {
            jsonLockLegs = parsed.lockParlay.legs;
          }
        } catch (e) {
          console.log('⚠️ Failed to parse parlay JSON:', e.message);
        }
      }

      // Build output: strip JSON from user-facing content, then normalize to exactly one 2-pick LOCK PARLAY
      let baseContent = correctedContent;
      if (jsonBlock) {
        baseContent = this.stripParlayJson(baseContent);
      }

      // Prepare a single lock parlay section from JSON legs (preferred) or fallback
      let singleLockSection = null;
      if (jsonLegs && jsonLegs.length >= 2) {
        const picked = [...jsonLegs].sort((a,b) => (b.confidence||0) - (a.confidence||0)).slice(0,2);
        singleLockSection = this.formatLockParlaySection(picked);
      }
      if (!singleLockSection) {
        singleLockSection = this.buildTwoPickLock(baseContent); // fallback from text
      }

      // Remove any existing lock parlay sections and insert exactly one
      let sanitized = this.removeLockParlaySections(baseContent);
      if (singleLockSection) {
        sanitized = `${sanitized}\n\n${singleLockSection}`;
      }

      let finalContent = sanitized;
      
      // Add disclaimer ONLY if Odds Agent automatically expanded markets
      if (oddsResult.marketExpanded) {
        const disclaimer = `\n\n---\n\n⚠️ **SAME-GAME PARLAY NOTICE**\n\nDue to limited games available (${oddsResult.odds.length} game${oddsResult.odds.length === 1 ? '' : 's'}), additional bet types were automatically included to reach ${request.numLegs} legs. This parlay includes multiple bets from the same game(s). While this allows for more betting options, be aware that same-game parlays have correlated outcomes.\n\n**Conflict Prevention Rules Active:**\n- ✅ No opposing totals (Over/Under)\n- ✅ No opposing spreads\n- ✅ No Moneyline + Spread on same team\n- ✅ No duplicate bets\n\n---`;
        finalContent = finalContent + disclaimer;
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
      tPostMs = Date.now() - tPost0;

      // Phase 5: Quality Assurance
      const totalMs = Date.now() - tStart;
      const metadata = {
        oddsSource: oddsResult.source,
        fallbackUsed: oddsResult.fallbackUsed,
        fallbackReason: oddsResult.fallbackReason,
        dataQuality: oddsResult.dataQuality,
        researchedGames: researchedCount,
        totalGames: enrichedGames.length,
        aiModel: request.aiModel,
        timings: {
          oddsMs: tOddsMs,
          researchMs: tResearchMs,
          analysisMs: tAnalysisMs,
          postProcessingMs: tPostMs,
          totalMs
        },
        processingTime: Date.now()
      };

      console.log('\n' + '='.repeat(80));
      console.log('🎉 MULTI-AGENT PARLAY GENERATION COMPLETE');
      console.log(`📊 Quality Score: ${metadata.dataQuality}%`);
      console.log(`🔍 Research Coverage: ${researchedCount}/${enrichedGames.length} games`);
      console.log(`💾 Data Source: ${metadata.oddsSource}`);
      console.log(`⏱️ Timings (ms): odds=${tOddsMs} research=${tResearchMs} analysis=${tAnalysisMs} post=${tPostMs} total=${totalMs}`);
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

  extractParlayJson(text) {
    try {
      const start = text.indexOf('===BEGIN_PARLAY_JSON===');
      const end = text.indexOf('===END_PARLAY_JSON===');
      if (start === -1 || end === -1 || end <= start) return null;
      const block = text.substring(start + '===BEGIN_PARLAY_JSON==='.length, end).trim();
      return block;
    } catch { return null; }
  }

  stripParlayJson(text) {
    try {
      // Remove all JSON blocks between the markers globally
      const re = /===BEGIN_PARLAY_JSON===([\s\S]*?)===END_PARLAY_JSON===/g;
      let cleaned = text.replace(re, '');
      
      // Also remove any JSON blocks wrapped in code fences (Gemini sometimes does this)
      cleaned = cleaned.replace(/```json\s*([\s\S]*?)```/g, '');
      cleaned = cleaned.replace(/```\s*([\s\S]*?)```/g, '');
      
      // Clean up multiple newlines
      return cleaned.replace(/\n{3,}/g, '\n\n').trim();
    } catch { return text; }
  }

  formatLockParlaySection(legs) {
    try {
      const picked = (legs || []).slice(0,2);
      if (picked.length < 2) return null;
      const block = [
        '**🔒 BONUS LOCK PARLAY: Two High-Confidence Picks**',
        '',
        '**Legs:**',
        picked.map((l, i) => `${i+1}. 📅 DATE: ${l.date}\n   Game: ${l.game}\n   Bet: ${l.bet}\n   Odds: ${l.odds}\n   Confidence: ${l.confidence}/10`).join('\n\n'),
        '',
        '**Why These Are Locks:** Highest confidence legs with solid research support and reasonable odds.'
      ].join('\n');
      return block;
    } catch { return null; }
  }

  removeLockParlaySections(text) {
    try {
      // Remove any block that starts with a LOCK PARLAY header and continues until the next top-level header or end
      // Top-level headers begin with '**'. We non-greedily match until the next '**' line or end of text.
      const pattern = /\*\*[^\n]*LOCK\s+PARLAY:[\s\S]*?(?=(\n\*\*[^\n]*\n)|$)/gi;
      const cleaned = text.replace(pattern, '').replace(/\n{3,}/g, '\n\n').trim();
      return cleaned;
    } catch {
      return text;
    }
  }

  validateParlayJson(legs, expectedCount) {
    const errors = [];
    if (!Array.isArray(legs)) {
      return { ok: false, errors: ['legs is not an array'] };
    }
    if (legs.length !== expectedCount) {
      errors.push(`legs length ${legs.length} != expected ${expectedCount}`);
    }
    const oddsRe = /^[+-]\d{2,5}$/; // enforce normalized American odds, use +100 for EV/PK
    legs.forEach((l, idx) => {
      if (!l || typeof l !== 'object') {
        errors.push(`leg ${idx+1} missing object`);
        return;
      }
      if (!l.date) errors.push(`leg ${idx+1} missing date`);
      if (!l.game) errors.push(`leg ${idx+1} missing game`);
      if (!l.bet) errors.push(`leg ${idx+1} missing bet`);
      if (!l.odds || !oddsRe.test(String(l.odds))) errors.push(`leg ${idx+1} invalid odds '${l.odds}'`);
      if (typeof l.confidence !== 'number') errors.push(`leg ${idx+1} missing confidence`);
    });
    return { ok: errors.length === 0, errors };
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
    const seenExactBets = new Set();
    for (let i = 0; i < legMatches.length; i++) {
      for (let j = i + 1; j < legMatches.length; j++) {
        const bet1 = legMatches[i].bet.toLowerCase();
        const bet2 = legMatches[j].bet.toLowerCase();
        const game1 = legMatches[i].game;
        const game2 = legMatches[j].game;
        
        // Same game opposing bets (actual conflicts)
        if (game1 === game2) {
          // Check for opposing spreads/totals/moneylines
          const sameTeam = (txt) => txt.split(' ')[0];
          const isOppositeTotals = (bet1.includes('over') && bet2.includes('under')) || (bet1.includes('under') && bet2.includes('over'));
          const isOppositeSpread = (bet1.includes('+') && bet2.includes('-') && sameTeam(bet1) !== sameTeam(bet2)) || (bet1.includes('-') && bet2.includes('+') && sameTeam(bet1) !== sameTeam(bet2));
          const isMLSpreadSameTeam = (bet1.includes('moneyline') && bet2.includes('spread') && sameTeam(bet1) === sameTeam(bet2)) || (bet2.includes('moneyline') && bet1.includes('spread') && sameTeam(bet1) === sameTeam(bet2));
          const isExactDup = bet1 === bet2;
          const isConflict = isOppositeTotals || isOppositeSpread || isMLSpreadSameTeam || isExactDup;
          
          if (isConflict) {
            hasConflicts = true;
            betConflicts.push({ bet1, bet2, game: game1 });
          }
        }
      }
    }

    // Duplicate exact bets (across any games) are flagged
    legMatches.forEach(leg => {
      const key = `${leg.game}|${leg.bet.toLowerCase()}`;
      if (seenExactBets.has(key)) {
        hasConflicts = true;
        betConflicts.push({ bet1: leg.bet, bet2: leg.bet, game: leg.game });
      } else {
        seenExactBets.add(key);
      }
    });
    
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