// Parlay Analyst Agent - compact, valid implementation
class ParlayAnalyst {
  constructor() {
    this.conflictRules = [
      'NO same team moneyline + spread',
      'NO opposing teams same game same market',
      'NO over/under same game same total',
      'NO same player over/under same prop',
    ];
  }

  // Minimal prompt builder to summarize inputs
  generateAIPrompt({ selectedSports = [], selectedBetTypes = [], numLegs = 3, riskLevel = 'Medium', oddsData = [] } = {}) {
    const sportsStr = Array.isArray(selectedSports) ? selectedSports.join(', ') : String(selectedSports);
    const betTypesStr = Array.isArray(selectedBetTypes) ? selectedBetTypes.join(', ') : String(selectedBetTypes);
    const gamesCount = Array.isArray(oddsData) ? oddsData.length : 0;
    return `Create up to ${numLegs} parlay legs for ${sportsStr || 'any sport'} using bet types: ${betTypesStr || 'any'}. Risk: ${riskLevel}. Available games: ${gamesCount}. Use one leg per game.`;
  }

  generateOpenAIPrompt(opts) {
    return this.generateAIPrompt(opts);
  }

  generateGeminiPrompt(opts) {
    return this.generateAIPrompt(opts);
  }

  // Lightweight AI call helper (keeps expected behavior)
  async generateParlayWithAI(prompt, aiModel, fetcher, openaiKey, geminiKey) {
    let content = '';

    if (aiModel === 'openai') {
      if (!openaiKey) throw new Error('Server missing OPENAI_API_KEY');
      const response = await fetcher('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an expert sports betting analyst who uses research data and odds analysis to build informed parlays.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 1500,
        }),
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
          generationConfig: { temperature: 0.7, maxOutputTokens: 1500 },
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