// Serverless endpoint for generating parlays.
// Runs on Vercel (or any Node server) and keeps API keys server-side.
// Prefer the runtime/global fetch when available. We'll dynamically import node-fetch
// inside the handler only if needed to avoid top-level import failures on some hosts.

const SPORT_SLUGS = {
  NFL: 'americanfootball_nfl',
  NBA: 'basketball_nba',
  MLB: 'baseball_mlb',
  NHL: 'icehockey_nhl',
  Soccer: 'soccer_epl',
  NCAAF: 'americanfootball_ncaaf',
  'PGA/Golf': 'golf_pga',
  Tennis: 'tennis_atp',
};

const MARKET_MAPPING = {
  'Moneyline/Spread': ['h2h', 'spreads'],
  'Totals (O/U)': ['totals'],
  'Player Props': ['player_points'],
  'Team Props': ['team_points'],
};

const BOOKMAKER_MAPPING = {
  DraftKings: 'draftkings',
  FanDuel: 'fanduel',
  MGM: 'mgm',
  Caesars: 'caesars',
  Bet365: 'bet365',
};

const RISK_LEVEL_DEFINITIONS = {
  Low: "High probability to hit, heavy favorites, +200 to +400 odds, confidence 8/10+",
  Medium: "Balanced value favorites with moderate props, +400 to +600 odds",
  High: "Value underdogs and high-variance outcomes, +600+ odds",
};

function generateAIPrompt({ selectedSports, selectedBetTypes, numLegs, oddsData }) {
  const sportsStr = (selectedSports || []).join(', ');
  const betTypesStr = (selectedBetTypes || []).join(', ');

  const oddsContext = oddsData && oddsData.length > 0
    ? `\n\n**Supplemental Odds Data (use if available)**:\n${JSON.stringify(oddsData.slice(0, 10), null, 2)}`
    : '';

  return `
You are a professional sports betting analyst.
Generate exactly ${numLegs}-leg parlays for today. Include a bonus lock parlay.

Rules:
1. Only include sports: ${sportsStr}
2. Only include bet types: ${betTypesStr}
3. Include real matchups with current odds if possible
4. Provide confidence 1-10 for each leg
5. Include concise degenerate humor in the parlay title or intro
6. Output structured format exactly as below

Format:
**Parlay Title**: [Funny/degenerate title]
**Legs**:
1. Game: [Team vs Team] - Bet Type: [Type] - Odds: [XXX] - Confidence: [X/10] - Notes: [Stats/Trends]
...
**Combined Odds**: [Total]
**Payout on $100**: [XXX]

**Bonus Lock Parlay**:
1. Game: [Team vs Team] - Bet Type: [Type] - Odds: [XXX] - Confidence: [X/10] - Notes: [Why safe]
...
**Combined Odds**: [Total]
**Reasoning**: [Concise explanation]

${oddsContext}

Tone: Serious picks, full personality, concise degenerate-style humor.
`.trim();
}

export default async function handler(req, res) {
  // Resolve a fetch implementation: prefer globalThis.fetch, otherwise dynamic-import node-fetch
  let fetcher = globalThis.fetch;
  if (!fetcher) {
    try {
      const nf = await import('node-fetch');
      fetcher = nf.default || nf;
    } catch (err) {
      console.error('Could not load fetch implementation:', err);
      return res.status(500).json({ error: 'Server missing fetch implementation' });
    }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { selectedSports = [], selectedBetTypes = [], numLegs = 3, oddsPlatform = 'DraftKings', aiModel = 'openai' } = req.body || {};

  // Server-side keys (must be set in Vercel as OPENAI_API_KEY / GEMINI_API_KEY / ODDS_API_KEY)
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const ODDS_KEY = process.env.ODDS_API_KEY;

  // Allow configurable model fallback lists via env, comma-separated.
  const OPENAI_MODELS = (process.env.OPENAI_MODELS || 'gpt-4o-mini,gpt-4o,gpt-4,gpt-3.5-turbo').split(',').map(s => s.trim()).filter(Boolean);
  const GEMINI_MODELS = (process.env.GEMINI_MODELS || 'gemini-1.5-flash-latest,gemini-1.5,gemini-1.0,chat-bison-001,text-bison-001').split(',').map(s => s.trim()).filter(Boolean);

  if (!ODDS_KEY) return res.status(500).json({ error: 'Server missing ODDS_API_KEY' });

  try {
    // Fetch odds server-side
    const oddsResults = [];
    const selectedBookmaker = BOOKMAKER_MAPPING[oddsPlatform];

    for (const sport of selectedSports) {
      const slug = SPORT_SLUGS[sport];
      const markets = (selectedBetTypes || []).flatMap(bt => MARKET_MAPPING[bt] || []).join(',');
      if (!markets) continue;
      const url = `https://api.the-odds-api.com/v4/sports/${slug}/odds/?regions=us&markets=${encodeURIComponent(markets)}&oddsFormat=american&bookmakers=${selectedBookmaker}&apiKey=${ODDS_KEY}`;
  const r = await fetcher(url);
      if (!r.ok) continue;
      const data = await r.json();
      if (Array.isArray(data)) oddsResults.push(...data);
    }

    const prompt = generateAIPrompt({ selectedSports, selectedBetTypes, numLegs, oddsData: oddsResults });

    // Diagnostic mode: don't call any AI provider, return odds + prompt
    const diagnose = req.query?.diagnose === 'true' || req.body?.diagnose === true;
    if (diagnose) return res.status(200).json({ prompt, oddsResults });

    // Call AI provider with model fallback logic
    let content = '';
    const tryOpenAIModel = async (model) => {
  const response = await fetcher('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are a concise sports betting analyst producing actionable parlays.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 2000
        })
      });
      return response;
    };

    const tryGeminiModel = async (model) => {
      const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${GEMINI_KEY}`;
  const response = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2000 }
        })
      });
      return response;
    };

    if (aiModel === 'openai') {
      if (!OPENAI_KEY) return res.status(500).json({ error: 'Server missing OPENAI_API_KEY' });

      let lastErrText = '';
      for (const model of OPENAI_MODELS) {
        try {
          const response = await tryOpenAIModel(model);
          if (!response.ok) {
            lastErrText = await response.text();
            // If 401 (invalid key) stop trying other models
            if (response.status === 401) return res.status(401).json({ error: `OpenAI error: ${lastErrText}` });
            // otherwise try next model
            continue;
          }
          const data = await response.json();
          content = data.choices?.[0]?.message?.content || JSON.stringify(data);
          break;
        } catch (err) {
          lastErrText = err.message || String(err);
          continue;
        }
      }
      if (!content) return res.status(500).json({ error: `OpenAI all-models-failed: ${lastErrText}` });

    } else if (aiModel === 'gemini') {
      if (!GEMINI_KEY) return res.status(500).json({ error: 'Server missing GEMINI_API_KEY' });

      let lastErrText = '';
      for (const model of GEMINI_MODELS) {
        try {
          const response = await tryGeminiModel(model);
          if (!response.ok) {
            lastErrText = await response.text();
            // If 404 (model not found) try next model; if 401 (invalid key) stop
            if (response.status === 401) return res.status(401).json({ error: `Gemini error: ${lastErrText}` });
            continue;
          }
          const data = await response.json();
          content = data.candidates?.[0]?.content?.parts?.[0]?.text || data.output?.[0]?.content?.[0]?.text || JSON.stringify(data);
          break;
        } catch (err) {
          lastErrText = err.message || String(err);
          continue;
        }
      }

      // If Gemini failed across models, return a clear Gemini error (no OpenAI fallback)
      if (!content) {
        return res.status(500).json({ error: `Gemini all-models-failed: ${lastErrText}` });
      }
    }

    return res.status(200).json({ content });
  } catch (err) {
    console.error('generate-parlay error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
