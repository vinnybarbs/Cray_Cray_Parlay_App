// Parlay Analyst Agent - Generates optimal parlays with enhanced data
class ParlayAnalyst {
  constructor() {
    this.conflictRules = [
      'NO same team moneyline + spread',
      'NO opposing teams same game same market',
      'NO over/under same game same total',
      'NO same player over/under same prop'
    ];
  }

  generateAIPrompt({ selectedSports, selectedBetTypes, numLegs, riskLevel, oddsData, unavailableInfo, dateRange, aiModel = 'openai', attemptNumber = 1, fastMode = false, retryIssues = '' }) {
    const sportsStr = selectedSports.join(', ');
    const betTypesStr = selectedBetTypes.join(', ');
    const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    const dateRangeText = `${dateRange || 1} day(s)`;

    const formatDate = (iso) => {
      if (!iso) return 'TBD';
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
    };

    let oddsContext = '';
  if (oddsData && oddsData.length > 0) {
    const maxItems = Math.min(Math.max(numLegs * 2, 6), fastMode ? 8 : 20);
    const items = oddsData.slice(0, maxItems).map((ev, idx) => {
        const gameDate = formatDate(ev.commence_time);
        const teams = `${ev.away_team || '?'} @ ${ev.home_team || '?'}`;
        const bm = (ev.bookmakers && ev.bookmakers[0]) || null;
        
        let marketsSummary = 'no-odds';
        if (bm && bm.markets && bm.markets.length > 0) {
          const mkts = fastMode ? bm.markets.filter(m => ['h2h','spreads','totals'].includes(m.key)) : bm.markets;
          marketsSummary = mkts.map(market => {
            const outcomes = market.outcomes || [];
            if (market.key === 'h2h') {
              return `ML: ${outcomes.map(o => `${o.name} ${o.price > 0 ? '+' : ''}${o.price}`).join(', ')}`;
            } else if (market.key === 'spreads') {
              return `Spread: ${outcomes.map(o => `${o.name} ${o.point > 0 ? '+' : ''}${o.point} (${o.price > 0 ? '+' : ''}${o.price})`).join(', ')}`;
            } else if (market.key === 'totals') {
              return `Total: ${outcomes.map(o => `${o.name} ${o.point} (${o.price > 0 ? '+' : ''}${o.price})`).join(', ')}`;
            } else {
              return `${market.key}: ${outcomes.length} options`;
            }
          }).join(' | ');
        }

        // Add research context if available
        const researchNote = ev.research ? `\n   📰 RESEARCH: ${ev.research}` : '';

        return `${idx + 1}. DATE: ${gameDate} - ${teams}\n   ${marketsSummary}${researchNote}`;
      });

      oddsContext = `\n\n🔥 AVAILABLE GAMES & ODDS 🔥\n${items.join('\n\n')}`;
      // Add research block with sources when available
      try {
        const { EnhancedResearchAgent } = require('./research-agent');
        // Safe formatting if oddsData objects came from research-agent
        const ra = new EnhancedResearchAgent(null, null);
        const researchBlock = ra.formatResearchForAI(oddsData);
        if (researchBlock && researchBlock.trim().length > 0) {
          oddsContext += `\n\n🔎 DATA-DRIVEN RESEARCH (with sources)\n${researchBlock}`;
        }
      } catch { /* no-op */ }
    } else {
      oddsContext = '\n\n⚠️ NO LIVE ODDS DATA AVAILABLE';
    }

    let marketAvailabilityNote = '';
    if (unavailableInfo && unavailableInfo.length > 0) {
      marketAvailabilityNote = `\n\n⚠️ LIMITED MARKETS: ${unavailableInfo.join(', ')} may have limited options.`;
    }

    if (aiModel === 'gemini') {
      return this.generateGeminiPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, today, dateRangeText, marketAvailabilityNote, oddsContext, attemptNumber, retryIssues });
    } else {
      return this.generateOpenAIPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, today, dateRangeText, marketAvailabilityNote, oddsContext, attemptNumber, retryIssues });
    }
  }

  generateOpenAIPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, today, dateRangeText, marketAvailabilityNote, oddsContext, attemptNumber, retryIssues = '' }) {
    // Define risk level constraints
    const riskConstraints = {
      'Low': { minConfidence: 8, maxConfidence: 9, description: 'Heavy favorites, low payout individual bets' },
      'Medium': { minConfidence: 6, maxConfidence: 9, description: 'Balanced risk/reward' },
      'High': { minConfidence: 3, maxConfidence: 9, description: 'Higher risk, higher potential payout' }
    };
    
    const currentRisk = riskConstraints[riskLevel] || riskConstraints['Medium'];
    
    const retryWarning = attemptNumber > 1 ? 
      `\n🚨🚨🚨 RETRY ATTEMPT ${attemptNumber}: Fix prior issues. Ensure EXACTLY ${numLegs} legs and resolve conflicts. ${retryIssues ? '\n' + retryIssues + '\n' : ''}🚨🚨🚨\n` : 
      '';
    
    return `${retryWarning}
You are a sharp sports bettor and data analyst. Create a ${numLegs}-leg parlay using research insights and odds analysis.

🚨🚨🚨 CRITICAL: You MUST create EXACTLY ${numLegs} legs. COUNT EACH LEG BEFORE SUBMITTING! 🚨🚨🚨

YOUR ROLE: Select ${numLegs} best bets from the pre-vetted options below. All individual options are pre-approved, but you must avoid conflicts when combining them.

SELECTION CRITERIA:
- Sports: ${sportsStr} 
- Bet Types: ${betTypesStr} (all options below match these criteria)
- REQUIRED LEGS: ${numLegs} (YOU MUST SELECT EXACTLY ${numLegs} LEGS)
- Risk Level: ${riskLevel} (confidence ${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10)

🎯 SELECTION STRATEGY:
✅ SELECT ${numLegs} bets from any combination of available games/markets below
✅ Same-game parlays are FULLY SUPPORTED - select multiple different bets from same game 
✅ Multi-game parlays are FULLY SUPPORTED - select from different games
✅ ALL OPTIONS BELOW ARE PRE-APPROVED - but avoid conflicts when combining

🎯 PARLAY WIN STRATEGY (ALL LEGS MUST HIT):
⚠️ CRITICAL: Parlays are ALL-OR-NOTHING - no partial payouts, no brownie points for close calls
✅ Priority #1: SELECT BETS WITH HIGHEST WIN PROBABILITY
✅ Better to win with lower odds than lose with flashy odds
✅ Every single leg must hit for ANY payout

📊 RISK-APPROPRIATE SELECTION:
🟢 LOW RISK: Heavy favorites, safe bets, conservative lines (${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10 confidence)
� MEDIUM RISK: Balanced selections, reasonable favorites (${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10 confidence)  
🔴 HIGH RISK: Higher variance acceptable, but still focus on win probability (${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10 confidence)

�🚫 CONFLICT PREVENTION (critical when combining pre-approved options):
❌ FORBIDDEN: Eagles moneyline + Eagles spread (redundant - same team outcome)
❌ FORBIDDEN: Eagles -7 + Giants +7 (opposing sides same spread)  
❌ FORBIDDEN: Over 47.5 + Under 47.5 (opposing sides same total)
❌ FORBIDDEN: Hurts Over 250 yards + Hurts Under 250 yards (opposing same prop)
❌ FORBIDDEN: Same exact bet twice (Eagles -7 + Eagles -7)

✅ SMART COMBINATIONS (pre-approved options that work together):
✅ Eagles -7 + Over 47.5 + Hurts 250+ yards (different bet types, same game)
✅ Eagles moneyline + Hurts 2+ TDs + Brown anytime TD (different markets)
✅ Over 47.5 + Eagles team total Over 24.5 (game total + team total)
✅ Multiple players: Hurts yards + Saquon yards + Brown yards + Smith yards

🔢 LEG COUNT VALIDATION: Before submitting, manually count each numbered leg (1., 2., 3., etc.) and verify you have EXACTLY ${numLegs} legs!

SMART SAME GAME COMBINATIONS:
✅ Team spread + game total + multiple player props
✅ Moneyline + team total + player TDs + receiving yards
✅ Different players: QB passing + RB rushing + WR receiving + TE anytime TD
✅ Mix bet types: spread + total + props + first scorer + team props

CRITICAL ANALYSIS REQUIREMENTS (PARLAY WIN FOCUS):
1. USE PROVIDED RESEARCH DATA - Reference specific injuries, trends, recent form
2. PRIORITIZE WIN PROBABILITY - Focus on likelihood of hitting, not flashy odds
3. CITE SPECIFIC INSIGHTS - Mention player status, team struggles, matchup advantages  
4. EXPLAIN CONFIDENCE LEVELS - Why this bet is likely to HIT (not just good value)
5. CONNECT RESEARCH TO WIN PROBABILITY - How data supports this leg hitting
6. RISK-APPROPRIATE SELECTIONS - Conservative for low risk, balanced for medium, strategic for high

BEFORE SUBMITTING YOUR RESPONSE:
□ Do I have EXACTLY ${numLegs} numbered legs (1., 2., 3., etc.)?
□ Did I count each leg manually to verify ${numLegs} total?
□ Did I check for conflicts between my selected bets?
□ No opposing sides of same market (Eagles -7 + Giants +7)?
□ No redundant bets (Eagles ML + Eagles spread)?
□ Did I prioritize WIN PROBABILITY over flashy odds?
□ Are my selections appropriate for ${riskLevel} risk tolerance?
□ Did I reference specific research for each leg?
□ Are confidence levels ${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10?
□ Is every leg likely to HIT (remember: ALL-OR-NOTHING)?

⚠️ CRITICAL: If you have only 1-2 games available but need ${numLegs} legs, you MUST use same-game parlay strategy with multiple different bet types from the same game(s)!

${marketAvailabilityNote}

${oddsContext}

REQUIRED FORMAT:

**🎯 ${numLegs}-Leg Parlay: [Data-Driven Title]**

**Legs:**
1. 📅 DATE: [MM/DD/YYYY from data]
   Game: [Away] @ [Home]
   Bet: [Specific bet with line]
   Odds: [Exact odds from data]
   Confidence: [${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10]
   Reasoning: [Reference specific research, explain WHY this will HIT and win probability based on data]

[Continue for ALL ${numLegs} legs - multiple bets from same game are encouraged]

**Combined Odds:** [CALCULATED]
**Payout on $100:** $[CALCULATED]
**Overall Confidence:** [Average]/10

**Research Summary:** [Key insights that influenced your picks]

---

**🔒 BONUS LOCK PARLAY: Conservative Data Plays**

[2-3 highest confidence picks with strongest research support]

**Why These Are Locks:** [Data-backed explanation citing specific research]
- Medium Risk: Balanced picks with moderate confidence
- High Risk: Higher variance picks with bigger potential payouts

SAME GAME PARLAY RULES (when only 1 game available):
✅ ALLOWED: Eagles -7 + Over 45.5 + Player Over Yards (different bet types)
✅ ALLOWED: Team ML + Team Total Over + Player TD prop (different markets)
❌ FORBIDDEN: Eagles -7 + Giants +7 (opposite sides same market)
❌ FORBIDDEN: Over 45.5 + Under 45.5 (opposite sides same total)

MULTI-GAME PARLAY RULES (when multiple games available):
✅ ALLOWED: Eagles -7 (Game 1) + Cowboys ML (Game 2) + Bills Over (Game 3)
❌ FORBIDDEN: Any two bets from same game

DATE EXTRACTION:
- Extract the actual game date from the commence_time in the data
- Convert to MM/DD/YYYY format
- DO NOT use today's date (${today}) unless it matches the game date

STRICT DATA USAGE:
- Use ONLY the teams, odds, and dates provided below
- Use ONLY the exact odds shown (no approximations)
- Use ONLY available markets shown in the data

${marketAvailabilityNote}

${oddsContext}

BEFORE CREATING LEGS:
1. Count available unique games
2. If only 1 game: Create Same Game Parlay with different bet types
3. If multiple games: Use different games for each leg
4. Verify confidence levels match ${riskLevel} risk (${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10)

OUTPUT FORMAT:

**🎯 [X]-Leg Parlay: [Title]**
[If Same Game Parlay, mention it in title]

**Legs:**
1. 📅 DATE: [EXACT DATE FROM DATA]
   Game: [EXACT TEAMS FROM DATA]
   Bet: [EXACT BET WITH LINE FROM DATA]
   Odds: [EXACT ODDS FROM DATA]
   Confidence: [${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10 for ${riskLevel} risk]
   Reasoning: [Reference research data, explain confidence level]

[Continue for each bet - different games OR different bet types from same game]

**Combined Odds:** [WILL BE CALCULATED AUTOMATICALLY]
**Payout on $100:** $[WILL BE CALCULATED AUTOMATICALLY]
**Overall Confidence:** [Average]/10

**Strategy Note:** [Explain if Same Game Parlay or Multi-Game approach]

---

**🔒 BONUS LOCK PARLAY: [Conservative Title]**

[Same format, highest confidence picks]

CRITICAL: Use the data exactly as provided. Same Game Parlays are valid when only one game available.

🔢 FINAL LEG COUNT CHECK: Before submitting, count your legs: 1., 2., 3., 4., 5., 6., 7., 8... Must equal EXACTLY ${numLegs}!

MACHINE-READABLE BLOCK (REQUIRED):
Provide a strict JSON object between the markers below. Use EXACTLY American odds strings like "+105" or "-120" (use "+100" for EV/EVEN/PK). Ensure legs length is EXACTLY ${numLegs}.

===BEGIN_PARLAY_JSON===
{
  "parlay": {
    "title": "[Title]",
    "legs": [
      {
        "date": "MM/DD/YYYY",
        "game": "Away @ Home",
        "bet": "[Specific bet with line]",
        "odds": "+100",
        "confidence": 8,
        "citations": [1,2]
      }
      // ... repeat until exactly ${numLegs} legs
    ]
  },
  "lockParlay": {
    "legs": [
      // 2 legs, optional if not applicable
    ]
  }
}
===END_PARLAY_JSON===
`.trim();
  }

  generateGeminiPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, today, dateRangeText, marketAvailabilityNote, oddsContext, attemptNumber, retryIssues = '' }) {
    // Define risk level constraints
    const riskConstraints = {
      'Low': { minConfidence: 8, maxConfidence: 9, description: 'Heavy favorites, low payout individual bets' },
      'Medium': { minConfidence: 6, maxConfidence: 9, description: 'Balanced risk/reward' },
      'High': { minConfidence: 3, maxConfidence: 9, description: 'Higher risk, higher potential payout' }
    };
    
    const currentRisk = riskConstraints[riskLevel] || riskConstraints['Medium'];
    
    const retryWarning = attemptNumber > 1 ? 
      `\n🚨🚨🚨 RETRY ATTEMPT ${attemptNumber}: Previous attempt failed to create exactly ${numLegs} legs! This is CRITICAL - you MUST count each leg and ensure EXACTLY ${numLegs} numbered legs! ${retryIssues ? '\n' + retryIssues + '\n' : ''}🚨🚨🚨\n` : 
      '';
    
    return `${retryWarning}
You are a professional sports betting analyst with access to real-time research data.

🚨🚨🚨 CRITICAL: CREATE EXACTLY ${numLegs} LEGS. COUNT EACH LEG BEFORE SUBMITTING! 🚨🚨🚨

YOUR ROLE: Select ${numLegs} best bets from the pre-vetted options below. All individual options are pre-approved, but you must avoid conflicts when combining them.

SELECTION CRITERIA:
- Sports: ${sportsStr}
- Bet Types: ${betTypesStr} (all options below are pre-approved)
- REQUIRED LEGS: ${numLegs} (YOU MUST SELECT EXACTLY ${numLegs} LEGS)
- Risk Level: ${riskLevel}
- Confidence Range: ${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10

🎯 INTELLIGENT SELECTION STRATEGY (PARLAY WIN FOCUS):
✅ ALL individual bets below are pre-approved and vetted
✅ Your job: Select the best ${numLegs} combinations with HIGHEST WIN PROBABILITY
✅ Priority: ALL legs must hit - no partial payouts, no brownie points for close calls
✅ Same-game parlays ENCOURAGED - multiple different bets from same game
✅ Multi-game parlays SUPPORTED - bets from different games
✅ Focus on research-driven selections with proper conflict avoidance

📊 RISK-APPROPRIATE WIN STRATEGY:
🟢 LOW RISK: Conservative bets, heavy favorites, safe lines (${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10)
🟡 MEDIUM RISK: Balanced selections, reasonable confidence (${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10)  
🔴 HIGH RISK: Strategic variance, but still prioritize win probability (${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10)

🔢 LEG COUNT VALIDATION: Before submitting, manually count each numbered leg (1., 2., 3., etc.) and verify you have EXACTLY ${numLegs} legs!

🚫 CONFLICT PREVENTION (critical when combining pre-approved options):
❌ FORBIDDEN: Eagles moneyline + Eagles spread (redundant - same team outcome)
❌ FORBIDDEN: Eagles -7 + Giants +7 (opposing sides same spread)  
❌ FORBIDDEN: Over 47.5 + Under 47.5 (opposing sides same total)
❌ FORBIDDEN: Hurts Over 250 yards + Hurts Under 250 yards (opposing same prop)
❌ FORBIDDEN: Same exact bet twice (Eagles -7 + Eagles -7)

SAME GAME PARLAY MASTERY (using pre-approved options):
✅ Select multiple different bet types from same game to reach ${numLegs} legs
✅ Example 8-leg same game: Eagles -7 + Over 47.5 + Hurts 250+ pass yards + Saquon 80+ rush yards + AJ Brown anytime TD + Eagles team total Over 24.5 + DeVonta Smith 60+ receiving yards + First TD scorer: Brown
✅ Another 8-leg example: Team spread + Game total + QB passing yards + RB rushing yards + WR1 receiving yards + WR2 anytime TD + Kicker 1+ FG + Defense 1+ sack

SMART COMBINATIONS (what works perfectly):
✅ ALLOWED: Eagles -7 + Over 47.5 + Hurts 250+ yards (different bet types, same game)
✅ ALLOWED: Eagles moneyline + Hurts 2+ TDs + Brown anytime TD (different markets)
✅ ALLOWED: Over 47.5 + Eagles team total Over 24.5 (game total + team total)
✅ ALLOWED: Multiple players: Hurts yards + Saquon yards + Brown yards + Smith yards

RESEARCH-DRIVEN ANALYSIS (WIN PROBABILITY FOCUS):
1. 📰 ALWAYS reference provided research data in your reasoning
2. 🎯 PRIORITIZE WIN PROBABILITY - Focus on likelihood of hitting, not just value
3. 🔍 Cite specific injuries, lineup changes, recent form, trends that support WINS
4. 📊 Connect research insights directly to why this bet will HIT
5. 🧠 Explain HOW research supports your confidence in this leg WINNING
6. ⚡ Avoid risky long-shots unless risk level supports it
7. 🏆 Remember: ALL legs must hit or entire parlay loses

${marketAvailabilityNote}

${oddsContext}

FINAL VALIDATION CHECKLIST:
□ Do I have EXACTLY ${numLegs} legs? (Count them!)
□ Did I check for conflicts between my selected combinations?
□ No opposing sides (Eagles -7 + Giants +7, Over/Under same total)?
□ No redundant bets (Eagles ML + Eagles spread)?
□ Did I prioritize WIN PROBABILITY appropriate for ${riskLevel} risk?
□ Did I reference specific research for each reasoning?
□ Are confidence levels ${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10?
□ Did I select from pre-approved options while avoiding conflicts?
□ Is every leg likely to HIT (ALL-OR-NOTHING parlay strategy)?

REQUIRED FORMAT:

**🎯 ${numLegs}-Leg Parlay: [Research-Based Title]**

**Legs:**
1. 📅 DATE: [MM/DD/YYYY from data]
   Game: [Away] @ [Home]
   Bet: [Specific bet with line]
   Odds: [Exact odds from data]
   Confidence: [${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10]
   Reasoning: [Reference research data, explain WHY this will HIT and confidence level]

[Continue for ALL ${numLegs} legs - same game bets are encouraged to reach exact count]

**Combined Odds:** [CALCULATED]
**Payout on $100:** $[CALCULATED]
**Overall Confidence:** [Average]/10

**Key Research Insights:** [Summarize most impactful data points used]

---

**🔒 BONUS LOCK PARLAY: High-Confidence Research Plays**

[2-3 picks with strongest research support]

**Research Summary:** [Explain why these are locks based on data]
- ANY two bets from same matchup = FORBIDDEN

✅ ALLOWED EXAMPLES:
- Eagles -7 (from Eagles vs Giants) + Cowboys ML (from Cowboys vs Steelers) = OK (different games)

DATE REQUIREMENTS:
- Extract the EXACT date from each game's commence_time
- Do NOT use today's date (${today}) unless that's the actual game date
- Format dates as MM/DD/YYYY from the provided data

STRICT DATA USAGE:
1. Use ONLY games and odds from the data below
2. Each leg must have: Date (MM/DD/YYYY), Game, Bet, Odds, Confidence (${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10), Reasoning
3. Use different games for each leg when MULTIPLE games available - Same game is ALLOWED when limited games
4. MANDATORY: Reference specific research data in reasoning when available
5. NEVER use generic reasons like "winning record" or "home field advantage"
6. ALWAYS cite injury reports, recent performance, or specific research insights

${marketAvailabilityNote}

${oddsContext}

BEFORE YOU START - VALIDATION CHECKLIST:
1. Count unique games available
2. Plan to create EXACTLY ${numLegs} legs using available games and bet types
3. Same game parlays REQUIRED when limited games - use different bet types from same game
4. Ensure confidence levels are ${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10 for ${riskLevel} risk
5. Verify NO conflicting bets (opposing sides same market)
6. FINAL CHECK: Count your numbered legs (1., 2., 3...) = MUST EQUAL ${numLegs}

⚠️ CRITICAL: If you have only 1-2 games available but need ${numLegs} legs, you MUST use same-game parlay strategy with multiple different bet types from the same game(s)!

OUTPUT FORMAT - MUST HAVE EXACTLY ${numLegs} NUMBERED LEGS:

**🎯 ${numLegs}-Leg Parlay: [Title]**

**Legs:**
1. 📅 DATE: [EXACT DATE FROM DATA]
   Game: [EXACT TEAMS FROM DATA]
   Bet: [EXACT BET WITH LINE FROM DATA]
   Odds: [EXACT ODDS FROM DATA]
   Confidence: [${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10 for ${riskLevel} risk]
   Reasoning: [Reference research data, explain confidence level]

2. 📅 DATE: [EXACT DATE FROM DATA]
   Game: [EXACT TEAMS FROM DATA - can be same as leg 1]
   Bet: [DIFFERENT BET TYPE from leg 1]
   Odds: [EXACT ODDS FROM DATA]
   Confidence: [${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10]
   Reasoning: [Reference research data]

[Continue numbering through ${numLegs}. MUST HAVE ${numLegs} NUMBERED LEGS!]

**Combined Odds:** [WILL BE CALCULATED AUTOMATICALLY]
**Payout on $100:** $[WILL BE CALCULATED AUTOMATICALLY]
**Overall Confidence:** [Average]/10

If fewer than ${numLegs} unique games: Add this note:
**Note:** Only [X] unique games available in data, created [X] legs instead of ${numLegs}.

---

**🔒 BONUS LOCK PARLAY: [Title]**

[Same format, highest confidence picks - same game allowed]

CRITICAL FINAL CHECK:
- Same game parlays ALLOWED with different bet types ✓
- No conflicting bets (opposing sides same market) ✓
- Confidence levels ${currentRisk.minConfidence}-${currentRisk.maxConfidence}/10 for ${riskLevel} risk ✓
- Exact dates from data ✓

🔢 MANDATORY: Count your numbered legs (1., 2., 3...) = MUST EQUAL EXACTLY ${numLegs} LEGS!
\n\nMACHINE-READABLE BLOCK (REQUIRED):\nProvide a strict JSON object between the markers below. Use EXACTLY American odds strings like "+105" or "-120" (use "+100" for EV/EVEN/PK). Ensure legs length is EXACTLY ${numLegs}.\n\n===BEGIN_PARLAY_JSON===\n{\n  "parlay": {\n    "title": "[Title]",\n    "legs": [\n      {\n        "date": "MM/DD/YYYY",\n        "game": "Away @ Home",\n        "bet": "[Specific bet with line]",\n        "odds": "+100",\n        "confidence": 8,\n        "citations": [1,2]\n      }\n      // ... repeat until exactly ${numLegs} legs\n    ]\n  },\n  "lockParlay": {\n    "legs": [\n      // 2 legs, optional if not applicable\n    ]\n  }\n}\n===END_PARLAY_JSON===\n`.trim();
  }

  async generateParlayWithAI(prompt, aiModel, fetcher, openaiKey, geminiKey) {
    let content = '';

    if (aiModel === 'openai') {
      if (!openaiKey) throw new Error('Server missing OPENAI_API_KEY');
      
      const response = await fetcher('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an expert sports betting analyst who uses research data and odds analysis to build informed parlays. You MUST follow all data constraints and risk level requirements exactly.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3, // Lower temperature for more consistent rule following
          max_tokens: 3500
        })
      });
      
      if (!response.ok) throw new Error('OpenAI API call failed');
      const data = await response.json();
      content = data.choices?.[0]?.message?.content || '';
    
    } else if (aiModel === 'gemini') {
      if (!geminiKey) throw new Error('Server missing GEMINI_API_KEY');
      
      const geminiModel = 'gemini-2.0-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;
      
      const response = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 3500 } // Lower temperature for better rule following
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
    }

    return content;
  }
}

module.exports = { ParlayAnalyst };