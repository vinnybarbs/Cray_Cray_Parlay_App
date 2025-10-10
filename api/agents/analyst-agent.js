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
          // For prop markets, show actual outcomes. For regular markets, just show count
          marketsSummary = bm.markets.map(m => {
            const isPropMarket = m.key.startsWith('player_') || m.key.startsWith('team_');
            if (isPropMarket && m.outcomes && m.outcomes.length > 0) {
              // Show first 5 outcomes for props - use description (player name) not name (Yes/No)
              const samples = m.outcomes.slice(0, 5).map(o => {
                const label = o.description || o.name;
                return `${label}(${o.price})`;
              }).join(', ');
              const more = m.outcomes.length > 5 ? ` +${m.outcomes.length - 5} more` : '';
              return `${m.key}: ${samples}${more}`;
            }
            return `${m.key}(${m.outcomes?.length || 0})`;
          }).join('\n   ');
        }

        // Add research context if available (condensed)
        let researchSummary = '';
        if (ev.research) {
          // Extract key injury/performance insights (first 200 chars)
          const shortResearch = ev.research.substring(0, 200).replace(/\s+/g, ' ').trim();
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
    
    return `${retry}Create ${numLegs}-leg parlay for ${sportsStr}.

RULES:
- EXACTLY ${numLegs} legs
- Bet types: ${betTypesStr}
- Use EXACT dates/odds from data
- No conflicts
- Risk: ${riskLevel}
${oddsContext}

FORMAT:
**🎯 ${numLegs}-Leg Parlay: [Title]**

**Legs:**
1. 📅 DATE: [MM/DD/YYYY]
   Game: [Away @ Home]
   Bet: [bet with line]
   Odds: [odds]
   Confidence: 7/10
   Reasoning: [why]

**Combined Odds:** +XXX
**Payout on $100:** $XXX

===BEGIN_PARLAY_JSON===
{"parlay": {"title": "[Title]", "legs": [{"date": "MM/DD/YYYY", "game": "Away @ Home", "bet": "[bet]", "odds": "+100", "confidence": 7, "citations": []}]}, "lockParlay": {"legs": []}}
===END_PARLAY_JSON===
`.trim();
  }

  generateGeminiPrompt({ sportsStr, betTypesStr, numLegs, riskLevel, oddsContext, attemptNumber, retryIssues }) {
    const retry = attemptNumber > 1 ? `RETRY ${attemptNumber}: ${retryIssues}\n\n` : '';
    
    return `${retry}Create ${numLegs}-leg parlay for ${sportsStr}.

RULES:
- EXACTLY ${numLegs} legs  
- Bet types: ${betTypesStr}
- Use EXACT dates/odds from data
- No conflicts
- Risk: ${riskLevel}
${oddsContext}

FORMAT:
**🎯 ${numLegs}-Leg Parlay: [Title]**

**Legs:**
1. 📅 DATE: [MM/DD/YYYY]
   Game: [Away @ Home]
   Bet: [bet with line]
   Odds: [odds]
   Confidence: 7/10
   Reasoning: [why]

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
