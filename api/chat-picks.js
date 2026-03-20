/**
 * Chat-based AI Pick Generator
 * Users describe what they want in natural language, AI queries the database
 * and returns personalized betting suggestions.
 */

const { logger } = require('../shared/logger');
const { supabase } = require('../lib/middleware/supabaseAuth');
const aiInstructions = require('../lib/services/ai-instructions');

// OpenAI function tools that the AI can call to query our database
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_odds',
      description: 'Search for betting odds in our database. Returns available games and their odds.',
      parameters: {
        type: 'object',
        properties: {
          sport: { type: 'string', description: 'Sport slug: basketball_nba, basketball_ncaab, americanfootball_nfl, icehockey_nhl, baseball_mlb, soccer_epl' },
          team: { type: 'string', description: 'Optional team name to filter by (e.g. "Lakers", "Duke")' },
          market_type: { type: 'string', description: 'Market type: h2h (moneyline), spreads, totals, player_points, player_rebounds, player_assists, player_pass_yds, player_rush_yds, player_receptions' },
          bookmaker: { type: 'string', description: 'Bookmaker: draftkings or fanduel. Default draftkings.' }
        },
        required: ['sport']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_team_stats',
      description: 'Get team record, rankings, and recent performance from our database.',
      parameters: {
        type: 'object',
        properties: {
          team_name: { type: 'string', description: 'Team name (e.g. "Duke Blue Devils", "Los Angeles Lakers")' }
        },
        required: ['team_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_news',
      description: 'Get latest news and intelligence for a sport or team.',
      parameters: {
        type: 'object',
        properties: {
          sport: { type: 'string', description: 'Sport code: NFL, NBA, NCAAB, NHL, MLB' },
          team_name: { type: 'string', description: 'Optional team name to filter news' }
        },
        required: ['sport']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_upcoming_games',
      description: 'List upcoming games for a sport within the next few days.',
      parameters: {
        type: 'object',
        properties: {
          sport: { type: 'string', description: 'Sport slug: basketball_nba, basketball_ncaab, americanfootball_nfl, etc.' },
          days: { type: 'number', description: 'How many days ahead to look (1-7). Default 2.' }
        },
        required: ['sport']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_game_analysis',
      description: 'Get pre-computed AI analysis for a specific matchup.',
      parameters: {
        type: 'object',
        properties: {
          home_team: { type: 'string', description: 'Home team name' },
          away_team: { type: 'string', description: 'Away team name' }
        },
        required: ['home_team', 'away_team']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_injuries',
      description: 'Get current injury reports for teams in a sport. Returns detailed injury status from ESPN.',
      parameters: {
        type: 'object',
        properties: {
          sport: { type: 'string', description: 'Sport code: NBA, NCAAB, NHL, MLB' },
          team_name: { type: 'string', description: 'Optional specific team name' }
        },
        required: ['sport']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_scores',
      description: 'Get recent game scores and results for a sport. Useful for understanding form and momentum.',
      parameters: {
        type: 'object',
        properties: {
          sport: { type: 'string', description: 'Sport code: NBA, NCAAB, NHL, MLB' }
        },
        required: ['sport']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_standings',
      description: 'Get current standings/rankings for a sport.',
      parameters: {
        type: 'object',
        properties: {
          sport: { type: 'string', description: 'Sport code: NBA, NCAAB, NHL, MLB' }
        },
        required: ['sport']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_model_performance',
      description: 'Check how our AI model has been performing recently - win rates by sport and bet type.',
      parameters: {
        type: 'object',
        properties: {
          sport: { type: 'string', description: 'Optional sport filter' },
          days: { type: 'number', description: 'Look back period in days. Default 7.' }
        }
      }
    }
  }
];

// Execute tool calls against Supabase
async function executeTool(name, args) {
  try {
    switch (name) {
      case 'search_odds': {
        const now = new Date().toISOString();
        const bookmaker = args.bookmaker || 'draftkings';
        let query = supabase
          .from('odds_cache')
          .select('sport, home_team, away_team, market_type, bookmaker, outcomes, commence_time, external_game_id')
          .eq('sport', args.sport)
          .eq('bookmaker', bookmaker)
          .gt('commence_time', now)
          .order('commence_time', { ascending: true })
          .limit(30);

        if (args.market_type) query = query.eq('market_type', args.market_type);
        if (args.team) query = query.or(`home_team.ilike.%${args.team}%,away_team.ilike.%${args.team}%`);

        const { data, error } = await query;
        if (error) return { error: error.message };

        return data?.map(row => ({
          game: `${row.away_team} @ ${row.home_team}`,
          time: row.commence_time,
          market: row.market_type,
          bookmaker: row.bookmaker,
          outcomes: typeof row.outcomes === 'string' ? JSON.parse(row.outcomes) : row.outcomes
        })) || [];
      }

      case 'get_team_stats': {
        // Check current_standings
        const { data: standings } = await supabase
          .from('current_standings')
          .select('*')
          .ilike('team_name', `%${args.team_name}%`)
          .limit(3);

        // Check game_analysis for recent insights
        const { data: analysis } = await supabase
          .from('game_analysis')
          .select('home_team, away_team, analysis_text, game_date')
          .or(`home_team.ilike.%${args.team_name}%,away_team.ilike.%${args.team_name}%`)
          .gte('game_date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
          .order('game_date', { ascending: false })
          .limit(3);

        // Get injury report from news_cache
        const { data: injuries } = await supabase
          .from('news_cache')
          .select('summary, last_updated')
          .eq('search_type', 'injuries')
          .ilike('team_name', `%${args.team_name}%`)
          .order('last_updated', { ascending: false })
          .limit(1);

        // Get recent scores involving this team
        const { data: recentScores } = await supabase
          .from('news_cache')
          .select('summary, last_updated')
          .eq('search_type', 'recent_results')
          .order('last_updated', { ascending: false })
          .limit(1);

        // Filter scores mentioning this team
        let teamScores = null;
        if (recentScores?.[0]?.summary) {
          const lines = recentScores[0].summary.split('\n')
            .filter(l => l.toLowerCase().includes(args.team_name.toLowerCase().split(' ').pop()));
          if (lines.length > 0) teamScores = lines.join('\n');
        }

        return {
          standings: standings || [],
          injuries: injuries?.[0]?.summary || 'No injury data available',
          recentScores: teamScores || 'No recent scores found',
          recentAnalysis: analysis?.map(a => ({
            matchup: `${a.away_team} @ ${a.home_team}`,
            date: a.game_date,
            analysis: a.analysis_text?.substring(0, 500)
          })) || []
        };
      }

      case 'get_news': {
        // Get team-specific intelligence (injuries for NBA/NHL/MLB)
        let teamIntel = [];
        if (args.team_name) {
          const { data } = await supabase
            .from('news_cache')
            .select('sport, team_name, search_type, summary, last_updated')
            .eq('sport', args.sport)
            .ilike('team_name', `%${args.team_name}%`)
            .order('last_updated', { ascending: false })
            .limit(5);
          teamIntel = data || [];
        }

        // ALWAYS get sport-level data (recent scores, standings, upcoming games)
        const { data: sportLevel } = await supabase
          .from('news_cache')
          .select('sport, team_name, search_type, summary, last_updated')
          .eq('sport', args.sport)
          .in('search_type', ['recent_results', 'standings', 'upcoming_games'])
          .order('last_updated', { ascending: false })
          .limit(5);

        const newsCache = [...teamIntel, ...(sportLevel || [])];

        // Get articles — prefer enriched but also include recent unenriched ones
        let articlesQuery = supabase
          .from('news_articles')
          .select('title, published_at, betting_summary, injury_mentions, sentiment, summary')
          .gte('published_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
          .order('published_at', { ascending: false })
          .limit(15);

        // Filter by sport keyword in title if possible
        if (args.sport) {
          const sportKeywords = {
            'NBA': 'NBA,Lakers,Celtics,basketball,Knicks,Warriors',
            'NCAAB': 'NCAA,March Madness,college basketball,tournament,bracket,seed',
            'NHL': 'NHL,hockey,Bruins,Rangers',
            'MLB': 'MLB,baseball,Yankees,Dodgers',
            'NFL': 'NFL,football,Super Bowl'
          };
          // If team name provided, add it to keywords
          if (args.team_name) {
            const teamKeyword = args.team_name.split(' ').pop(); // Last word (nickname)
            const existing = sportKeywords[args.sport] || '';
            sportKeywords[args.sport] = existing ? `${existing},${teamKeyword}` : teamKeyword;
          }
          const keywords = sportKeywords[args.sport];
          if (keywords) {
            const orFilter = keywords.split(',').map(k => `title.ilike.%${k}%`).join(',');
            articlesQuery = articlesQuery.or(orFilter);
          }
        }

        const { data: articles } = await articlesQuery;

        return {
          intelligence: newsCache?.map(n => ({
            team: n.team_name,
            type: n.search_type,
            data: n.summary?.substring(0, 500),
            updated: n.last_updated
          })) || [],
          articles: articles?.map(a => ({
            title: a.title,
            date: a.published_at,
            bettingSummary: a.betting_summary || null,
            injuries: a.injury_mentions || null,
            sentiment: a.sentiment || null,
            summary: a.summary?.substring(0, 200) || null
          })) || []
        };
      }

      case 'get_upcoming_games': {
        const days = args.days || 2;
        const now = new Date().toISOString();
        const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

        const { data } = await supabase
          .from('odds_cache')
          .select('home_team, away_team, commence_time, market_type, outcomes')
          .eq('sport', args.sport)
          .eq('market_type', 'h2h')
          .eq('bookmaker', 'draftkings')
          .gt('commence_time', now)
          .lt('commence_time', end)
          .order('commence_time', { ascending: true });

        return data?.map(g => {
          const outcomes = typeof g.outcomes === 'string' ? JSON.parse(g.outcomes) : g.outcomes;
          return {
            game: `${g.away_team} @ ${g.home_team}`,
            time: g.commence_time,
            moneyline: outcomes
          };
        }) || [];
      }

      case 'get_game_analysis': {
        const { data } = await supabase
          .from('game_analysis')
          .select('*')
          .ilike('home_team', `%${args.home_team}%`)
          .ilike('away_team', `%${args.away_team}%`)
          .order('analyzed_at', { ascending: false })
          .limit(1);

        if (data?.[0]) {
          return {
            matchup: `${data[0].away_team} @ ${data[0].home_team}`,
            date: data[0].game_date,
            analysis: data[0].analysis_text,
            moneyline: data[0].moneyline_pick,
            spread: data[0].spread_pick,
            analyzedAt: data[0].analyzed_at
          };
        }
        return { message: 'No pre-computed analysis found for this matchup' };
      }

      case 'get_injuries': {
        let query = supabase
          .from('news_cache')
          .select('team_name, summary, last_updated')
          .eq('sport', args.sport)
          .eq('search_type', 'injuries')
          .order('last_updated', { ascending: false });

        if (args.team_name) {
          query = query.ilike('team_name', `%${args.team_name}%`);
        } else {
          query = query.limit(10);
        }

        const { data } = await query;
        return data?.map(d => ({
          team: d.team_name,
          injuries: d.summary?.substring(0, 800),
          updated: d.last_updated
        })) || [];
      }

      case 'get_recent_scores': {
        const { data } = await supabase
          .from('news_cache')
          .select('summary, last_updated')
          .eq('sport', args.sport)
          .eq('search_type', 'recent_results')
          .order('last_updated', { ascending: false })
          .limit(1);

        return data?.[0] || { message: 'No recent scores available' };
      }

      case 'get_standings': {
        const { data } = await supabase
          .from('news_cache')
          .select('summary, last_updated')
          .eq('sport', args.sport)
          .eq('search_type', 'standings')
          .order('last_updated', { ascending: false })
          .limit(1);

        return data?.[0] || { message: 'No standings available' };
      }

      case 'get_model_performance': {
        const days = args.days || 7;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        let query = supabase
          .from('ai_suggestions')
          .select('sport, bet_type, actual_outcome, generate_mode')
          .neq('actual_outcome', 'pending')
          .gte('created_at', since);

        if (args.sport) query = query.eq('sport', args.sport);

        const { data } = await query;

        if (!data?.length) return { message: 'No resolved predictions in this period' };

        const total = data.length;
        const wins = data.filter(d => d.actual_outcome === 'won').length;
        const losses = data.filter(d => d.actual_outcome === 'lost').length;

        // Group by sport
        const bySport = {};
        data.forEach(d => {
          if (!bySport[d.sport]) bySport[d.sport] = { wins: 0, losses: 0, total: 0 };
          bySport[d.sport].total++;
          if (d.actual_outcome === 'won') bySport[d.sport].wins++;
          if (d.actual_outcome === 'lost') bySport[d.sport].losses++;
        });

        return {
          overall: { total, wins, losses, winRate: total > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) + '%' : 'N/A' },
          bySport
        };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    logger.error(`Tool ${name} error:`, err);
    return { error: err.message };
  }
}

const SYSTEM_PROMPT = `You are De-Genny, the Cray Cray for Parlays AI — a sharp, opinionated sports betting degenerate who ALWAYS has a take.

PERSONALITY: Confident. Convicted. Funny. Sarcastic. You roast bad teams, clown public bettors, and talk trash like you're at the sportsbook with your boys. You're the degenerate friend who somehow always does the research. Never wishy-washy, never "it could go either way." You ALWAYS pick a side. Throw in jokes, trash talk, and hot takes — but back them up with cold hard data.

ABSOLUTE RULES — VIOLATION OF THESE MEANS YOU FAILED:
1. NEVER EVER fabricate statistics, records, ATS data, streaks, or trends. If a tool didn't return it, YOU DON'T KNOW IT. Say "my data shows X" only when X came from a tool.
2. ALWAYS call tools FIRST. You MUST call at least search_odds + get_injuries + get_recent_scores before making ANY pick. No exceptions.
3. ALWAYS COMMIT TO A PICK. No "tossups." No "lean." PICK A SIDE AND OWN IT.
4. Only cite facts that appeared in tool results. If you don't have ATS records, DON'T MENTION ATS. If you don't have streak data, DON'T MENTION STREAKS. Cite what you DO have: records, scores, injury reports, odds, standings.
5. Give THE pick, not a menu. If they want multiple, each one must be convicted with tool-sourced evidence.

YOUR TOOLS (use them aggressively):
- search_odds → ACTUAL lines and moneylines (REQUIRED for every pick)
- get_injuries → who's hurt (REQUIRED — this creates edges)
- get_recent_scores → actual recent game results and scores
- get_standings → records and conference rankings
- get_news → articles with analysis, insider takes
- get_upcoming_games → what's on the schedule
- get_game_analysis → pre-computed AI breakdown
- get_team_stats → team records from our database

RESEARCH PROCESS (do this EVERY time someone asks for a pick):
1. search_odds with market_type 'spreads' AND 'h2h' → get the ACTUAL lines
2. get_injuries for that sport → find edges from missing players
3. get_recent_scores → actual recent scores (who beat whom and by how much)
4. get_standings → actual records
5. get_news or get_game_analysis → deeper context from articles
6. THEN and ONLY THEN give the pick citing ONLY data from steps 1-5

FORMAT:
🔒 TEAM -3.5 (-110)

Why this hits:
• [Fact from tool: "Iowa is 21-12 per standings data"]
• [Injury from tool: "Clemson lost X player per injury report"]
• [Score from tool: "They just beat Team Y 85-72"]
• [Odds from tool: "Line is -1.5 at -110 on DraftKings"]

Confidence: 🔥🔥🔥🔥 (4/5)

WHAT YOU MUST NEVER DO:
- Say "Team X is 0-5 ATS" unless a tool returned ATS data (they won't — we don't have ATS data)
- Say "Team X has covered in Y of last Z games" — we don't track covers
- Say "Team X is on a 7-game winning streak" unless get_recent_scores showed 7 consecutive wins
- Invent any statistic. If unsure, call another tool or say "my data doesn't show that"

Keep it punchy. For entertainment — gamble responsibly.`;

async function chatPicksHandler(req, res) {
  const startTime = Date.now();

  try {
    const { messages, conversationHistory = [] } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    // Load playbook from DB (cached 5min, zero API cost)
    let playbook = '';
    try {
      playbook = await aiInstructions.getForChat();
      if (playbook) logger.info(`Loaded AI playbook (${playbook.length} chars)`);
    } catch (e) {
      logger.warn('Failed to load AI playbook:', e.message);
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    // Build conversation with system prompt + DB playbook
    const systemContent = playbook ? `${playbook}\n\n---\n\n${SYSTEM_PROMPT}` : SYSTEM_PROMPT;
    const fullMessages = [
      { role: 'system', content: systemContent },
      ...conversationHistory,
      ...messages
    ];

    // First call REQUIRES tool use — forces the model to gather data before answering
    let response = await callOpenAI(apiKey, fullMessages, TOOLS, 'required');
    let assistantMessage = response.choices[0].message;

    // Handle tool calls (may need multiple rounds)
    let iterations = 0;
    const maxIterations = 8;

    while (assistantMessage.tool_calls && iterations < maxIterations) {
      iterations++;
      const toolResults = [];

      for (const toolCall of assistantMessage.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info(`Tool call: ${toolCall.function.name}`, args);

        const result = await executeTool(toolCall.function.name, args);

        toolResults.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }

      // Continue conversation with tool results
      fullMessages.push(assistantMessage);
      fullMessages.push(...toolResults);

      response = await callOpenAI(apiKey, fullMessages, TOOLS, 'auto');
      assistantMessage = response.choices[0].message;
    }

    const duration = Date.now() - startTime;

    // Extract and store any picks De-Genny made for model tracking
    const savedPicks = await extractAndStorePicks(assistantMessage.content);
    if (savedPicks > 0) {
      logger.info(`Stored ${savedPicks} De-Genny picks for model tracking`);
    }

    res.json({
      success: true,
      message: assistantMessage.content,
      usage: response.usage,
      duration: `${duration}ms`,
      picksSaved: savedPicks
    });

  } catch (error) {
    logger.error('Chat picks error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function callOpenAI(apiKey, messages, tools, toolChoice = 'auto') {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages,
      tools,
      tool_choice: toolChoice || 'auto',
      max_tokens: 2000,
      temperature: 0.4
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errBody}`);
  }

  return response.json();
}

/**
 * Extract picks from De-Genny's response and store in ai_suggestions
 * for model performance tracking. Uses gpt-4o-mini to parse the
 * unstructured chat response into structured pick data.
 */
async function extractAndStorePicks(responseText) {
  if (!responseText || responseText.length < 50) return 0;

  // Quick check — does this look like it contains picks?
  const hasPickSignals = /🔒|spread|moneyline|over|under|(-\d{3}|\+\d{3})|\d+\.\d+/i.test(responseText);
  if (!hasPickSignals) return 0;

  try {
    const extractResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Extract structured betting picks from this text. Return a JSON array of picks found. If no clear picks, return [].

TEXT:
${responseText}

Return ONLY valid JSON array with this format:
[{
  "sport": "NBA" or "NCAAB" or "NHL" or "MLB",
  "home_team": "full team name",
  "away_team": "full team name",
  "bet_type": "Spread" or "Moneyline" or "Total" or "Player Props",
  "pick": "the pick (e.g. 'Iowa State Cyclones -24.5' or 'Over 147.5')",
  "odds": "-110" or "+150" etc,
  "point": number or null,
  "confidence": 1-10,
  "reasoning": "brief summary of why (1-2 sentences)"
}]`
        }],
        temperature: 0.1,
        max_tokens: 1500,
        response_format: { type: 'json_object' }
      })
    });

    if (!extractResponse.ok) return 0;

    const extractData = await extractResponse.json();
    let parsed;
    try {
      parsed = JSON.parse(extractData.choices[0].message.content);
    } catch { return 0; }

    // Handle both { picks: [...] } and direct array
    const picks = Array.isArray(parsed) ? parsed : (parsed.picks || []);
    if (!picks.length) return 0;

    let saved = 0;
    for (const pick of picks.slice(0, 5)) { // Max 5 picks per chat
      if (!pick.home_team || !pick.away_team || !pick.pick) continue;

      // Find matching game in odds_cache for game_date
      const sportKey = {
        'NBA': 'basketball_nba', 'NCAAB': 'basketball_ncaab',
        'NFL': 'americanfootball_nfl', 'NHL': 'icehockey_nhl', 'MLB': 'baseball_mlb'
      }[pick.sport] || pick.sport;

      const homeNick = pick.home_team.split(' ').pop();
      const { data: gameMatch } = await supabase
        .from('odds_cache')
        .select('commence_time, external_game_id')
        .eq('sport', sportKey)
        .ilike('home_team', `%${homeNick}%`)
        .gt('commence_time', new Date().toISOString())
        .order('commence_time', { ascending: true })
        .limit(1);

      const gameDate = gameMatch?.[0]?.commence_time || null;
      const espnId = gameMatch?.[0]?.external_game_id || null;

      const { error } = await supabase
        .from('ai_suggestions')
        .insert({
          session_id: `degenny_${Date.now()}`,
          sport: pick.sport,
          home_team: pick.home_team,
          away_team: pick.away_team,
          game_date: gameDate,
          espn_event_id: espnId,
          bet_type: pick.bet_type,
          pick: pick.pick,
          odds: pick.odds || null,
          point: pick.point || null,
          confidence: pick.confidence || 7,
          reasoning: pick.reasoning || null,
          risk_level: 'medium',
          generate_mode: 'degenny_chat'
        });

      if (!error) saved++;
    }

    return saved;
  } catch (err) {
    logger.warn('Failed to extract/store De-Genny picks:', err.message);
    return 0;
  }
}

module.exports = { chatPicksHandler };
