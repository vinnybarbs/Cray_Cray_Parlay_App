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
    // Limit to just enough games for the requested legs (max 10 games)
    const maxItems = Math.min(Math.max(numLegs, 6), 10);
    const items = oddsData.slice(0, maxItems).map((ev, idx) => {
        const gameDate = formatDate(ev.commence_time);
        const teams = `${ev.away_team || '?'} @ ${ev.home_team || '?'}`;
        const bm = (ev.bookmakers && ev.bookmakers[0]) || null;
        
        let marketsSummary = 'no markets';
        if (bm && bm.markets && bm.markets.length > 0) {
          // Show actual odds/lines for ALL markets so AI can see who's favored
          marketsSummary = bm.markets.map(m => {
            const isPropMarket = m.key.startsWith('player_') || m.key.startsWith('team_');
            if (isPropMarket && m.outcomes && m.outcomes.length > 0) {
              // Show first 5 outcomes for props - use description (player name) not name (Yes/No)
              const samples = m.outcomes.slice(0, 5).map(o => {
                const label = o.description || o.name;
                const point = o.point ? ` ${o.point}` : '';
                return `${label}${point}(${o.price})`;
              }).join(', ');
              const more = m.outcomes.length > 5 ? ` +${m.outcomes.length - 5} more` : '';
              return `${m.key}: ${samples}${more}`;
            }
            // For regular markets (h2h, spreads, totals), show the actual lines/odds
            if (m.outcomes && m.outcomes.length > 0) {
              const lines = m.outcomes.map(o => {
                const point = o.point ? ` ${o.point > 0 ? '+' : ''}${o.point}` : '';
                return `${o.name}${point}(${o.price})`;
              }).join(', ');
              return `${m.key}: ${lines}`;
            }
            return `${m.key}(${m.outcomes?.length || 0})`;
          }).join('\n   ');
        }

        // Add research context if available (expanded for better insights)
        let researchSummary = '';
        if (ev.research) {
          // Extract key injury/performance insights (increased to 600 chars for more detail)
          const shortResearch = ev.research.substring(0, 600).replace(/\s+/g, ' ').trim();
          if (shortResearch) {
            researchSummary = `\n   Context: ${shortResearch}...`;
          }
        }

        return `${idx + 1}. DATE: ${gameDate} - ${teams}\n   ${marketsSummary}${researchSummary}`;
      });

      oddsContext = `\n\nAVAILABLE GAMES:\n${items.join('\n\n')}`;
    } else {
      oddsContext = '\n\nNO ODDS DATA';
    }

    if (aiModel === 'gemini') {
      return this.generateGeminiPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, oddsContext, attemptNumber, retryIssues });
    } else {
      return this.generateOpenAIPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, oddsContext, attemptNumber, retryIssues });
    }
  }

  generateOpenAIPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, oddsContext, attemptNumber, retryIssues }) {
    const retry = attemptNumber > 1 ? `RETRY ${attemptNumber}: ${retryIssues}\n\n` : '';
    
    // Define confidence requirements based on risk level
    let confidenceRule = '';
    let confidenceExample = '8/10';
    
    if (riskLevel === 'Low') {
      confidenceRule = '- CONFIDENCE REQUIREMENT: ALL legs MUST be 8-9/10 confidence. Low risk = high probability. Focus on favorites, safe bets, data-backed picks. Goal: WIN the parlay, not maximize payout.';
      confidenceExample = '8/10 or 9/10';
    } else if (riskLevel === 'Medium') {
      confidenceRule = '- CONFIDENCE REQUIREMENT: ALL legs MUST be 6-9/10 confidence. Medium risk = balanced value. Mix of favorites and value picks. Goal: Balance probability and payout.';
      confidenceExample = '7/10';
    } else if (riskLevel === 'High') {
      confidenceRule = '- CONFIDENCE REQUIREMENT: Legs can be 3-9/10 confidence. High risk = big payout potential. Include upsets, underdogs, analyst picks. Goal: Maximize payout with calculated risks.';
      confidenceExample = '5/10';
    }
    
    return `${retry}Create ${numLegs}-leg parlay for ${sportsStr}.

RULES:
- EXACTLY ${numLegs} legs
- Bet types: ${betTypesStr}
- Use EXACT dates/odds from data
- No conflicts
- Risk: ${riskLevel}
${confidenceRule}

**🚨 CRITICAL: ZERO TOLERANCE FOR HALLUCINATIONS 🚨**

YOU WILL BE REJECTED FOR ANY FABRICATED INFORMATION. Follow these rules:

1. **PLAYER-TEAM VERIFICATION IS MANDATORY**: 
   - Before mentioning ANY player, verify which team they play for from Context research
   - If Context doesn't explicitly state "Player X plays for Team Y", DO NOT USE THAT PLAYER
   - DO NOT assume a player's team based on the game matchup

2. **NO INVENTED STATISTICS OR RANKINGS**:
   - DO NOT cite stats like "averaging X touchdowns", "scored in last 3 games", "ranks 28th against the run" unless Context explicitly provides these EXACT numbers
   - DO NOT make up defensive rankings, yards per game, or any other statistics

3. **NO INJURY SPECULATION**:
   - DO NOT mention ANY player being injured or on injury report unless Context explicitly confirms it
   - DO NOT say "with [Player] questionable" or "on injury report" if Context doesn't state this

4. **STRICT CONTEXT-ONLY RULE**:
   - ONLY use facts explicitly written in the Context section below
   - If Context is silent on a topic, you MUST be silent too
   - When in doubt about ANY fact, SKIP THAT PLAYER/BET ENTIRELY

5. **PLAYER PROPS MUST MATCH GAME TEAMS**:
   - For player props, the player MUST play for the Away team OR the Home team listed in that game
   - Example: For "Patriots @ Saints" game, only use Patriots or Saints players
   - DO NOT use players from other teams in that game's prop bets

**Real violations from previous parlays that FAILED**:
- ❌ "Stefon Diggs is a reliable target for the Patriots" in Patriots @ Saints game (Diggs plays for HOUSTON TEXANS, not Patriots or Saints)
- ❌ "Justin Fields on the injury report" for Jets (Fields plays for PITTSBURGH STEELERS, not NY Jets)
- ❌ "Josh Jacobs plays for Cincinnati" (he plays for Green Bay)
- ❌ "J.K. Dobbins plays for Denver" (he plays for LA Chargers)
- ❌ "Broncos rank 28th in league against the run, allowing 145 rushing yards per game" (made up ranking and stat)
- ❌ "D'Andre Swift plays for Commanders" (plays for Bears)

- REASONING REQUIREMENTS: Each leg MUST have 200-300 words of DATA-DRIVEN analysis. Reference specific stats, trends, injuries, or matchups from Context. NO subjective language ("feel", "should", "likely"). Use ONLY facts and numbers from the Context provided below.
${oddsContext}

FORMAT:
**🎯 ${numLegs}-Leg Parlay: [Title]**

**Legs:**
1. 📅 DATE: [MM/DD/YYYY]
   Game: [Away @ Home]
   Bet: [bet with line]
   Odds: [odds]
   Confidence: ${confidenceExample}
   Reasoning: [200-300 word data-driven analysis. REQUIRED: Reference specific stats, trends, injuries, matchups, or recent performance from the Context provided. NO subjective phrases like "feel like", "should", "likely". Use ONLY factual data: "Team X is 8-2 ATS in last 10", "Player Y averaging 25 PPG vs this opponent", "Defense ranks 3rd against the run", etc. If Context is limited, focus on odds value and matchup analysis.]

**Combined Odds:** +XXX
**Payout on $100:** $XXX

===BEGIN_PARLAY_JSON===
{"parlay": {"title": "[Title]", "legs": [{"date": "MM/DD/YYYY", "game": "Away @ Home", "bet": "[bet]", "odds": "+100", "confidence": 7, "citations": []}]}, "lockParlay": {"legs": []}}
===END_PARLAY_JSON===
`.trim();
  }

  generateGeminiPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, oddsContext, attemptNumber, retryIssues }) {
    const retry = attemptNumber > 1 ? `RETRY ${attemptNumber}: ${retryIssues}\n\n` : '';
    
    // Define confidence requirements based on risk level
    let confidenceRule = '';
    let confidenceExample = '8/10';
    
    if (riskLevel === 'Low') {
      confidenceRule = '- CONFIDENCE REQUIREMENT: ALL legs MUST be 8-9/10 confidence. Low risk = high probability. Focus on favorites, safe bets, data-backed picks. Goal: WIN the parlay, not maximize payout.';
      confidenceExample = '8/10 or 9/10';
    } else if (riskLevel === 'Medium') {
      confidenceRule = '- CONFIDENCE REQUIREMENT: ALL legs MUST be 6-9/10 confidence. Medium risk = balanced value. Mix of favorites and value picks. Goal: Balance probability and payout.';
      confidenceExample = '7/10';
    } else if (riskLevel === 'High') {
      confidenceRule = '- CONFIDENCE REQUIREMENT: Legs can be 3-9/10 confidence. High risk = big payout potential. Include upsets, underdogs, analyst picks. Goal: Maximize payout with calculated risks.';
      confidenceExample = '5/10';
    }
    
    return `${retry}Create ${numLegs}-leg parlay for ${sportsStr}.

RULES:
- EXACTLY ${numLegs} legs  
- Bet types: ${betTypesStr}
- Use EXACT dates/odds from data
- No conflicts
- Risk: ${riskLevel}
${confidenceRule}

**🚨 CRITICAL: ZERO TOLERANCE FOR HALLUCINATIONS 🚨**

YOU WILL BE REJECTED FOR ANY FABRICATED INFORMATION. Follow these rules:

1. **PLAYER-TEAM VERIFICATION IS MANDATORY**: 
   - Before mentioning ANY player, verify which team they play for from Context research
   - If Context doesn't explicitly state "Player X plays for Team Y", DO NOT USE THAT PLAYER
   - DO NOT assume a player's team based on the game matchup

2. **NO INVENTED STATISTICS OR RANKINGS**:
   - DO NOT cite stats like "averaging X touchdowns", "scored in last 3 games", "ranks 28th against the run" unless Context explicitly provides these EXACT numbers
   - DO NOT make up defensive rankings, yards per game, or any other statistics

3. **NO INJURY SPECULATION**:
   - DO NOT mention ANY player being injured or on injury report unless Context explicitly confirms it
   - DO NOT say "with [Player] questionable" or "on injury report" if Context doesn't state this

4. **STRICT CONTEXT-ONLY RULE**:
   - ONLY use facts explicitly written in the Context section below
   - If Context is silent on a topic, you MUST be silent too
   - When in doubt about ANY fact, SKIP THAT PLAYER/BET ENTIRELY

5. **PLAYER PROPS MUST MATCH GAME TEAMS**:
   - For player props, the player MUST play for the Away team OR the Home team listed in that game
   - Example: For "Patriots @ Saints" game, only use Patriots or Saints players
   - DO NOT use players from other teams in that game's prop bets

**Real violations from previous parlays that FAILED**:
- ❌ "Stefon Diggs is a reliable target for the Patriots" in Patriots @ Saints game (Diggs plays for HOUSTON TEXANS, not Patriots or Saints)
- ❌ "Justin Fields on the injury report" for Jets (Fields plays for PITTSBURGH STEELERS, not NY Jets)
- ❌ "Josh Jacobs plays for Cincinnati" (he plays for Green Bay)
- ❌ "J.K. Dobbins plays for Denver" (he plays for LA Chargers)
- ❌ "Broncos rank 28th in league against the run, allowing 145 rushing yards per game" (made up ranking and stat)
- ❌ "D'Andre Swift plays for Commanders" (plays for Bears)

- REASONING REQUIREMENTS: Each leg MUST have 200-300 words of DATA-DRIVEN analysis. Reference specific stats, trends, injuries, or matchups from Context. NO subjective language ("feel", "should", "likely"). Use ONLY facts and numbers from the Context provided below.
${oddsContext}

FORMAT:
**🎯 ${numLegs}-Leg Parlay: [Title]**

**Legs:**
1. 📅 DATE: [MM/DD/YYYY]
   Game: [Away @ Home]
   Bet: [bet with line]
   Odds: [odds]
   Confidence: ${confidenceExample}
   Reasoning: [200-300 word data-driven analysis. REQUIRED: Reference specific stats, trends, injuries, matchups, or recent performance from the Context provided. NO subjective phrases like "feel like", "should", "likely". Use ONLY factual data: "Team X is 8-2 ATS in last 10", "Player Y averaging 25 PPG vs this opponent", "Defense ranks 3rd against the run", etc. If Context is limited, focus on odds value and matchup analysis.]

**Combined Odds:** +XXX
**Payout on $100:** $XXX

===BEGIN_PARLAY_JSON===
{"parlay": {"title": "[Title]", "legs": [{"date": "MM/DD/YYYY", "game": "Away @ Home", "bet": "[bet]", "odds": "+100", "confidence": 7, "citations": []}]}, "lockParlay": {"legs": []}}
===END_PARLAY_JSON===
`.trim();
  }

  async generateParlayWithAI(prompt, aiModel, fetcher, openaiKey, geminiKey) {
    let content = '';
    
    const promptSize = prompt.length;
    const promptKb = (promptSize / 1024).toFixed(2);
    console.log(`📝 Prompt: ${promptKb} KB (${promptSize} chars)`);
    
    const startTime = Date.now();

    if (aiModel === 'openai') {
      if (!openaiKey) throw new Error('Server missing OPENAI_API_KEY');
      
      console.log(`🚀 Calling OpenAI...`);
      const response = await fetcher('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an expert sports betting analyst. Follow all rules exactly.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 2000
        })
      });
      
      if (!response.ok) throw new Error('OpenAI API call failed');
      const data = await response.json();
      content = data.choices?.[0]?.message?.content || '';
      
      const elapsedMs = Date.now() - startTime;
      console.log(`✅ OpenAI: ${elapsedMs}ms (${(elapsedMs/1000).toFixed(1)}s)`);
    
    } else if (aiModel === 'gemini') {
      if (!geminiKey) throw new Error('Server missing GEMINI_API_KEY');
      
      console.log(`🚀 Calling Gemini...`);
      const geminiModel = 'gemini-2.0-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;
      
      const response = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2000 }
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.text();
        console.error('Gemini Error:', errorData);
        throw new Error(`Gemini API: ${response.status}`);
      }
      
      const data = await response.json();
      content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!content) throw new Error('Gemini returned empty response');
      
      const elapsedMs = Date.now() - startTime;
      console.log(`✅ Gemini: ${elapsedMs}ms (${(elapsedMs/1000).toFixed(1)}s)`);
    }
    
    const responseKb = (content.length / 1024).toFixed(2);
    console.log(`📥 Response: ${responseKb} KB`);

    return content;
  }
}


module.exports = { ParlayAnalyst };
