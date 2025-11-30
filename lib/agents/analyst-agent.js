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
  async selectBestPicks({ picks, numSuggestions, riskLevel, betTypes, apiKey, realData = null, historicalLessons = [] }) {
    console.log(`\n🤖 AI analyzing ${picks.length} picks to select best ${numSuggestions}...`);
    if (historicalLessons.length > 0) {
      console.log(`   📚 Using ${historicalLessons.length} historical lessons`);
    }
    
    // Build prompt for AI to rank picks WITH REAL DATA + HISTORICAL LESSONS
    const prompt = this.buildPickSelectionPrompt(picks, numSuggestions, riskLevel, betTypes, realData, historicalLessons);
    
    // Call OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: `You are an expert sports betting analyst. You MUST follow these STRICT rules:

1. ONLY use data explicitly provided in the prompt (Team Records, Recent News, Research)
2. DO NOT make up or estimate: ATS records, injury reports, recent game stats, or player performance data
3. DO NOT say "5-1 in last 6 games" or "missing key players" unless explicitly stated in the data
4. If specific data is not provided, focus on: odds value, matchup dynamics, and general team strength from W-L record
5. Be creative and analytical, but ONLY with the data given

Your analysis should be insightful and varied, but 100% grounded in provided facts. Return ONLY valid JSON.` },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: "json_object" }
      })
    });
    
    if (!response.ok) {
      throw new Error(`OpenAI API failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    
    // Parse AI response
    let result;
    try {
      result = JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse AI response:', content);
      throw new Error('AI returned invalid JSON');
    }
    
    // Format picks for frontend with analytical edge context
    const selectedPicks = (result.picks || []).map(pick => {
      const basePick = picks.find(p => p.id === pick.id) || {};
      const researchSummary = pick.researchSummary || basePick.research || '';

      return {
        id: pick.id,
        gameDate: pick.gameDate,
        sport: pick.sport,
        homeTeam: pick.homeTeam,
        awayTeam: pick.awayTeam,
        betType: pick.betType,
        pick: pick.pick,
        odds: pick.odds,
        spread: pick.spread, // Always include spread for context
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
    
    const analyticalContext = Array.from(gameGroups.values()).map((group, idx) => {
      const moneylineOptions = group.picks.filter(p => p.betType === 'Moneyline');
      const spreadOptions = group.picks.filter(p => p.betType === 'Spread');
      const totalOptions = group.picks.filter(p => p.betType === 'Total');
      const propOptions = group.picks.filter(p => p.betType.includes('Player') || p.betType.includes('Props'));
      
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
      
      return `${idx + 1}. ${group.game} (${new Date(group.date).toLocaleDateString()})
   Markets: ${marketAnalysis.join(' | ')}
   Research: "${group.research.substring(0, 800)}" 
   Props Available: ${propOptions.length} options
   ALL PICKS: ${group.picks.map(p => `${p.id}:${p.betType}-${p.pick}@${p.odds}`).join(', ')}`;
    }).join('\n\n');
    
    // Build real data section if provided
    let realDataSection = '';
    if (realData) {
      realDataSection = `
**=== VERIFIED DATA (USE ONLY THIS) ===**

**INJURY REPORTS** (Current - API-Sports):
${Object.entries(realData.injuries || {}).map(([team, injuries]) => {
  if (!injuries || injuries.length === 0) return '';
  return `\n${team}:\n${injuries.map(inj => `  - ${inj.player} (${inj.position}): ${inj.status} - ${inj.injury || 'Undisclosed'}`).join('\n')}`;
}).filter(Boolean).join('\n') || 'No current injuries reported'}

**Team Records & Standings** (API-Sports):
${Object.entries(realData.teamRecords || {}).map(([team, data]) => {
  if (typeof data === 'object' && data.winPercentage !== undefined) {
    // API-Sports format (detailed)
    return `- ${team}: ${data.record} (${(data.winPercentage * 100).toFixed(1)}%) | ${data.conference || ''} ${data.division || ''} Rank: #${data.divisionRank || 'N/A'} | Point Diff: ${data.pointDifferential > 0 ? '+' : ''}${data.pointDifferential} | Streak: ${data.streak || 'N/A'}`;
  } else {
    // Simple format (fallback)
    return `- ${team}: ${data.record || `${data.wins}-${data.losses}`}`;
  }
}).join('\n') || 'No records available'}

**Recent News Articles (Last 7 Days) - SEARCH THROUGH THESE**:
${Object.entries(realData.recentNews || {}).map(([team, articles]) => {
  return `\n${team}:\n${articles.map(a => `  • [${a.source}] ${a.title} (${a.date})\n    ${a.content}`).join('\n')}`;
}).join('\n') || 'No recent news available'}

**STRICT RULES**:
${(realData.verifiedFacts || []).map(f => `- ${f}`).join('\n')}

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

**⚠️ MANDATORY DATA USAGE RULES - FOLLOW THESE EXACTLY:**

1. **ALWAYS cite team W-L records** from the "Team Records" section above when analyzing matchups
2. **ALWAYS reference news article titles** from the "Recent News Articles" section when available
3. **NEVER make up:** ATS records, injury details, player stats, recent scores, or any data not provided above
4. **Example of GOOD reasoning:** "Ravens (9-3) host Bengals (5-7). Ravens -6.5 offers value given their superior record. Recent news: 'Ravens defense dominates in Week 12' suggests strong form. Bengals allow 27ppg per their record."
5. **Example of BAD reasoning:** "Ravens are 8-2 ATS this season" (made-up stat), "Lamar Jackson threw for 300 yards last week" (not provided)

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
      "odds": "American odds",
      "spread": "Context spread or null",
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
