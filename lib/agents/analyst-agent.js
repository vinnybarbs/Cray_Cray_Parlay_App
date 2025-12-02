const { AIFunctions } = require('../services/ai-functions');

// Parlay Analyst Agent - Generates optimal parlays with enhanced data
class ParlayAnalyst {
  constructor() {
    this.conflictRules = [
      'NO same team moneyline + spread',
      'NO opposing teams same game same market',
      'NO over/under same game same total',
      'NO same player over/under same prop'
    ];
    
    // Function schemas for OpenAI Function Calling
    this.functionSchemas = [
      {
        name: 'get_player_stats',
        description: 'Get recent performance stats for a specific player. Use this to research player props like Pass TDs, Rush Yards, Receptions, etc.',
        parameters: {
          type: 'object',
          properties: {
            playerName: {
              type: 'string',
              description: 'Full player name (e.g., "Matthew Stafford", "Bijan Robinson")'
            },
            team: {
              type: 'string',
              description: 'Team name (e.g., "Los Angeles Rams", "Atlanta Falcons")'
            },
            statType: {
              type: 'string',
              enum: ['passing', 'rushing', 'receiving'],
              description: 'Type of stats to retrieve - passing for QBs, rushing for RBs, receiving for WRs/TEs'
            },
            lastNGames: {
              type: 'number',
              description: 'Number of recent games to analyze (default 5)',
              default: 5
            }
          },
          required: ['playerName', 'team', 'statType']
        }
      },
      {
        name: 'get_team_stats',
        description: 'Get season stats for a team including points per game, points allowed, and point differential. Use for spread/total/moneyline analysis.',
        parameters: {
          type: 'object',
          properties: {
            teamName: {
              type: 'string',
              description: 'Team name (e.g., "Denver Broncos", "Kansas City Chiefs")'
            }
          },
          required: ['teamName']
        }
      }
    ];
  }

  generateAIPrompt({ selectedSports, selectedBetTypes, numLegs, riskLevel, oddsData, unavailableInfo, dateRange, aiModel = 'openai', attemptNumber = 1, fastMode = false, retryIssues = '', verificationContext = '' }) {
    const sportsStr = selectedSports.join(', ');
    const betTypesStr = selectedBetTypes.join(', ');
    const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'America/Denver' });
    const dateRangeText = `${dateRange || 1} day(s)`;

    const formatDate = (iso) => {
      if (!iso) return 'TBD';
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'America/Denver' });
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

        // Add cached intelligence context if available
        let intelligenceContext = '';
        if (ev.intelligenceContext && ev.intelligenceContext.hasIntel) {
          const taglines = ev.intelligenceContext.taglines || [];
          if (taglines.length > 0) {
            const shortTaglines = taglines.slice(0, 2).map(t => t.text).join('; ');
            intelligenceContext = `\n   🧠 Intel: ${shortTaglines}`;
          }
        }

        // Add cached sports stats context if available
        let statsContext = '';
        if (ev.statsContext && ev.statsContext.dataSource === 'cached_sports_stats') {
          const homeStats = ev.statsContext.homeTeam.stats;
          const awayStats = ev.statsContext.awayTeam.stats;
          
          if (homeStats && awayStats) {
            let statsSummary = [];
            
            // Add key team stats based on sport
            const sport = ev.sport_key?.toUpperCase();
            
            if (sport === 'NFL' || sport === 'NCAAF') {
              if (homeStats.wins && awayStats.wins) {
                statsSummary.push(`Records: ${ev.statsContext.homeTeam.name} ${homeStats.wins}-${homeStats.losses}, ${ev.statsContext.awayTeam.name} ${awayStats.wins}-${awayStats.losses}`);
              }
              if (homeStats.points_for && awayStats.points_for) {
                statsSummary.push(`Avg Points: ${ev.statsContext.homeTeam.name} ${homeStats.points_for}ppg, ${ev.statsContext.awayTeam.name} ${awayStats.points_for}ppg`);
              }
              if (homeStats.points_against && awayStats.points_against) {
                statsSummary.push(`Defense: ${ev.statsContext.homeTeam.name} allows ${homeStats.points_against}ppg, ${ev.statsContext.awayTeam.name} allows ${awayStats.points_against}ppg`);
              }
            } else if (sport === 'NBA') {
              if (homeStats.wins && awayStats.wins) {
                statsSummary.push(`Records: ${ev.statsContext.homeTeam.name} ${homeStats.wins}-${homeStats.losses}, ${ev.statsContext.awayTeam.name} ${awayStats.wins}-${awayStats.losses}`);
              }
              if (homeStats.points && awayStats.points) {
                statsSummary.push(`Scoring: ${ev.statsContext.homeTeam.name} ${homeStats.points}ppg, ${ev.statsContext.awayTeam.name} ${awayStats.points}ppg`);
              }
            } else if (sport === 'MLB') {
              if (homeStats.wins && awayStats.wins) {
                statsSummary.push(`Records: ${ev.statsContext.homeTeam.name} ${homeStats.wins}-${homeStats.losses}, ${ev.statsContext.awayTeam.name} ${awayStats.wins}-${awayStats.losses}`);
              }
              if (homeStats.runs && awayStats.runs) {
                statsSummary.push(`Runs: ${ev.statsContext.homeTeam.name} ${homeStats.runs}rpg, ${ev.statsContext.awayTeam.name} ${awayStats.runs}rpg`);
              }
            } else if (sport === 'NHL') {
              if (homeStats.points && awayStats.points) {
                statsSummary.push(`Standings: ${ev.statsContext.homeTeam.name} ${homeStats.points}pts, ${ev.statsContext.awayTeam.name} ${awayStats.points}pts`);
              }
              if (homeStats.goals_for && awayStats.goals_for) {
                statsSummary.push(`Goals: ${ev.statsContext.homeTeam.name} ${homeStats.goals_for}GF, ${ev.statsContext.awayTeam.name} ${awayStats.goals_for}GF`);
              }
            } else if (sport === 'SOCCER') {
              if (homeStats.position && awayStats.position) {
                statsSummary.push(`Position: ${ev.statsContext.homeTeam.name} ${homeStats.position}th, ${ev.statsContext.awayTeam.name} ${awayStats.position}th`);
              }
              if (homeStats.goals && awayStats.goals) {
                statsSummary.push(`Goals: ${ev.statsContext.homeTeam.name} ${homeStats.goals}, ${ev.statsContext.awayTeam.name} ${awayStats.goals}`);
              }
            }
            
            // Add matchup insights
            if (ev.statsContext.insights && ev.statsContext.insights.length > 0) {
              const insights = ev.statsContext.insights.slice(0, 2).join('; ');
              statsSummary.push(`Insights: ${insights}`);
            }
            
            if (statsSummary.length > 0) {
              statsContext = `\n   📊 Stats: ${statsSummary.join(' | ')}`;
            }
          }
        }

        return `${idx + 1}. DATE: ${gameDate} - ${teams}\n   ${marketsSummary}${researchSummary}${intelligenceContext}${statsContext}`;
      });

      oddsContext = `\n\nAVAILABLE GAMES:\n${items.join('\n\n')}`;
    } else {
      oddsContext = '\n\nNO ODDS DATA';
    }

    // Append verification context if provided
    if (verificationContext) {
      oddsContext += verificationContext;
    }

    return this.generateOpenAIPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, oddsContext, attemptNumber, retryIssues });
  }

  generateOpenAIPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, oddsContext, attemptNumber, retryIssues }) {
    const retry = attemptNumber > 1 ? `RETRY ${attemptNumber}: ${retryIssues}\n\n` : '';
    
    // Define confidence requirements based on risk level
    let confidenceRule = '';
    let confidenceExample = '8/10';
    let combinedOddsTarget = '';
    let oddsPolicyRule = '';
    let confidenceCalibrationRule = '';
    
    if (riskLevel === 'Low') {
      confidenceRule = '- CONFIDENCE REQUIREMENT: ALL legs MUST be 8-9/10 confidence. Low risk = high probability. Focus on favorites, safe bets, data-backed picks. Goal: WIN the parlay, not maximize payout.';
      confidenceExample = '8/10 or 9/10';
      combinedOddsTarget = '- TARGET COMBINED ODDS: Aim for roughly +200 to +400 total';
      oddsPolicyRule = '- ODDS POLICY: Prioritize heavy favorites. The individual payout per leg is NOT important—per-leg probability is. Accept American odds from -200 down to -1000 (or shorter). Avoid positive odds unless overwhelmingly justified by context.';
      confidenceCalibrationRule = '- CONFIDENCE-ODDS CALIBRATION: -110 to -150 cannot be 9/10; cap at 6-7/10 or CONVERT to Moneyline. -151 to -200 ≈ 7-8/10. -201 to -400 ≈ 8/10. -401 to -800 ≈ 9/10. If a spread/prop is ~-110, REPLACE with Moneyline or ATD to meet heavy-favorite threshold.';
    } else if (riskLevel === 'Medium') {
      confidenceRule = '- CONFIDENCE REQUIREMENT: ALL legs MUST be 6-9/10 confidence. Medium risk = balanced value. Mix of favorites and value picks. Goal: Balance probability and payout.';
      confidenceExample = '7/10';
      combinedOddsTarget = '- TARGET COMBINED ODDS: Aim for roughly +400 to +600 total';
      oddsPolicyRule = '- ODDS POLICY: Prefer favorites and modest lines (e.g., -120 to -250), sprinkle limited plus-money only when strongly supported by context.';
      confidenceCalibrationRule = '- CONFIDENCE-ODDS CALIBRATION: -110 to -150 ≈ 6-7/10, -151 to -250 ≈ 7-8/10, ≤ -400 can be 8-9/10 when strongly supported.';
    } else if (riskLevel === 'High') {
      confidenceRule = '- CONFIDENCE REQUIREMENT: Legs can be 3-9/10 confidence. High risk = big payout potential. Include upsets, underdogs, analyst picks. Goal: Maximize payout with calculated risks.';
      confidenceExample = '5/10';
      combinedOddsTarget = '- TARGET COMBINED ODDS: Aim for +600 or higher total';
      oddsPolicyRule = '- ODDS POLICY: Plus-money and adventurous lines allowed; justify with strong context.';
      confidenceCalibrationRule = '- CONFIDENCE-ODDS CALIBRATION: High variance allowed; ensure confidence reflects both price and data cited.';
    }
    
    return `${retry}Create ${numLegs}-leg parlay for ${sportsStr}.

RULES:
- EXACTLY ${numLegs} legs
- Bet types: ${betTypesStr}
- Use EXACT dates/odds from data
- No conflicts
- Risk: ${riskLevel}
${confidenceRule}
${combinedOddsTarget}
${oddsPolicyRule}
${confidenceCalibrationRule}
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
6. **NEVER INVENT ODDS, SPREADS, OR FAVORITES**:
   - ONLY use the EXACT odds, spreads, and moneylines shown in the Odds Data section
   - DO NOT say Team X is favored unless the odds explicitly show negative spread or negative moneyline
   - Example: If odds show Seahawks -1.5 then Seahawks are favored by 1.5 points
   - Example: If odds show Jaguars +1.5 then Jaguars are underdogs getting 1.5 points  
   - DO NOT invent spreads or flip favorites based on assumptions - use ONLY what the odds data shows


**Real violations from previous parlays that FAILED**:
- ❌ "Jaguars Moneyline -150" and "Jaguars are favored" when actual odds showed Seahawks -1.5 (Seahawks favored, not Jaguars)
- ❌ "Stefon Diggs is a reliable target for the Patriots" in Patriots @ Saints game (Diggs plays for HOUSTON TEXANS, not Patriots or Saints)
- ❌ "Justin Fields on the injury report" for Jets (Fields plays for PITTSBURGH STEELERS, not NY Jets)
- ❌ "Josh Jacobs plays for Cincinnati" (he plays for Green Bay)
- ❌ "J.K. Dobbins plays for Denver" (he plays for LA Chargers)
- ❌ "Broncos rank 28th in league against the run, allowing 145 rushing yards per game" (made up ranking and stat)
- ❌ "D'Andre Swift plays for Commanders" (plays for Bears)

- REASONING REQUIREMENTS: Each leg MUST have tight, punchy analysis (roughly 80-140 words). Write like a sharp handicapper, not a polite assistant: direct, confident, and specific. Anchor your reasoning on the concrete numbers and intel from the Context (📊 Stats, 🧠 Intel, news, odds). Avoid filler like "should", "likely", "look to", "momentum", "bounce back", or long storylines. Use ONLY facts and numbers from the Context provided below.
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

  async generateParlayWithAI(prompt, fetcher, openaiKey) {
    let content = '';
    
    const promptSize = prompt.length;
    const promptKb = (promptSize / 1024).toFixed(2);
    console.log(`📝 Prompt: ${promptKb} KB (${promptSize} chars)`);
    
    const startTime = Date.now();

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
          { role: 'system', content: 'You are an expert sports betting analyst with access to comprehensive team/player statistics and real-time intelligence. Prioritize cached intelligence (🧠 Intel) and stats data (📊 Stats) when making decisions. Use injury reports, analyst picks, and betting trends to provide compelling reasoning. Follow all rules exactly.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 1400
      })
    });
    
    if (!response.ok) throw new Error('OpenAI API call failed');
    const data = await response.json();
    content = data.choices?.[0]?.message?.content || '';
    
    const elapsedMs = Date.now() - startTime;
    console.log(`✅ OpenAI: ${elapsedMs}ms (${(elapsedMs/1000).toFixed(1)}s)`);
    
    const responseKb = (content.length / 1024).toFixed(2);
    console.log(`📥 Response: ${responseKb} KB`);

    return content;
  }

  /**
   * Select best individual picks from all available options
   * Returns array of picks with confidence scores and reasoning
   */
  async selectBestPicks({ picks, numSuggestions, riskLevel, betTypes, apiKey, realData = null, historicalLessons = [], supabase = null }) {
    console.log(`\n🤖 AI analyzing ${picks.length} picks to select best ${numSuggestions}...`);
    if (historicalLessons.length > 0) {
      console.log(`   📚 Using ${historicalLessons.length} historical lessons`);
    }
    
    // Initialize AI Functions for dynamic data retrieval
    const aiFunctions = supabase ? new AIFunctions(supabase) : null;
    if (aiFunctions) {
      console.log(`   🔧 Function calling enabled - AI can query database dynamically`);
    } else {
      console.log(`   📊 Using verbose data format (no database connection)`);
    }
    
    const prompt = this.buildPickSelectionPrompt(picks, numSuggestions, riskLevel, betTypes, realData, historicalLessons);
    
    // System prompt for gpt-4o with function calling
    const systemPrompt = `You are a renowned sports betting analyst with a proven track record of winning picks. Bettors follow your analysis and reasoning to build successful parlays. Your edge comes from data-driven insights delivered with confidence.

YOUR APPROACH:
- Analyze matchups using team records, recent performance, key player stats, and injury reports
- Provide concise but detailed reasoning that explains WHY each pick offers value
- Reference specific statistics from the data (W-L records, PPG, yards, player performance)
- Focus on facts and trends rather than speculation
- Your goal: help bettors WIN more than they lose

${aiFunctions ? `
MANDATORY RESEARCH PROTOCOL:
You MUST research EVERY pick before suggesting it. DO NOT suggest picks you haven't researched.

REQUIRED FUNCTION CALLS:
1. **Team bets (Spread/Moneyline/Total):** Call get_team_stats() for BOTH teams
   - Example for "Jaguars @ Titans": 
     → get_team_stats("Jacksonville Jaguars")
     → get_team_stats("Tennessee Titans")
   - Compare their PPG, defensive stats, point differential
   
2. **Player props:** Call get_player_stats() for the specific player
   - Example: get_player_stats("Bo Nix", "Denver Broncos", "passing", 5)

3. **Your reasoning MUST include the actual numbers from your research:**
   ✅ "Jaguars (7-4, 28.3 PPG) vs Titans (3-8, 22.5 PPG, allow 25.7 PPG). Jaguars +65 point diff vs Titans -35."
   ❌ "Jaguars have better scoring capacity and leverage advanced modeling."

PROCESS:
Step 1: Research all games by calling get_team_stats for both teams
Step 2: Analyze the actual numbers (wins, PPG, points allowed, differential)
Step 3: Write reasoning with those specific numbers
Step 4: Return JSON with data-backed reasoning
` : `
DATA GUIDELINES:
- Use the team stats, player data, and injury reports provided in the data section
- Cite specific numbers: "Chiefs averaging 28 PPG in last 3 games" not "good offense"
`}

- Reference actual player names and their positions from the data
- When mentioning players, verify they play for the teams in the game
- CRITICAL: For player props, ONLY suggest players who play for the home or away team in that specific game
- Example: For "49ers @ Browns", ONLY suggest 49ers or Browns players - NO college players, NO players from other teams

PICK REQUIREMENTS:
- Aim to provide 10-15 quality suggestions per request (more if games available)
- Spread bets: Include "point" field with value (e.g., +6.5, -3.5)
- Total bets: Include "point" field with line (e.g., 47.5)  
- Moneyline bets: Set "point" to null
- "odds" is the American odds format (-112, +140, -200)
- Each pick should have 6-9 confidence based on strength of analysis

REASONING STYLE:
✅ "Stafford has averaged 2.8 Pass TDs per game in last 5 games vs bottom-10 defenses. Panthers rank 28th in pass defense allowing 3.1 Pass TDs/game. Over 2.5 is achievable."
❌ "Current pricing appears favorable given game environment and situational context."

${aiFunctions ? `
CRITICAL - FINAL RESPONSE FORMAT:
After researching, return ONLY valid JSON. No markdown, no explanations, JUST the JSON object.

EXACT SCHEMA (DO NOT ADD EXTRA FIELDS):
{
  "analytical_summary": "Brief summary of analysis approach",
  "picks": [
    {
      "id": "string",
      "gameDate": "YYYY-MM-DD",
      "sport": "NFL",
      "homeTeam": "string",
      "awayTeam": "string", 
      "betType": "Spread|Moneyline|Total|Player Props",
      "pick": "string",
      "odds": "string",
      "spread": "string",
      "point": "string or null",
      "confidence": number,
      "edge_type": "string",
      "reasoning": "string with specific stats"
    }
  ]
}

RULES:
- Each pick gets ONE edge_type field (not multiple)
- No "contrary_evidence" field
- No duplicate fields
- No trailing commas
- All strings must be quoted
- confidence is a number 6-9
` : 'Return valid JSON only.'}`;
    
    // Function calling loop - AI can query database dynamically
    let messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];
    
    let maxIterations = 10; // Prevent infinite loops
    let iteration = 0;
    let finalContent = null;
    
    while (iteration < maxIterations) {
      iteration++;
      console.log(`\n🔄 Function calling iteration ${iteration}...`);
      
      // Build API request for Chat Completions API
      const requestBody = {
        model: 'gpt-4o',
        messages: messages,
        temperature: 0.7,
        max_tokens: 8000  // Increased for function calling with multiple games
      };
      
      // Add tools parameter if function calling is enabled
      if (aiFunctions) {
        requestBody.tools = this.functionSchemas.map(schema => ({
          type: 'function',
          function: schema
        }));
        // Force AI to use functions on first call, then auto
        requestBody.tool_choice = iteration === 1 ? 'required' : 'auto';
      } else {
        // Only use JSON format when NOT using function calling
        requestBody.response_format = { type: 'json_object' };
      }
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
      }
      
      const data = await response.json();
      const assistantMessage = data.choices[0].message;
      const toolCalls = assistantMessage.tool_calls;
      
      // Check if AI wants to call functions
      if (!toolCalls || toolCalls.length === 0) {
        // No more function calls - this is the final answer
        finalContent = assistantMessage.content;
        console.log(`✅ AI finished after ${iteration} iteration(s)`);
        
        // If response doesn't look like JSON, ask AI to format it properly
        if (finalContent && !finalContent.trim().startsWith('{')) {
          console.log('⚠️  Response not JSON, requesting proper format...');
          messages.push({
            role: 'assistant',
            content: finalContent
          });
          messages.push({
            role: 'user',
            content: 'Please format your analysis as valid JSON following the exact schema provided. Return ONLY the JSON object, no explanations.'
          });
          
          // Make one more API call with JSON format enforced
          const jsonResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              messages: messages,
              response_format: { type: 'json_object' },
              temperature: 0.3,
              max_tokens: 8000  // Match main request token limit
            })
          });
          
          if (jsonResponse.ok) {
            const jsonData = await jsonResponse.json();
            finalContent = jsonData.choices[0].message.content;
            console.log('✅ Reformatted as JSON');
          }
        }
        break;
      }
      
      // Execute function calls
      console.log(`   🔧 AI requested ${toolCalls.length} function calls`);
      
      // Add assistant message with tool calls to messages
      messages.push({
        role: 'assistant',
        content: assistantMessage.content || null,
        tool_calls: toolCalls
      });
      
      // Execute each function and collect results
      for (const toolCall of toolCalls) {
        const functionName = toolCall.function?.name;
        const functionArgs = JSON.parse(toolCall.function?.arguments || '{}');
        
        console.log(`   📞 Calling ${functionName}(${JSON.stringify(functionArgs)})`);
        
        let result;
        try {
          // Call the appropriate function
          switch (functionName) {
            case 'get_player_stats':
              result = await aiFunctions.getPlayerStats(
                functionArgs.playerName,
                functionArgs.team,
                functionArgs.statType,
                functionArgs.lastNGames || 5
              );
              break;
            case 'get_team_stats':
              result = await aiFunctions.getTeamStats(
                functionArgs.teamName,
                functionArgs.lastNGames || 3
              );
              break;
            case 'get_team_record':
              result = await aiFunctions.getTeamRecord(functionArgs.teamName);
              break;
            case 'get_injuries':
              result = await aiFunctions.getInjuries(functionArgs.teamName);
              break;
            case 'get_news_insights':
              result = await aiFunctions.getNewsInsights(functionArgs.teamName);
              break;
            default:
              result = { success: false, error: `Unknown function: ${functionName}` };
          }
        } catch (error) {
          result = { success: false, error: error.message };
        }
        
        console.log(`   ✓ Result: ${JSON.stringify(result).substring(0, 150)}...`);
        
        // Add function result to messages
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }
    }
    
    if (!finalContent) {
      throw new Error('AI did not return final answer after max iterations');
    }
    
    // Clean and parse AI response
    let result;
    try {
      // Remove markdown code blocks if present
      let cleanedContent = finalContent.trim();
      if (cleanedContent.startsWith('```')) {
        cleanedContent = cleanedContent.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
      }
      
      // Try to extract JSON if there's text before/after
      const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanedContent = jsonMatch[0];
      }
      
      result = JSON.parse(cleanedContent);
      
      // Validate and clean picks
      if (result.picks && Array.isArray(result.picks)) {
        result.picks = result.picks.map(pick => {
          // Remove any duplicate or invalid fields
          const cleanPick = {
            id: pick.id,
            gameDate: pick.gameDate,
            sport: pick.sport,
            homeTeam: pick.homeTeam,
            awayTeam: pick.awayTeam,
            betType: pick.betType,
            pick: pick.pick,
            odds: pick.odds,
            spread: pick.spread,
            point: pick.point,
            confidence: pick.confidence,
            edge_type: Array.isArray(pick.edge_type) ? pick.edge_type[0] : pick.edge_type,
            reasoning: pick.reasoning
          };
          return cleanPick;
        });
      }
    } catch (e) {
      console.error('Failed to parse AI response:', finalContent.substring(0, 500));
      throw new Error(`AI returned invalid JSON: ${e.message}`);
    }
    
    // Format picks for frontend with analytical edge context
    const selectedPicks = (result.picks || []).map(pick => {
      const basePick = picks.find(p => p.id === pick.id) || {};
      let researchSummary = pick.researchSummary || basePick.research || '';

      // Hide raw TEAM STATS & RECORDS blobs (intended for AI, not UI)
      if (typeof researchSummary === 'string' && researchSummary.includes('TEAM STATS & RECORDS')) {
        researchSummary = '';
      }

      return {
        id: pick.id,
        gameDate: pick.gameDate,
        sport: pick.sport,
        homeTeam: pick.homeTeam,
        awayTeam: pick.awayTeam,
        betType: pick.betType,
        pick: pick.pick,
        odds: pick.odds,
        spread: pick.spread, // Game spread for context
        point: pick.point,   // Actual bet line (e.g., +9.5, -3.5, 47.5)
        confidence: pick.confidence,
        reasoning: pick.reasoning,
        researchSummary,
        edgeType: pick.edge_type || 'value',
        contraryEvidence: pick.contrary_evidence || '',
        analyticalSummary: result.analytical_summary || ''
      };
    });
    
    console.log(`🎯 Analytical Summary: ${result.analytical_summary || 'N/A'}`);
    console.log(`📊 Edge Types Found: ${selectedPicks.map(p => p.edgeType).join(', ')}`);;
    
    return selectedPicks;
  }

  /**
   * Build analytical edge-detection prompt for AI with historical lessons
   */
  buildPickSelectionPrompt(picks, numSuggestions, riskLevel, betTypes, realData = null, historicalLessons = []) {
    const edgeDetectionFramework = {
      'Low': 'Find CLEAR MISMATCHES: Heavy favorites in bad spots, public overreactions',
      'Medium': 'Find VALUE DISCREPANCIES: Line movement vs news, market overreactions, situational advantages', 
      'High': 'Find HIDDEN EDGES: Contrarian angles, team records vs odds, overlooked matchups'
    };
    
    // Group picks by game for analytical comparison
    const gameGroups = new Map();
    picks.forEach(pick => {
      const gameKey = `${pick.awayTeam}_${pick.homeTeam}`;
      if (!gameGroups.has(gameKey)) {
        gameGroups.set(gameKey, {
          game: `${pick.awayTeam} @ ${pick.homeTeam}`,
          date: pick.gameDate,
          sport: pick.sport,
          research: pick.research,
          picks: []
        });
      }
      gameGroups.get(gameKey).picks.push(pick);
    });
    
    // Track teams that are actually involved in the games we are analyzing
    const activeTeams = new Set();

    const analyticalContext = Array.from(gameGroups.values()).map((group, idx) => {
      const moneylineOptions = group.picks.filter(p => p.betType === 'Moneyline');
      const spreadOptions = group.picks.filter(p => p.betType === 'Spread');
      const totalOptions = group.picks.filter(p => p.betType === 'Total');
      const propOptions = group.picks.filter(p => p.betType.includes('Player') || p.betType.includes('Props'));
      // Derive team names from the game label ("Away @ Home") so we can later
      // restrict VERIFIED DATA output to only these matchup teams.
      if (group.game) {
        const parts = group.game.split(' @ ');
        if (parts[0]) activeTeams.add(parts[0]);
        if (parts[1]) activeTeams.add(parts[1]);
      }
      
      let marketAnalysis = [];
      
      if (moneylineOptions.length >= 2) {
        const favorite = moneylineOptions.find(p => parseInt(p.odds) < 0);
        const underdog = moneylineOptions.find(p => parseInt(p.odds) > 0);
        if (favorite && underdog) {
          marketAnalysis.push(`ML: ${favorite.pick} ${favorite.odds} vs ${underdog.pick} ${underdog.odds}`);
        }
      }
      
      if (spreadOptions.length >= 2) {
        const favoriteSpread = spreadOptions.find(p => p.point && parseFloat(p.point) < 0);
        const underdogSpread = spreadOptions.find(p => p.point && parseFloat(p.point) > 0);
        if (favoriteSpread && underdogSpread) {
          marketAnalysis.push(`Spread: ${favoriteSpread.pick} ${favoriteSpread.point} vs ${underdogSpread.pick} ${underdogSpread.point}`);
        }
      }
      
      if (totalOptions.length >= 2) {
        const over = totalOptions.find(p => p.pick.toLowerCase().includes('over'));
        const under = totalOptions.find(p => p.pick.toLowerCase().includes('under'));
        if (over && under) {
          marketAnalysis.push(`Total: Over ${over.point || over.odds} vs Under ${under.point || under.odds}`);
        }
      }

      // Compact per-game FACTS block built from realData.gameSnapshots when available
      let factsLine = '';
      try {
        if (realData && realData.gameSnapshots && group.game) {
          const snapshot = realData.gameSnapshots[group.game];
          if (snapshot) {
            const homeRec = snapshot.records?.home;
            const awayRec = snapshot.records?.away;
            const homeLabel = homeRec?.record ? `${homeRec.team} ${homeRec.record}` : (homeRec?.team || 'Home');
            const awayLabel = awayRec?.record ? `${awayRec.team} ${awayRec.record}` : (awayRec?.team || 'Away');
            const homePPG = snapshot.recentForm?.home?.last3Points;
            const awayPPG = snapshot.recentForm?.away?.last3Points;
            const facts = [];
            if (homeLabel || awayLabel) {
              facts.push(`Records: ${awayLabel} vs ${homeLabel}`);
            }
            if (typeof awayPPG === 'number' || typeof homePPG === 'number') {
              const awayPPGText = typeof awayPPG === 'number' ? `${snapshot.awayTeam || 'Away'} ${awayPPG.toFixed(1)} PPG (last 3)` : '';
              const homePPGText = typeof homePPG === 'number' ? `${snapshot.homeTeam || 'Home'} ${homePPG.toFixed(1)} PPG (last 3)` : '';
              const both = [awayPPGText, homePPGText].filter(Boolean).join(', ');
              if (both) facts.push(`Scoring: ${both}`);
            }
            if (facts.length > 0) {
              factsLine = `\n   FACTS: ${facts.join(' | ')}`;
            }
          }
        }
      } catch (e) {
        // If anything goes wrong building facts, fail silently to avoid breaking prompt
      }
      
      return `${idx + 1}. ${group.game} (${new Date(group.date).toLocaleDateString()})
   Markets: ${marketAnalysis.join(' | ')}
   Research: "${group.research.substring(0, 800)}"${factsLine}
   Props Available: ${propOptions.length} options
   ALL PICKS: ${group.picks.map(p => `${p.id}:${p.betType}-${p.pick}@${p.odds}`).join(', ')}`;
    }).join('\n\n');
    
    // Build real data section if provided
    let realDataSection = '';
    if (realData) {
      // DEBUG: Log what data we have
      console.log('🔍 Real data keys:', Object.keys(realData));
      console.log('🔍 Team stats count:', Object.keys(realData.teamStats || {}).length);
      console.log('🔍 Top performers count:', Object.keys(realData.topPerformers || {}).length);
      
      realDataSection = `
**=== VERIFIED DATA ===**

**INJURY REPORTS** (Current):
${Object.entries(realData.injuries || {})
  .filter(([team]) => activeTeams.has(team))
  .map(([team, injuries]) => {
    if (!injuries || injuries.length === 0) return '';
    return `\n${team}:\n${injuries.map(inj => `  - ${inj.player} (${inj.position}): ${inj.status} - ${inj.injury || 'Undisclosed'}`).join('\n')}`;
  }).filter(Boolean).join('\n') || 'No current injuries reported'}

**TEAM RECORDS & STANDINGS**:
${Object.entries(realData.teamRecords || {})
  .filter(([team]) => activeTeams.has(team))
  .map(([team, data]) => {
    if (typeof data === 'object' && data.record) {
      const parts = [];
      parts.push(`${team}: ${data.record}`);
      if (typeof data.winPercentage === 'number') {
        parts.push(`${(data.winPercentage * 100).toFixed(1)}% win rate`);
      }
      if (typeof data.pointDifferential === 'number') {
        parts.push(`Point Diff: ${data.pointDifferential > 0 ? '+' : ''}${data.pointDifferential}`);
      }
      if (data.streak) {
        parts.push(`Streak: ${data.streak}`);
      }
      if (data.divisionRank) {
        parts.push(`Division Rank: #${data.divisionRank}`);
      }
      return parts.join(' | ');
    }
    return `${team}: ${data.record || `${data.wins}-${data.losses}`}`;
  }).join('\n') || 'No records available'}

**RECENT TEAM PERFORMANCE** (Last 3 Games):
${Object.entries(realData.teamStats || {})
  .filter(([team]) => activeTeams.has(team))
  .map(([team, stats]) => {
    const a = stats.averages || {};
    return `${team}: Averaging ${a.points ?? 'N/A'} PPG, ${a.totalYards ?? 'N/A'} total yards (${a.passingYards ?? 'N/A'} pass, ${a.rushingYards ?? 'N/A'} rush), ${a.turnovers ?? 'N/A'} turnovers/game`;
  }).join('\n') || 'No recent stats available'}

**TOP PERFORMERS** (Season Leaders):
${Object.entries(realData.topPerformers || {})
  .filter(([team]) => activeTeams.has(team))
  .map(([team, performers]) => {
    const parts = [];
    if (performers.topPasser) parts.push(`  ${performers.topPasser.position || 'QB'} ${performers.topPasser.name}: ${performers.topPasser.yards} yards, ${performers.topPasser.touchdowns} TDs`);
    if (performers.topRusher) parts.push(`  ${performers.topRusher.position || 'RB'} ${performers.topRusher.name}: ${performers.topRusher.yards} yards, ${performers.topRusher.touchdowns} TDs`);
    if (performers.topReceiver) parts.push(`  ${performers.topReceiver.position || 'WR'} ${performers.topReceiver.name}: ${performers.topReceiver.receptions} rec, ${performers.topReceiver.yards} yards, ${performers.topReceiver.touchdowns} TDs`);
    return parts.length > 0 ? `${team}:\n${parts.join('\n')}` : '';
  }).filter(Boolean).join('\n\n') || 'No performer data available'}

**NEWS INSIGHTS** (Betting-relevant):
${Object.entries(realData.newsInsights || {})
  .filter(([team]) => activeTeams.has(team))
  .map(([team, insight]) => {
    return `${team}:\n${insight.insights}\nSentiment: ${insight.sentiment}${insight.injuries.length > 0 ? `\nInjuries mentioned: ${insight.injuries.join(', ')}` : ''}`;
  }).join('\n\n') || 'No news insights available'}

**=== END VERIFIED DATA ===**

`;
    }

    // Build historical lessons section if provided
    let lessonsSection = '';
    if (historicalLessons && historicalLessons.length > 0) {
      lessonsSection = `
**=== HISTORICAL LESSONS (LEARN FROM PAST OUTCOMES) ===**

${historicalLessons.map((lesson, idx) => `
**Lesson ${idx + 1}**: ${lesson.sport} ${lesson.bet_type}
- Pick: ${lesson.pick}
- Outcome: ${lesson.actual_outcome.toUpperCase()}
- Analysis: ${lesson.post_analysis || 'No analysis available'}
- Key Insight: ${lesson.lessons_learned?.recommendations?.[0] || 'See full analysis'}
`).join('\n')}

**LEARNING DIRECTIVE**: 
- Use these past outcomes to inform your current analysis
- Avoid similar mistakes that led to losses
- Replicate patterns that led to wins
- Adjust confidence based on historical performance of similar picks

**=== END HISTORICAL LESSONS ===**

`;
    }

    return `${realDataSection}${lessonsSection}You are an ANALYTICAL EDGE DETECTOR, not a pick justifier. Your job is to find genuine market inefficiencies and analytical advantages.

**EDGE DETECTION MISSION**: ${edgeDetectionFramework[riskLevel]}
**Risk Profile**: ${riskLevel}

**ANALYTICAL FRAMEWORK - Find these specific edges**:

1. **LINE VALUE EDGES**:
   - Spreads that don't match team strength (e.g., good team getting too many points)
   - Totals that contradict pace/defensive stats
   - Moneylines with hidden value due to public bias

2. **SITUATIONAL EDGES**:
   - Revenge games, lookahead spots, scheduling advantages
   - Weather impacts not priced into totals
   - Rest/travel disadvantages affecting performance

3. **INFORMATION EDGES**:
   - Key injuries not fully reflected in lines
   - Lineup changes affecting team dynamics
   - Recent performance trends vs market perception

4. **CONTRARIAN EDGES**:
   - Public heavily on one side, create value on the other
   - Media narratives creating betting bias
   - Overreactions to recent events

**CRITICAL ANALYSIS RULES**:
- NEVER justify both sides - find the ONE side with actual edge
- Confidence must reflect genuine analytical conviction, not hope
- Look for CONTRADICTIONS between research and betting lines

**⚠️ MANDATORY DATA USAGE RULES - FOLLOW THESE EXACTLY (VIOLATIONS AUTO-FAIL):**

1. **ALWAYS cite team W-L records** from the "Team Records" section above when analyzing matchups
2. **ALWAYS reference news article titles** from the "Recent News Articles" section when available
3. **NEVER make up:** ATS records, injury details, player stats, recent scores, or any data not provided above
4. **For PLAYER PROPS:** You MUST call get_player_stats() to retrieve concrete stats (avg receptions, yards, TDs). If get_player_stats() reports that NO stats are available for a player, you MUST NOT recommend ANY prop for that player. You MUST choose a different player or market with real stats.
   - Forbidden hedging phrases include (but are not limited to): "data not available in cache", "leans more on matchup context than hard volume numbers", "limited stat history", or any wording that admits missing stats but still recommends the prop.
5. **Example of GOOD reasoning:** "Ravens (9-3) host Bengals (5-7). Ravens -6.5 offers value given their superior record. Recent news: 'Ravens defense dominates in Week 12' suggests strong form. Bengals allow 27ppg per their record."
6. **Example of BAD reasoning:** "Ravens are 8-2 ATS this season" (made-up stat), "Lamar Jackson threw for 300 yards last week" (not provided), "Detailed recent stat splits are not available in the cache" (hedging - skip the pick instead)

**Games & Market Analysis**:
${analyticalContext}

**Your Task**: 
1. Analyze each game using the VERIFIED DATA above (team records + news articles)
2. Find ${numSuggestions} picks with analytical edges
3. BE GENEROUS: We need diversity - include picks where odds offer value even if edge is moderate
4. CITE the actual data: Mention team records (e.g., "Lions 10-1"), news headlines, and odds value
5. **IMPORTANT**: You'll see BOTH sides of each bet (e.g., Chiefs ML AND Bills ML). Compare them and pick the ONE side with better value. Never return both sides of the same matchup.

**Return format**:
{
  "analytical_summary": "Brief explanation of edge-detection approach used",
  "picks": [
    {
      "id": "pick_id_from_above",
      "gameDate": "ISO date", 
      "sport": "NFL|NBA|etc",
      "homeTeam": "Team Name",
      "awayTeam": "Team Name", 
      "betType": "Moneyline|Spread|Total|etc",
      "pick": "Team/Player or Over/Under",
      "point": "For Spread: +6.5 or -3.5, For Total: 47.5, For Moneyline: null",
      "odds": "American odds like -112, +140, -200",
      "spread": "Game spread for context (favorite perspective)",
      "confidence": 6-9,
      "edge_type": "line_value|situational|information|contrarian",
      "reasoning": "2-4 sentences. MUST cite team W-L records from data above. MUST reference news headlines if available. MUST explain odds value. Example: 'Lions (10-1) getting -3.5 vs Bears (4-7) offers strong value. Recent news: \"Lions offense averages 31ppg\" shows their firepower. Bears weak 4-7 record suggests they're overmatched. Line seems tight given record disparity.'",
      "contrary_evidence": "1-2 sentences: What evidence contradicts this pick?"
    }
  ]
}

**IMPORTANT**: Return AT LEAST ${numSuggestions} picks (aim for ${Math.ceil(numSuggestions * 1.5)}) unless there are fewer games available. Return ONLY valid JSON.`;
  }
}


module.exports = { ParlayAnalyst };
