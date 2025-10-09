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

  generateAIPrompt({ selectedSports, selectedBetTypes, numLegs, riskLevel, oddsData, unavailableInfo, dateRange, aiModel = 'openai' }) {
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
      const items = oddsData.slice(0, 20).map((ev, idx) => {
        const gameDate = formatDate(ev.commence_time);
        const teams = `${ev.away_team || '?'} @ ${ev.home_team || '?'}`;
        const bm = (ev.bookmakers && ev.bookmakers[0]) || null;
        
        let marketsSummary = 'no-odds';
        if (bm && bm.markets && bm.markets.length > 0) {
          marketsSummary = bm.markets.map(market => {
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
    } else {
      oddsContext = '\n\n⚠️ NO LIVE ODDS DATA AVAILABLE';
    }

    let marketAvailabilityNote = '';
    if (unavailableInfo && unavailableInfo.length > 0) {
      marketAvailabilityNote = `\n\n⚠️ LIMITED MARKETS: ${unavailableInfo.join(', ')} may have limited options.`;
    }

    if (aiModel === 'gemini') {
      return this.generateGeminiPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, today, dateRangeText, marketAvailabilityNote, oddsContext });
    } else {
      return this.generateOpenAIPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, today, dateRangeText, marketAvailabilityNote, oddsContext });
    }
  }

  generateOpenAIPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, today, dateRangeText, marketAvailabilityNote, oddsContext }) {
    return `
You are an expert sports betting analyst who uses research data and odds analysis to build informed parlays.

PARLAY REQUEST:
- Create exactly ${numLegs} legs  
- Sports: ${sportsStr}
- Bet types: ${betTypesStr}
- Risk level: ${riskLevel}
- Time window: Next ${dateRangeText}

ANALYSIS REQUIREMENTS:
1. USE ONLY THE PROVIDED ODDS DATA BELOW
2. Each leg MUST be from a different game
3. USE ONLY THE ACTUAL ODDS PROVIDED
4. CONSIDER THE RESEARCH DATA when making picks - injuries, trends, recent form are CRITICAL factors
5. In your reasoning, reference specific research insights when available
6. Reference research data in reasoning when available

CRITICAL CONFLICT PREVENTION RULES:
- If you pick Team A moneyline, DO NOT pick Team B moneyline in same game
- If you pick Team A spread, DO NOT pick Team B spread in same game  
- If you pick Team A moneyline, DO NOT pick Team A spread in same game
- If you pick OVER total, DO NOT pick UNDER total in same game
- If you pick player OVER prop, DO NOT pick same player UNDER prop
- NO conflicting bets from the same game
- Each leg must be from a DIFFERENT game
- NO duplicate bet types on same team/player
- ABSOLUTELY NO same team appearing in multiple legs with different bet types

EXAMPLES OF FORBIDDEN CONFLICTS:
❌ Giants moneyline + Giants spread = FORBIDDEN
❌ Cowboys +3.5 + Eagles -3.5 (same game) = FORBIDDEN  
❌ Over 45.5 + Under 45.5 (same game) = FORBIDDEN
❌ Player Over 250 yards + Player Under 250 yards = FORBIDDEN

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
   Odds: [Exact odds]
   Confidence: X/10
   Reasoning: Why this will hit (cite research data)

2. 📅 DATE: MM/DD/YYYY
   Game: Away Team @ Home Team
   Bet: Specific bet with line
   Odds: [Exact odds]
   Confidence: X/10
   Reasoning: Why this will hit (cite research data)

[Continue for ${numLegs} total legs]

**Combined Odds:** [WILL BE CALCULATED AUTOMATICALLY]
**Payout on $100:** $[WILL BE CALCULATED AUTOMATICALLY]
**Overall Confidence:** X/10

---

**🔒 BONUS LOCK PARLAY: [Title]**

**Legs:**
[Same format, 2-3 safer picks based on research and odds]

**Combined Odds:** [WILL BE CALCULATED AUTOMATICALLY]
**Payout on $100:** $[WILL BE CALCULATED AUTOMATICALLY]
**Why These Are Locks:** [Brief data backed explanation citing research]

TONE: Professional with subtle humor. Be concise but reference research insights.
`.trim();
  }

  generateGeminiPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, today, dateRangeText, marketAvailabilityNote, oddsContext }) {
    return `
You are a professional sports betting analyst. Your task is to create exactly ${numLegs} parlay legs using the provided data.

STRICT REQUIREMENTS:
1. ⚠️ MANDATORY: Create EXACTLY ${numLegs} legs - no more, no less ⚠️
2. Use ONLY games and odds from the data below
3. Each leg must have: Date (MM/DD/YYYY), Game, Bet, Odds, Confidence (1-10), Reasoning
4. Use different games for each leg - NO REPEATING GAMES
5. Include variety in bet types if multiple types are available
6. MANDATORY: Reference specific research data in reasoning when available
7. NEVER use generic reasons like "winning record" or "home field advantage"
8. ALWAYS cite injury reports, recent performance, or specific research insights
9. ⚠️ COUNT YOUR LEGS: Must be exactly ${numLegs} legs total ⚠️

RESEARCH ANALYSIS REQUIREMENTS:
- When research data is provided (📰 RESEARCH: section), you MUST reference it
- Cite specific injuries, lineup changes, recent form, head-to-head trends
- Base confidence levels on concrete data points from research
- Avoid generic analysis - use the provided research insights
- If no research is available for a game, acknowledge it and be more conservative

CRITICAL CONFLICT PREVENTION RULES:
- If you pick Team A moneyline, DO NOT pick Team B moneyline in same game
- If you pick Team A spread, DO NOT pick Team B spread in same game  
- If you pick Team A moneyline, DO NOT pick Team A spread in same game
- If you pick OVER total, DO NOT pick UNDER total in same game
- If you pick player OVER prop, DO NOT pick same player UNDER prop
- NO conflicting bets from the same game
- Each leg must be from a DIFFERENT game
- NO duplicate bet types on same team/player
- ABSOLUTELY NO same team appearing in multiple legs with different bet types

EXAMPLES OF FORBIDDEN CONFLICTS:
❌ Giants moneyline + Giants spread = FORBIDDEN
❌ Cowboys +3.5 + Eagles -3.5 (same game) = FORBIDDEN  
❌ Over 45.5 + Under 45.5 (same game) = FORBIDDEN
❌ Player Over 250 yards + Player Under 250 yards = FORBIDDEN

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

**Combined Odds:** [WILL BE CALCULATED AUTOMATICALLY]
**Payout on $100:** $[WILL BE CALCULATED AUTOMATICALLY]
**Why These Are Locks:** [Brief data backed explanation citing research]

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
            { role: 'system', content: 'You are an expert sports betting analyst who uses research data and odds analysis to build informed parlays.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
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
          generationConfig: { temperature: 0.7, maxOutputTokens: 3500 }
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