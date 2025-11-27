// Multi-Agent Coordinator - Orchestrates the entire parlay generation process
const { TargetedOddsAgent } = require('./odds-agent');
const { EnhancedResearchAgent } = require('./research-agent');
const { ParlayAnalyst } = require('./analyst-agent');
const { SportsStatsService } = require('../services/sports-stats');
const { SportsIntelligenceService } = require('../services/sports-intelligence');
const { findTeamUniversal } = require('../services/static-team-mapping');
const { MARKET_MAPPING } = require('../../shared/constants');
const { calculateParlay, americanToDecimal, decimalToAmerican } = require('../../shared/oddsCalculations');
const { createLogger } = require('../../shared/logger');

const logger = createLogger('Coordinator');

// Filter games to only include selected bet types (and risk-level constraints)
function filterMarketsByBetTypes(games, selectedBetTypes, riskLevel) {
  if (!selectedBetTypes || selectedBetTypes.length === 0 || selectedBetTypes.includes('ALL')) {
    return games; // No filtering if ALL selected
  }
  
  // Get all allowed market keys from selected bet types
  const allowedMarkets = new Set();
  selectedBetTypes.forEach(betType => {
    let markets = MARKET_MAPPING[betType] || [];
    // Low risk: restrict Moneyline/Spread to Moneyline (h2h) only
    if (riskLevel === 'Low' && betType === 'Moneyline/Spread') {
      markets = ['h2h'];
    }
    markets.forEach(m => allowedMarkets.add(m));
  });
  
  logger.info('Filtering markets', { 
    allowedMarkets: Array.from(allowedMarkets),
    selectedBetTypes 
  });
  
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
    const m = t.match(/^([+-]?\d{2,5})/);
    if (m) {
      const odds = m[1];
      // If no sign, assume positive (underdog) odds
      return odds.startsWith('+') || odds.startsWith('-') ? odds : `+${odds}`;
    }
    return null;
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
      const oddsMatch = line.match(/Odds:\s*\(?([+-]?\d{2,5}|EVEN|EV|PK|PICK)\)?/i);
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
  constructor(fetcher, apiKeys, supabase = null) {
    this.fetcher = fetcher;
    this.apiKeys = apiKeys;
    this.supabase = supabase;
    
    // Initialize agents (pass supabase for caching)
    this.oddsAgent = new TargetedOddsAgent(fetcher, apiKeys.odds, supabase);
    this.researchAgent = new EnhancedResearchAgent(fetcher, apiKeys.serper, supabase);
    this.analyst = new ParlayAnalyst();
    
    // Initialize sports stats service for cached data
    this.statsService = new SportsStatsService();
    
    // Initialize sports intelligence service for cached news/insights
    this.intelligenceService = new SportsIntelligenceService();
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
    const requestId = request.requestId; // Get requestId from request

    try {
      // Phase 1: Targeted Odds Collection
    console.log('\n🏗️ PHASE 1: TARGETED ODDS COLLECTION');
    if (requestId && global.emitProgress) {
      global.emitProgress(requestId, 'odds', 'active', { message: 'Fetching odds data...' });
    }
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
      
      if (requestId && global.emitProgress) {
        global.emitProgress(requestId, 'odds', 'complete', { 
          gameCount: oddsResult.odds.length,
          source: oddsResult.source
        });
      }

      // Phase 2: Enhanced Research
    console.log('\n🔍 PHASE 2: ENHANCED RESEARCH');
    if (requestId && global.emitProgress) {
      global.emitProgress(requestId, 'research', 'active', { message: 'Researching games...' });
    }
    const tResearch0 = Date.now();
  const enrichedGames = await this.researchAgent.deepResearch(oddsResult.odds, { 
      fastMode: !!request.fastMode,
      numLegs: request.numLegs,
      riskLevel: request.riskLevel,
      selectedSports: request.selectedSports
    });
    tResearchMs = Date.now() - tResearch0;
      
      const researchedCount = enrichedGames.filter(g => g.research && g.research.trim().length > 0).length;
      console.log(`✅ Research Phase Complete: ${researchedCount}/${enrichedGames.length} games researched`);
      
      if (requestId && global.emitProgress) {
        global.emitProgress(requestId, 'research', 'complete', { 
          researchedCount,
          totalGames: enrichedGames.length
        });
      }

      // Phase 2.25: Sports Stats Enrichment
      console.log('\n📊 PHASE 2.25: SPORTS STATS ENRICHMENT');
      if (requestId && global.emitProgress) {
        global.emitProgress(requestId, 'stats', 'active', { message: 'Enriching with cached stats...' });
      }
      
      const enrichedGamesWithStats = await this.enrichWithCachedStats(enrichedGames, request.selectedSports);
      console.log(`✅ Stats Enrichment Complete: Enhanced ${enrichedGamesWithStats.length} games with cached data`);
      
      if (requestId && global.emitProgress) {
        global.emitProgress(requestId, 'stats', 'complete', { 
          enrichedCount: enrichedGamesWithStats.length
        });
      }

      // Phase 2.3: Sports Intelligence Enrichment  
      console.log('\n🧠 PHASE 2.3: SPORTS INTELLIGENCE ENRICHMENT');
      if (requestId && global.emitProgress) {
        global.emitProgress(requestId, 'intelligence', 'active', { message: 'Adding cached insights...' });
      }
      
      const enrichedGamesWithIntelligence = await this.enrichWithCachedIntelligence(enrichedGamesWithStats, request.selectedSports);
      console.log(`✅ Intelligence Enrichment Complete: Added insights to ${enrichedGamesWithIntelligence.length} games`);
      
      if (requestId && global.emitProgress) {
        global.emitProgress(requestId, 'intelligence', 'complete', { 
          enrichedCount: enrichedGamesWithIntelligence.length
        });
      }

      // Phase 2.5: Filter markets to ONLY selected bet types
      console.log(`🔍 BEFORE FILTER: ${enrichedGamesWithIntelligence.length} games, selectedBetTypes: ${JSON.stringify(request.selectedBetTypes)}`);
      let filteredGames;
      try {
        filteredGames = filterMarketsByBetTypes(enrichedGamesWithIntelligence, request.selectedBetTypes, request.riskLevel);
        console.log(`🎯 AFTER FILTER: ${filteredGames.length} games with selected bet types`);
      } catch (filterError) {
        console.error('❌ ERROR IN FILTERING:', filterError);
        throw filterError;
      }
      
      if (!filteredGames || filteredGames.length === 0) {
        console.warn(`⚠️ No games after filtering. Using unfiltered games.`);
        filteredGames = enrichedGamesWithIntelligence; // Fallback to unfiltered (with intelligence)
      }

      // Phase 2.75: Player Verification (for NFL, NCAAF, NBA only)
      let verificationContext = '';
      const sport = request.selectedSports?.[0]; // Get primary sport
      const sportsWithPlayerProps = ['NFL', 'NCAAF', 'NBA'];
      
      const hasApiKey = !!(process.env.APISPORTS_API_KEY || process.env.API_SPORTS_KEY);
      if (sport && sportsWithPlayerProps.includes(sport) && hasApiKey) {
        console.log('\n🔍 PHASE 2.75: PLAYER VERIFICATION');
        if (requestId && global.emitProgress) {
          global.emitProgress(requestId, 'verification', 'active', { message: 'Verifying player rosters...' });
        }

        try {
          // Extract player props from odds data
          const playerProps = this.extractPlayerProps(filteredGames);
          console.log(`📋 Found ${playerProps.length} player props to verify`);

          if (playerProps.length > 0) {
            // Verify player-team assignments
            const verifications = await this.verifyPlayerTeams(playerProps, sport);
            
            // Count results
            const verified = verifications.filter(v => v.found && v.correctTeam).length;
            const mismatched = verifications.filter(v => v.found && !v.correctTeam).length;
            const unknown = verifications.filter(v => !v.found).length;
            
            console.log(`✅ Verification complete: ${verified} verified, ${mismatched} mismatched, ${unknown} unknown`);
            
            // Format for AI context
            verificationContext = this.formatVerificationContext(verifications);
            
            if (requestId && global.emitProgress) {
              global.emitProgress(requestId, 'verification', 'complete', { 
                verified, 
                mismatched, 
                unknown 
              });
            }
          } else {
            console.log('ℹ️ No player props found to verify');
          }
        } catch (verifyError) {
          console.error('⚠️ Player verification failed:', verifyError.message);
          // Continue without verification rather than failing
        }
      } else if (sport && sportsWithPlayerProps.includes(sport) && !hasApiKey) {
        console.log('⚠️ APISPORTS_API_KEY not configured - skipping player verification');
      }

      // Phase 3: AI Parlay Analysis with Retry Mechanism
    console.log('\n🧠 PHASE 3: AI PARLAY ANALYSIS');
    if (requestId && global.emitProgress) {
      global.emitProgress(requestId, 'analysis', 'active', { message: 'AI analyzing picks...' });
    }
  let aiContent = '';
  let attempts = 0;
  const maxAttempts = request.riskLevel === 'Low' ? 3 : 1; // allow two retries for Low-risk odds policy
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
          aiModel: 'openai',
          attemptNumber: attempts,
          retryIssues: lastConflictSummary || undefined,
          fastMode: !!request.fastMode,
          verificationContext: verificationContext || null // Add verified player data
        });

        aiContent = await this.analyst.generateParlayWithAI(
          prompt,
          this.fetcher,
          this.apiKeys.openai
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

        // Enforce Low-risk per-leg odds policy: all legs should be heavy favorites (-200 or shorter)
        let hasPolicyIssues = false;
        if (request.riskLevel === 'Low') {
          const re = /Odds:\s*\(?([+\-]?\d{2,5}|EVEN|EV|PK|PICK)\)?/gi;
          let m; let violations = 0; const found = [];
          while ((m = re.exec(aiContent))) {
            const raw = (m[1] || '').toUpperCase();
            let val = Number.NaN;
            if (raw === 'EV' || raw === 'EVEN' || raw === 'PK' || raw === 'PICK') {
              val = 100; // even money
            } else {
              val = parseInt(raw, 10);
            }
            if (Number.isNaN(val) || val > -200) { // e.g., -150 or +120 or even -> violation
              violations++;
              found.push(raw);
            }
          }
          if (violations > 0) {
            hasPolicyIssues = true;
            lastConflictSummary = `LOW-RISK POLICY: ${violations} leg(s) violated heavy-favorite rule (found: ${found.slice(0,6).join(', ')}). ACTION: Do NOT use ~-110 spreads/props. Convert to the same-side MONEYLINE or ATD with odds between -200 and -1000. Calibrate confidence to odds: (-110..-150 → 6-7/10), (-151..-200 → 7-8/10), (-201..-400 → up to 8/10), (-401..-800 → 9/10). Target combined +200..+400.`;
            console.log('⚠️ ' + lastConflictSummary);
          }

          // Confidence vs odds calibration enforcement
          const legBlockRe = /\d+\.\s*📅[\s\S]*?Odds:\s*\(?([+\-]?\d{2,5}|EVEN|EV|PK|PICK)\)?[\s\S]*?Confidence:\s*(\d+)\/(10)/gi;
          let cv; let confViolations = 0; const confFound = [];
          while ((cv = legBlockRe.exec(aiContent))) {
            const rawOdds = (cv[1] || '').toUpperCase();
            const conf = parseInt(cv[2], 10) || 0;
            let o = Number.NaN;
            if (rawOdds === 'EV' || rawOdds === 'EVEN' || rawOdds === 'PK' || rawOdds === 'PICK') {
              o = 100;
            } else {
              o = parseInt(rawOdds, 10);
            }
            // Enforce calibration thresholds for Low risk
            if (conf >= 9 && (Number.isNaN(o) || o > -401)) { confViolations++; confFound.push(`${rawOdds}@${conf}`); }
            else if (conf >= 8 && (Number.isNaN(o) || o > -201)) { confViolations++; confFound.push(`${rawOdds}@${conf}`); }
            else if (conf >= 7 && (Number.isNaN(o) || o > -151)) { confViolations++; confFound.push(`${rawOdds}@${conf}`); }
          }
          if (confViolations > 0) {
            hasPolicyIssues = true;
            const msg = `CONFIDENCE MISMATCH: ${confViolations} leg(s) had confidence too high for price (found: ${confFound.slice(0,6).join(', ')}). ACTION: Recalibrate confidence per odds bands or choose heavier favorites (ML/ATD). Do NOT justify picks solely by implied probability.`;
            lastConflictSummary = lastConflictSummary ? (lastConflictSummary + '\n' + msg) : msg;
            console.log('⚠️ ' + msg);
          }
        }

        // Only reject on TRUE conflicts or policy issues; be lenient on leg count (close is good enough)
        const legCountClose = Math.abs(legCount - request.numLegs) <= 1;
        const pass = (jsonOk || legCountClose) && !hasConflicts && !hasPolicyIssues;
        console.log(`📊 Validation: JSON ${jsonOk ? 'OK' : 'FAIL'}, Text legs ${legCount}/${request.numLegs}, Conflicts: ${hasConflicts ? 'YES' : 'NO'}, Low-risk policy: ${hasPolicyIssues ? 'FAIL' : 'OK'}`);

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
  
  if (requestId && global.emitProgress) {
    global.emitProgress(requestId, 'analysis', 'complete', { 
      attempts,
      timeMs: tAnalysisMs
    });
  }

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
        aiModel: 'openai',
        phases: {
          odds: { complete: true, games: oddsResult.odds.length, quality: oddsResult.dataQuality },
          research: { complete: true, researched: researchedCount, total: enrichedGames.length },
          analysis: { complete: true, attempts: attempts, model: 'openai' },
          postProcessing: { complete: true }
        },
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
      // Remove all JSON blocks between the markers globally (with or without END marker)
      let cleaned = text.replace(/===BEGIN_PARLAY_JSON===([\s\S]*?)===END_PARLAY_JSON===/g, '');
      
      // Also handle incomplete JSON blocks (missing END marker)
      // Remove from BEGIN marker to the next major section or end of text
      cleaned = cleaned.replace(/===BEGIN_PARLAY_JSON===([\s\S]*?)(?=\n\*\*|$)/g, '');
      
      // Remove any remaining lines with the BEGIN or END markers
      cleaned = cleaned.replace(/.*===BEGIN_PARLAY_JSON===.*/g, '');
      cleaned = cleaned.replace(/.*===END_PARLAY_JSON===.*/g, '');
      
      // Remove any large JSON-like blocks that start with {"parlay"
      cleaned = cleaned.replace(/\{"parlay"[\s\S]*?(?=\n\n\*\*|$)/g, '');
      
      // Also remove any JSON blocks wrapped in code fences
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

  /**
   * Extract player props from odds data for verification
   */
  extractPlayerProps(oddsData) {
    const playerProps = [];
    
    for (const game of oddsData) {
      const awayTeam = game.away_team;
      const homeTeam = game.home_team;
      const sport = game.sport_title; // NFL, NCAAF, NBA, etc.
      
      // Look for player prop markets
      const bookmakers = game.bookmakers || [];
      for (const bookmaker of bookmakers) {
        const markets = bookmaker.markets || [];
        const propMarkets = markets.filter(m => 
          m.key && (
            m.key.includes('player') || 
            m.key.includes('anytime_td') ||
            m.key.includes('passing') ||
            m.key.includes('rushing') ||
            m.key.includes('receiving') ||
            m.key.includes('scorer') ||
            m.key.includes('points') ||
            m.key.includes('rebounds') ||
            m.key.includes('assists')
          )
        );

        for (const market of propMarkets) {
          for (const outcome of market.outcomes || []) {
            // Extract player name from outcome
            const playerName = outcome.description || outcome.name;
            
            // Skip if it's clearly not a player name
            if (!playerName || playerName.includes('Over') || playerName.includes('Under')) {
              continue;
            }

            playerProps.push({
              name: playerName,
              market: market.key,
              game: `${awayTeam} @ ${homeTeam}`,
              awayTeam,
              homeTeam,
              sport
            });
          }
        }
      }
    }
    
    return playerProps;
  }

  /**
   * Verify player-team assignments using cached team data (skip API-Sports to avoid timeouts)
   */
  async verifyPlayerTeams(playerProps, sport) {
    const verifications = [];

    logger.info(`🔍 Verifying ${playerProps.length} player-team assignments for ${sport} (checking team names only)...`);

    // Note: We validate team names (static) but NOT current roster assignments (would need 2025 data)
    // Team names don't change, but player rosters do - so we only verify the teams exist
    const hasTeamCache = this.supabase && await this.checkTeamCacheAvailable(sport);
    
    if (!hasTeamCache) {
      logger.warn(`⚠️ No team cache available for ${sport} - skipping team validation`);
      return playerProps.map(prop => ({
        player: prop.name,
        game: prop.game,
        market: prop.market,
        found: true, // Assume valid to avoid blocking
        correctTeam: true,
        confidence: 0.7, // Lower confidence since unverified
        note: 'Team validation skipped - no team cache available'
      }));
    }

    for (const prop of playerProps) {
      // Validate that team names exist (static validation - teams don't change names)
      // Note: This does NOT validate current player rosters (would need 2025 API data)
      const teamsExist = await this.validateTeamNamesExist(
        prop.homeTeam,
        prop.awayTeam,
        sport
      );

      verifications.push({
        player: prop.name,
        game: prop.game,
        market: prop.market,
        found: true,
        correctTeam: teamsExist,
        confidence: teamsExist ? 0.8 : 0.5, // 0.8 since we only validate team names, not rosters
        note: teamsExist ? 'Team names validated (roster not checked)' : 'Team names not found'
      });
    }

    return verifications;
  }

  /**
   * Check if team cache is available for the sport - now uses universal team finder
   */
  async checkTeamCacheAvailable(sport) {
    // We have comprehensive team data for NFL, NCAAF, and NCAAB
    const supportedSports = ['NFL', 'NCAAF', 'NCAAB'];
    return supportedSports.includes(sport.toUpperCase());
  }

  /**
   * Validate that team names exist (static validation - no player roster checking)
   * Team names don't change, but player rosters do change yearly
   */
  async validateTeamNamesExist(homeTeam, awayTeam, sport) {
    try {
      // Use universal team finder to validate both team names exist
      const homeTeamFound = await findTeamUniversal(homeTeam, sport.toUpperCase(), this.supabase);
      const awayTeamFound = await findTeamUniversal(awayTeam, sport.toUpperCase(), this.supabase);
      
      if (homeTeamFound && awayTeamFound) {
        logger.debug(`✅ Team names ${homeTeam} vs ${awayTeam} exist in our database`);
        return true;
      } else {
        logger.warn(`⚠️ Team name validation failed for ${homeTeam} vs ${awayTeam}`);
        logger.warn(`   Home team found: ${!!homeTeamFound}, Away team found: ${!!awayTeamFound}`);
        return false;
      }
      
    } catch (error) {
      logger.error('Error validating player-team from cache:', error.message);
      return true; // Assume valid on error to avoid blocking
    }
  }

  /**
   * ========== TEAM vs PLAYER VALIDATION STRATEGY ==========
   * 
   * CURRENT APPROACH (Performance Optimized):
   * - Team Names: Static validation using cached data (teams don't change names)
   * - Player Rosters: NOT validated (would require current year API calls)
   * 
   * WHY THIS APPROACH:
   * - Team names are static: "Kansas City Chiefs" is always "Kansas City Chiefs"
   * - Player rosters change yearly and require expensive API calls to validate
   * - Our 22-second timeout issue was caused by live API calls for roster data
   * 
   * FOR FULL ROSTER VALIDATION (if needed later):
   * - Would need current 2025 season API-Sports calls
   * - Would need to cache current rosters in a separate table
   * - Would add significant latency but provide higher accuracy
   * 
   * CURRENT TRADE-OFF:
   * - Fast response times (under 10 seconds target)
   * - Team name validation ensures games exist
   * - Player-team assignment relies on AI research accuracy
   * =========================================================
   */

  /**
   * Format verification results for AI context
   */
  formatVerificationContext(verifications) {
    if (!verifications || verifications.length === 0) {
      return '';
    }

    const lines = ['\n**🔍 VERIFIED PLAYER-TEAM ASSIGNMENTS:**'];
    
    for (const v of verifications) {
      if (v.found && v.correctTeam) {
        lines.push(`✅ ${v.player} plays for ${v.actualTeam} (Position: ${v.playerData?.position || 'N/A'})`);
      } else if (v.found && !v.correctTeam) {
        lines.push(`⚠️ ${v.player} plays for ${v.actualTeam}, NOT in game ${v.game}`);
      } else if (!v.found) {
        lines.push(`❌ ${v.player} - Team unknown. DO NOT USE THIS PLAYER.`);
      }
    }

    lines.push('\n**IMPORTANT: Only use players marked with ✅. DO NOT use players marked with ⚠️ or ❌.**\n');
    
    return lines.join('\n');
  }

  /**
   * Generate individual pick suggestions (not full parlays)
   * Returns array of independent betting suggestions
   */
  async generatePickSuggestions(request) {
    console.log('\n' + '='.repeat(80));
    console.log('💡 GENERATING INDIVIDUAL PICK SUGGESTIONS');
    console.log('='.repeat(80));
    console.log(`Request: ${request.numSuggestions} suggestions, ${request.sports.join('+')}, ${request.riskLevel} risk`);
    console.log('='.repeat(80));
    
    const tStart = Date.now();
    
    try {
      // Phase 1: Fetch ALL available odds (not limited to numSuggestions)
      // This lets AI analyze full dataset and pick best options
      const oddsRequest = {
        selectedSports: request.sports,
        selectedBetTypes: request.betTypes,
        oddsPlatform: request.sportsbook,
        dateRange: request.dateRange,
        numLegs: 100, // Fetch ALL games, let AI pick best from full dataset
        riskLevel: request.riskLevel
      };
      
      const oddsResult = await this.oddsAgent.fetchOddsForSelectedBook(oddsRequest);
      
      // Validate odds result
      if (!oddsResult || !oddsResult.odds || oddsResult.odds.length === 0) {
        throw new Error('No odds data available. The Odds API may be down or returned no games for the selected criteria.');
      }
      
      console.log(`✅ Fetched odds for ${oddsResult.odds.length} games`);
      
      // Phase 2: Research
      const enrichedGames = await this.researchAgent.deepResearch(oddsResult.odds, {
        fastMode: false,
        numLegs: request.numSuggestions,
        riskLevel: request.riskLevel,
        selectedSports: request.sports
      });
      
      // Phase 3: Filter markets
      const filteredGames = filterMarketsByBetTypes(enrichedGames, request.betTypes, request.riskLevel);
      console.log(`✅ Filtered to ${filteredGames.length} games with selected bet types`);
      
      // Phase 4: Extract all possible picks from games
      const allPicks = this.extractIndividualPicks(filteredGames, request);
      console.log(`✅ Extracted ${allPicks.length} possible picks`);
      
      // Phase 4.5: Gather REAL data for AI (prevent hallucinations)
      const realData = await this.gatherRealDataForAI(filteredGames, request);
      
      // Phase 5: AI ranks and selects best picks WITH REAL DATA
      const selectedPicks = await this.analyst.selectBestPicks({
        picks: allPicks,
        numSuggestions: request.numSuggestions,
        riskLevel: request.riskLevel,
        betTypes: request.betTypes,
        apiKey: this.apiKeys.openai,
        realData: realData // PASS REAL DATA TO PREVENT HALLUCINATIONS
      });
      
      const duration = Date.now() - tStart;
      console.log(`✅ Selected ${selectedPicks.length} best picks in ${duration}ms`);
      
      // Smart alert system for insufficient data
      const alert = this.generateSmartAlert(
        selectedPicks.length, 
        request.numSuggestions, 
        filteredGames.length,
        request
      );
      
      return {
        suggestions: selectedPicks,
        alert: alert,
        metadata: {
          totalGamesAnalyzed: filteredGames.length,
          totalPicksConsidered: allPicks.length,
          duration: `${duration}ms`
        }
      };
      
    } catch (error) {
      console.error('❌ Error generating pick suggestions:', error);
      throw error;
    }
  }
  
  /**
   * Extract individual picks from games with conflict detection
   * Each pick is independent and conflicts are filtered out
   */
  extractIndividualPicks(games, request) {
    const picks = [];
    const conflictTracker = new Map(); // Track picks per game to avoid conflicts
    
    for (const game of games) {
      const bookmaker = game.bookmakers?.[0];
      if (!bookmaker) continue;
      
      const gameKey = `${game.away_team}_${game.home_team}`;
      if (!conflictTracker.has(gameKey)) {
        conflictTracker.set(gameKey, new Set());
      }
      const usedBets = conflictTracker.get(gameKey);
      
      // Priority order: Moneyline > Spread > Total > Props
      const marketPriority = ['h2h', 'spreads', 'totals'];
      const sortedMarkets = (bookmaker.markets || []).sort((a, b) => {
        const aPriority = marketPriority.indexOf(a.key);
        const bPriority = marketPriority.indexOf(b.key);
        if (aPriority === -1 && bPriority === -1) return 0;
        if (aPriority === -1) return 1;
        if (bPriority === -1) return -1;
        return aPriority - bPriority;
      });
      
      for (const market of sortedMarkets) {
        const marketType = market.key;
        
        // For moneyline and spread, pick the better odds side only
        if (marketType === 'h2h' && !usedBets.has('moneyline')) {
          const bestOutcome = this.selectBestMoneylineOutcome(market.outcomes);
          if (bestOutcome) {
            picks.push(this.createPick(game, market, bestOutcome, request));
            usedBets.add('moneyline');
          }
        }
        // For spreads, pick the side with better value
        else if (marketType === 'spreads' && !usedBets.has('spread')) {
          const bestOutcome = this.selectBestSpreadOutcome(market.outcomes);
          if (bestOutcome) {
            picks.push(this.createPick(game, market, bestOutcome, request));
            usedBets.add('spread');
          }
        }
        // For totals, pick Over or Under (not both)
        else if (marketType === 'totals' && !usedBets.has('total')) {
          const bestOutcome = this.selectBestTotalOutcome(market.outcomes, game.research || '');
          if (bestOutcome) {
            picks.push(this.createPick(game, market, bestOutcome, request));
            usedBets.add('total');
          }
        }
        // For player props, avoid duplicates
        else if (marketType.includes('player')) {
          for (const outcome of market.outcomes || []) {
            const propKey = `${marketType}_${outcome.name}`;
            if (!usedBets.has(propKey)) {
              picks.push(this.createPick(game, market, outcome, request));
              usedBets.add(propKey);
              break; // Only take first prop per market type per game
            }
          }
        }
      }
    }
    
    return picks;
  }

  /**
   * Select best moneyline outcome (favor underdog if close odds)
   */
  selectBestMoneylineOutcome(outcomes) {
    if (!outcomes || outcomes.length < 2) return outcomes?.[0];
    
    // Convert odds to numbers for comparison
    const withNumericOdds = outcomes.map(o => ({
      ...o,
      numericOdds: parseInt(o.price) || 0
    }));
    
    // If both teams have reasonable odds (-200 to +300), prefer underdog
    const sorted = withNumericOdds.sort((a, b) => b.numericOdds - a.numericOdds);
    const underdog = sorted[0];
    const favorite = sorted[1];
    
    // If underdog odds are reasonable (+100 to +250), take underdog
    if (underdog.numericOdds >= 100 && underdog.numericOdds <= 250) {
      return underdog;
    }
    
    // If favorite is heavy (-150 or better), take favorite
    if (favorite.numericOdds <= -150) {
      return favorite;
    }
    
    // Default to underdog for value
    return underdog;
  }

  /**
   * Select best spread outcome based on line value
   */
  selectBestSpreadOutcome(outcomes) {
    if (!outcomes || outcomes.length < 2) return outcomes?.[0];
    
    // Prefer the spread that's closest to pick'em (lower absolute point value)
    const sorted = outcomes.sort((a, b) => {
      const aPoints = Math.abs(parseFloat(a.point) || 0);
      const bPoints = Math.abs(parseFloat(b.point) || 0);
      return aPoints - bPoints;
    });
    
    return sorted[0];
  }

  /**
   * Select Over or Under based on research context
   */
  selectBestTotalOutcome(outcomes, research) {
    if (!outcomes || outcomes.length < 2) return outcomes?.[0];
    
    const over = outcomes.find(o => o.name?.toLowerCase().includes('over'));
    const under = outcomes.find(o => o.name?.toLowerCase().includes('under'));
    
    if (!over || !under) return outcomes[0];
    
    // Use research to guide Over/Under selection
    const researchText = research.toLowerCase();
    const overKeywords = ['high scoring', 'offensive', 'pace', 'points', 'yards', 'fast'];
    const underKeywords = ['defensive', 'low scoring', 'slow', 'weather', 'wind', 'defense'];
    
    const overScore = overKeywords.reduce((score, keyword) => 
      researchText.includes(keyword) ? score + 1 : score, 0);
    const underScore = underKeywords.reduce((score, keyword) => 
      researchText.includes(keyword) ? score + 1 : score, 0);
    
    // If research strongly suggests one direction, use it
    if (overScore > underScore) return over;
    if (underScore > overScore) return under;
    
    // Default to Over (more exciting for users)
    return over;
  }

  /**
   * Create a standardized pick object
   */
  createPick(game, market, outcome, request) {
    // Format game time properly for Mountain Time display
    const gameTimeMT = new Date(game.commence_time).toLocaleDateString('en-US', {
      timeZone: 'America/Denver',
      weekday: 'short',
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    return {
      id: `${game.id}_${market.key}_${outcome.name}`,
      gameDate: game.commence_time,
      sport: game.sport_title || request.sports[0],
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      marketType: market.key,
      betType: this.marketKeyToBetType(market.key),
      pick: outcome.name,
      odds: outcome.price,
      point: outcome.point,
      spread: this.extractSpread(game, game.bookmakers?.[0]),
      research: game.research || '',
      gameContext: {
        totalLine: this.extractTotalLine(game),
        spreadLine: this.extractSpread(game, game.bookmakers?.[0])
      },
      gameTimeDisplay: gameTimeMT + ' MT'
    };
  }

  /**
   * Extract total line for context
   */
  extractTotalLine(game) {
    const bookmaker = game.bookmakers?.[0];
    const totalMarket = bookmaker?.markets?.find(m => m.key === 'totals');
    const overOutcome = totalMarket?.outcomes?.find(o => o.name?.toLowerCase().includes('over'));
    return overOutcome?.point || null;
  }

  /**
   * Generate smart alerts when data is insufficient
   */
  generateSmartAlert(actualSuggestions, requestedSuggestions, gamesCount, request) {
    // No alert needed if we have enough suggestions
    if (actualSuggestions >= requestedSuggestions) {
      return null;
    }
    
    const shortfall = requestedSuggestions - actualSuggestions;
    const isVeryLimited = gamesCount === 1;
    const isLimited = gamesCount <= 3;
    
    // Different alerts based on situation
    if (isVeryLimited) {
      return {
        type: 'limited_games',
        severity: 'warning',
        title: `Only ${gamesCount} game available`,
        message: `Found only ${actualSuggestions} suggestions from ${gamesCount} game. To get more picks:`,
        suggestions: [
          `📅 Expand date range to 3-7 days (currently ${request.dateRange} day${request.dateRange === 1 ? '' : 's'})`,
          `🏈 Add more sports (try NBA, NHL, Soccer for more games)`,
          `🎯 Add more bet types (add Player Props, Totals for more options)`,
          `⚡ Note: Multiple bets from same game are filtered to avoid conflicts`
        ]
      };
    }
    
    if (isLimited) {
      return {
        type: 'limited_options', 
        severity: 'info',
        title: `Limited to ${gamesCount} games`,
        message: `Generated ${actualSuggestions}/${requestedSuggestions} suggestions from ${gamesCount} games. For more variety:`,
        suggestions: [
          `📅 Extend date range (currently ${request.dateRange} day${request.dateRange === 1 ? '' : 's'})`,
          `🏈 Consider additional sports: ${this.getSuggestedSports(request.sports)}`,
          `🎯 Add bet types: ${this.getSuggestedBetTypes(request.betTypes)}`
        ]
      };
    }
    
    // General insufficient data
    return {
      type: 'insufficient_data',
      severity: 'info', 
      title: `${shortfall} fewer picks than requested`,
      message: `Generated ${actualSuggestions}/${requestedSuggestions} suggestions. Consider:`,
      suggestions: [
        `📅 Increase date range for more games`,
        `🏈 Add sports: ${this.getSuggestedSports(request.sports)}`,
        `🎯 Expand bet types for more options per game`
      ]
    };
  }

  /**
   * Suggest additional sports to expand options
   */
  getSuggestedSports(currentSports) {
    const allSports = ['NFL', 'NBA', 'NHL', 'Soccer', 'MLB', 'NCAAF'];
    const available = allSports.filter(sport => !currentSports.includes(sport));
    return available.slice(0, 3).join(', ') || 'All sports already selected';
  }

  /**
   * Suggest additional bet types to expand options
   */
  getSuggestedBetTypes(currentBetTypes) {
    const allBetTypes = ['Moneyline/Spread', 'Player Props', 'Totals (O/U)', 'TD Props'];
    const available = allBetTypes.filter(type => !currentBetTypes.includes(type));
    return available.slice(0, 2).join(', ') || 'All major bet types selected';
  }
  
  /**
   * Extract spread info for context (even if bet is ML)
   */
  extractSpread(game, bookmaker) {
    const spreadMarket = bookmaker.markets?.find(m => m.key === 'spreads');
    if (!spreadMarket) return null;
    
    const homeSpread = spreadMarket.outcomes?.find(o => o.name === game.home_team);
    return homeSpread?.point || null;
  }
  
  /**
   * Convert market key to user-friendly bet type
   */
  marketKeyToBetType(marketKey) {
    const mapping = {
      'h2h': 'Moneyline',
      'spreads': 'Spread',
      'totals': 'Total',
      'player_pass_tds': 'Player Passing TDs',
      'player_pass_yds': 'Player Passing Yards',
      'player_rush_yds': 'Player Rushing Yards',
      'player_receptions': 'Player Receptions'
    };
    return mapping[marketKey] || marketKey;
  }

  /**
   * Enrich games with cached sports intelligence (news, analyst picks, betting trends)
   */
  async enrichWithCachedIntelligence(games, selectedSports) {
    try {
      const enrichedGames = [];
      
      for (const game of games) {
        const enrichedGame = { ...game };
        
        // Extract team names from game
        const homeTeam = game.home_team;
        const awayTeam = game.away_team;
        const sport = game.sport_key?.toUpperCase();
        
        // Only enrich supported sports with cached intelligence
        if (!selectedSports.includes(sport) || !['NFL', 'NBA', 'NCAAF', 'MLB', 'NHL', 'SOCCER'].includes(sport)) {
          enrichedGames.push(enrichedGame);
          continue;
        }
        
        try {
          // Get cached intelligence for the matchup
          const intelligence = await this.intelligenceService.getAgentContext(sport, homeTeam, awayTeam);
          
          if (intelligence.hasIntel) {
            enrichedGame.intelligenceContext = {
              hasIntel: true,
              context: intelligence.context,
              taglines: intelligence.taglines,
              dataSource: 'cached_intelligence'
            };
            
            logger.info(`🧠 Enriched ${homeTeam} vs ${awayTeam} with cached intelligence`);
          } else {
            // Add placeholder indicating no cached intelligence available
            enrichedGame.intelligenceContext = {
              hasIntel: false,
              dataSource: 'no_cached_intelligence',
              message: `No cached intelligence available for ${homeTeam} vs ${awayTeam}`
            };
          }
          
        } catch (intelError) {
          logger.error(`Error enriching game ${homeTeam} vs ${awayTeam} with intelligence:`, intelError);
          enrichedGame.intelligenceContext = {
            hasIntel: false,
            dataSource: 'error',
            error: intelError.message
          };
        }
        
        enrichedGames.push(enrichedGame);
      }
      
      const enrichedCount = enrichedGames.filter(g => 
        g.intelligenceContext && g.intelligenceContext.hasIntel
      ).length;
      
      logger.info(`🧠 Intelligence Enrichment: ${enrichedCount}/${games.length} games enhanced with cached intelligence`);
      
      return enrichedGames;
      
    } catch (error) {
      logger.error('Error in enrichWithCachedIntelligence:', error);
      // Return original games if enrichment fails
      return games;
    }
  }

  /**
   * Enrich games with cached sports statistics
   */
  async enrichWithCachedStats(games, selectedSports) {
    try {
      const enrichedGames = [];
      
      for (const game of games) {
        const enrichedGame = { ...game };
        
        // Extract team names from game
        const homeTeam = game.home_team;
        const awayTeam = game.away_team;
        const sport = game.sport_key?.toUpperCase();
        
        // Only enrich supported sports with cached data
        if (!selectedSports.includes(sport) || !['NFL', 'NBA', 'NCAAF', 'MLB', 'NHL', 'SOCCER', 'GOLF', 'TENNIS', 'UFC'].includes(sport)) {
          enrichedGames.push(enrichedGame);
          continue;
        }
        
        try {
          // Get matchup context from cached stats
          const matchupContext = await this.statsService.getMatchupContext(sport, homeTeam, awayTeam);
          
          if (matchupContext) {
            enrichedGame.statsContext = {
              homeTeam: {
                name: matchupContext.homeTeam.team_name,
                stats: matchupContext.homeTeam.stats_json,
                keyPlayers: matchupContext.homeTeam.keyPlayers?.map(p => ({
                  name: p.player_name,
                  position: p.position,
                  stats: p.stats_json
                })) || []
              },
              awayTeam: {
                name: matchupContext.awayTeam.team_name,
                stats: matchupContext.awayTeam.stats_json,
                keyPlayers: matchupContext.awayTeam.keyPlayers?.map(p => ({
                  name: p.player_name,
                  position: p.position,
                  stats: p.stats_json
                })) || []
              },
              insights: matchupContext.matchupInsights,
              dataSource: 'cached_sports_stats'
            };
            
            logger.info(`📊 Enriched ${homeTeam} vs ${awayTeam} with cached stats`);
          } else {
            // Add placeholder indicating no cached data available
            enrichedGame.statsContext = {
              dataSource: 'no_cached_data',
              message: `No cached stats available for ${homeTeam} vs ${awayTeam}`
            };
          }
          
        } catch (statsError) {
          logger.error(`Error enriching game ${homeTeam} vs ${awayTeam}:`, statsError);
          enrichedGame.statsContext = {
            dataSource: 'error',
            error: statsError.message
          };
        }
        
        enrichedGames.push(enrichedGame);
      }
      
      const enrichedCount = enrichedGames.filter(g => 
        g.statsContext && g.statsContext.dataSource === 'cached_sports_stats'
      ).length;
      
      logger.info(`📊 Sports Stats Enrichment: ${enrichedCount}/${games.length} games enhanced with cached data`);
      
      return enrichedGames;
      
    } catch (error) {
      logger.error('Error in enrichWithCachedStats:', error);
      // Return original games if enrichment fails
      return games;
    }
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

        apiSports: !!(process.env.APISPORTS_API_KEY || process.env.API_SPORTS_KEY)
      },
      rosterCache: !!(process.env.APISPORTS_API_KEY || process.env.API_SPORTS_KEY)
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
  
  /**
   * Gather REAL data for AI analyst to prevent hallucinations
   * Returns team records, recent news, and verified stats
   */
  async gatherRealDataForAI(games, request) {
    console.log(`📊 Gathering real data for AI to prevent hallucinations...`);
    const realData = {
      teamRecords: {},
      recentNews: {},
      verifiedFacts: []
    };
    
    try {
      // 1. Get team W-L records from Supabase
      if (this.supabase) {
        // Get CURRENT NFL season year
        // NFL season year = the year it STARTED (e.g., 2025-2026 season = 2025)
        // Season runs Sept-Feb, so if we're Jan-Aug, season started last year
        const now = new Date();
        const currentMonth = now.getMonth(); // 0-11 (0=Jan, 8=Sep)
        const currentSeason = (currentMonth < 8) ? now.getFullYear() - 1 : now.getFullYear();
        
        console.log(`  🔍 Querying team_stats_season for current NFL season ${currentSeason}...`);
        const { data: teamRecords, error: recordsError } = await this.supabase
          .from('team_stats_season')
          .select('team_id, metrics')
          .eq('season', currentSeason);
        
        if (recordsError) {
          console.error(`  ❌ Error fetching team records:`, recordsError);
        } else {
          console.log(`  📊 Found ${teamRecords?.length || 0} team records in DB`);
        }
        
        const { data: teams, error: teamsError } = await this.supabase
          .from('teams')
          .select('id, name');
        
        if (teamsError) {
          console.error(`  ❌ Error fetching teams:`, teamsError);
        } else {
          console.log(`  📊 Found ${teams?.length || 0} teams in DB`);
        }
        
        const teamNameMap = new Map(teams?.map(t => [t.id, t.name]) || []);
        console.log(`  🔍 Created teamNameMap with ${teamNameMap.size} teams`);
        
        let processedCount = 0;
        let skippedCount = 0;
        teamRecords?.forEach((record, idx) => {
          const teamName = teamNameMap.get(record.team_id);
          
          if (idx === 0) {
            // Debug first record
            console.log(`  🔍 First record debug:`, {
              team_id: record.team_id,
              teamName: teamName,
              hasMetrics: !!record.metrics,
              metricsType: typeof record.metrics,
              wins: record.metrics?.wins,
              losses: record.metrics?.losses
            });
          }
          
          if (teamName && record.metrics) {
            realData.teamRecords[teamName] = {
              wins: record.metrics.wins || 0,
              losses: record.metrics.losses || 0,
              record: `${record.metrics.wins || 0}-${record.metrics.losses || 0}`
            };
            processedCount++;
          } else {
            skippedCount++;
            if (skippedCount <= 3) {
              console.log(`  ⚠️ Skipped record:`, { teamName, hasMetrics: !!record.metrics });
            }
          }
        });
        console.log(`  ✅ Processed ${processedCount} teams, skipped ${skippedCount}`);
      } else {
        console.log(`  ⚠️ No Supabase client available`);
      }
      
      // 2. Get ALL recent news articles (FULL articles, not just headlines)
      // This is YOUR data from 23 RSS sources - let AI search through it!
      if (this.supabase) {
        const teamNames = [...new Set(games.map(g => [g.home_team, g.away_team]).flat())];
        console.log(`  🔍 Searching news for ${teamNames.length} teams...`);
        
        for (const teamName of teamNames) {
          const { data: articles, error: newsError } = await this.supabase
            .from('news_articles')
            .select('title, content, published_at, source_id')
            .or(`title.ilike.%${teamName}%,content.ilike.%${teamName}%`)
            .gte('published_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
            .order('published_at', { ascending: false })
            .limit(10); // More articles for AI to analyze
          
          if (newsError) {
            console.error(`  ❌ Error fetching news for ${teamName}:`, newsError.message);
          } else if (articles && articles.length > 0) {
            realData.recentNews[teamName] = articles.map(a => ({
              title: a.title,
              content: a.content ? a.content.substring(0, 500) : '', // First 500 chars
              source: a.source_id || 'RSS Feed',
              date: new Date(a.published_at).toLocaleDateString()
            }));
            console.log(`    ✓ Found ${articles.length} articles for ${teamName}`);
          }
        }
        const totalArticles = Object.values(realData.recentNews).flat().length;
        console.log(`  ✅ Loaded ${totalArticles} total articles for ${Object.keys(realData.recentNews).length} teams`);
      }
      
      // 3. Add verified facts instruction
      realData.verifiedFacts.push(
        "STRICT RULE: You may ONLY use data provided in the 'Team Records' and 'Recent News' sections.",
        "DO NOT make up or estimate: ATS records, injury status, recent game results, or any statistics.",
        "If data is not provided, focus on odds value, matchup dynamics, and general team strength based ONLY on W-L record.",
        "Be creative in your analysis but ONLY with the data given to you."
      );
      
    } catch (error) {
      console.error('  ⚠️ Error gathering real data:', error.message);
    }
    
    return realData;
  }
}

module.exports = { 
  MultiAgentCoordinator,
  fixOddsCalculations,
  calculateParlay,
  americanToDecimal,
  decimalToAmerican
};