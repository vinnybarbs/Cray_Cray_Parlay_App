/**
 * Chat-based AI Pick Generator
 * Users describe what they want in natural language, AI queries the database
 * and returns personalized betting suggestions.
 */

const { logger } = require('../shared/logger');
const { supabase } = require('../lib/middleware/supabaseAuth');

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
        // Get structured intelligence from news_cache (ESPN injuries, scores, standings)
        let newsQuery = supabase
          .from('news_cache')
          .select('sport, team_name, search_type, summary, last_updated')
          .eq('sport', args.sport)
          .order('last_updated', { ascending: false })
          .limit(15);

        if (args.team_name) newsQuery = newsQuery.ilike('team_name', `%${args.team_name}%`);

        const { data: newsCache } = await newsQuery;

        // Get enriched articles with betting analysis
        let articlesQuery = supabase
          .from('news_articles')
          .select('title, published_at, betting_summary, injury_mentions, sentiment, content')
          .not('betting_summary', 'is', null)
          .neq('betting_summary', 'Not analyzed')
          .order('published_at', { ascending: false })
          .limit(10);

        // Filter by sport keyword in title if possible
        if (args.sport) {
          const sportKeywords = {
            'NBA': 'NBA,Lakers,Celtics,basketball',
            'NCAAB': 'NCAA,March Madness,college basketball,tournament',
            'NHL': 'NHL,hockey',
            'MLB': 'MLB,baseball',
            'NFL': 'NFL,football'
          };
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
          enrichedArticles: articles?.map(a => ({
            title: a.title,
            date: a.published_at,
            bettingSummary: a.betting_summary,
            injuries: a.injury_mentions,
            sentiment: a.sentiment,
            excerpt: a.content?.substring(0, 300)
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

const SYSTEM_PROMPT = `You are De-Genny, the Cray Cray for Parlays AI — a sharp, opinionated sports betting degenerate who ALWAYS has a take. You talk like a sharp who's been in the trenches. You help users find the best betting opportunities using our real-time database.

CRITICAL RULES:
1. ALWAYS COMMIT TO A PICK. Never say "tossup", "could go either way", or "I'd lean slightly toward". Pick a side and own it. If the data is close, go with your gut and explain why.
2. Be bold. Be confident. Have a personality. You're De-Genny — you've got conviction.
3. Back every pick with real data from the tools. Never make up odds, scores, or stats.
4. If someone asks for a pick, give them THE pick — not three options with caveats.
5. Use actual injury reports, recent scores, and news when available.
6. Talk like you're texting your best friend about a lock, not writing an essay.

Your vibe: You're the friend who always has the play. Confident, a little cocky, but you do the research. You drop fire picks and own the Ls when they come.

When users ask for picks:
1. Use get_upcoming_games to see what's available
2. Use search_odds to get specific lines
3. Use get_team_stats and/or get_game_analysis for context
4. Use get_news for injury/intel edge
5. Give them THE pick with odds, reasoning, and conviction level

Format picks like:
🔒 TEAM -3.5 (-110) — here's why this hits...

Keep responses punchy. No walls of text. For entertainment — gamble responsibly.`;

async function chatPicksHandler(req, res) {
  const startTime = Date.now();

  try {
    const { messages, conversationHistory = [] } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    // Build conversation with system prompt
    const fullMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversationHistory,
      ...messages
    ];

    // Call OpenAI with tools
    let response = await callOpenAI(apiKey, fullMessages, TOOLS);
    let assistantMessage = response.choices[0].message;

    // Handle tool calls (may need multiple rounds)
    let iterations = 0;
    const maxIterations = 5;

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

      response = await callOpenAI(apiKey, fullMessages, TOOLS);
      assistantMessage = response.choices[0].message;
    }

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      message: assistantMessage.content,
      usage: response.usage,
      duration: `${duration}ms`
    });

  } catch (error) {
    logger.error('Chat picks error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function callOpenAI(apiKey, messages, tools) {
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
      tool_choice: 'auto',
      max_tokens: 2000,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errBody}`);
  }

  return response.json();
}

module.exports = { chatPicksHandler };
