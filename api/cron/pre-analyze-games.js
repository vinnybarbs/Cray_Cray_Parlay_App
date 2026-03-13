// CRON JOB: Pre-Analyze Upcoming Games
// Runs 2-3x daily to generate AI analysis snippets per game using GPT-4o-mini
// Stores results in game_analysis table for cheap/fast pick generation
// Schedule: Every 4 hours
// Endpoint: POST /cron/pre-analyze-games

const { supabase } = require('../../lib/middleware/supabaseAuth.js');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Build a game_key from team names + date
 */
function makeGameKey(homeTeam, awayTeam, dateStr) {
  const normalize = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
  return `${normalize(awayTeam)}_vs_${normalize(homeTeam)}_${dateStr}`;
}

/**
 * Fetch upcoming games from odds_cache grouped by matchup
 */
async function getUpcomingGames(sports) {
  const now = new Date().toISOString();
  const twoDaysOut = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('odds_cache')
    .select('sport, home_team, away_team, commence_time, market_type, outcomes, bookmaker')
    .in('sport', sports)
    .gte('commence_time', now)
    .lte('commence_time', twoDaysOut)
    .order('commence_time', { ascending: true });

  if (error) throw new Error(`Failed to fetch odds: ${error.message}`);

  // Group by game
  const games = {};
  for (const row of (data || [])) {
    const dateStr = new Date(row.commence_time).toISOString().split('T')[0];
    const key = makeGameKey(row.home_team, row.away_team, dateStr);

    if (!games[key]) {
      games[key] = {
        game_key: key,
        sport: row.sport,
        home_team: row.home_team,
        away_team: row.away_team,
        game_date: row.commence_time,
        markets: {}
      };
    }

    // Prefer DraftKings, fall back to FanDuel
    const existing = games[key].markets[row.market_type];
    if (!existing || row.bookmaker === 'draftkings') {
      games[key].markets[row.market_type] = row.outcomes;
    }
  }

  return Object.values(games);
}

/**
 * Extract spread, total, moneyline from grouped market data
 */
function extractOddsContext(game) {
  const ctx = { spread: null, total: null, ml_home: null, ml_away: null };

  // Spread
  const spreads = game.markets['spreads'];
  if (spreads) {
    const homeSpread = spreads.find(o => o.name === game.home_team);
    if (homeSpread) ctx.spread = homeSpread.point;
  }

  // Total
  const totals = game.markets['totals'];
  if (totals) {
    const over = totals.find(o => o.name === 'Over');
    if (over) ctx.total = over.point;
  }

  // Moneyline
  const h2h = game.markets['h2h'];
  if (h2h) {
    const homeMl = h2h.find(o => o.name === game.home_team);
    const awayMl = h2h.find(o => o.name === game.away_team);
    if (homeMl) ctx.ml_home = homeMl.price;
    if (awayMl) ctx.ml_away = awayMl.price;
  }

  return ctx;
}

/**
 * Get relevant news snippets for a game's teams
 */
async function getNewsContext(homeTeam, awayTeam, sport) {
  try {
    // Search for articles mentioning either team in the last 3 days
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    // Extract key words from team names for search
    const homeWords = homeTeam.split(' ').slice(-1)[0]; // Last word (mascot)
    const awayWords = awayTeam.split(' ').slice(-1)[0];

    const { data } = await supabase
      .from('news_articles')
      .select('title, summary, published_at')
      .gte('published_at', threeDaysAgo)
      .or(`title.ilike.%${homeWords}%,title.ilike.%${awayWords}%,summary.ilike.%${homeWords}%,summary.ilike.%${awayWords}%`)
      .order('published_at', { ascending: false })
      .limit(5);

    if (!data || data.length === 0) return null;

    return data.map(a => `- ${a.title}`).join('\n');
  } catch {
    return null;
  }
}

/**
 * Get injury context for teams
 */
async function getInjuryContext(homeTeam, awayTeam) {
  try {
    const { data } = await supabase
      .from('injuries')
      .select('player_name, status, injury_type')
      .or(`team_name.ilike.%${homeTeam.split(' ').slice(-1)[0]}%,team_name.ilike.%${awayTeam.split(' ').slice(-1)[0]}%`)
      .in('status', ['Out', 'Doubtful', 'Questionable'])
      .limit(10);

    if (!data || data.length === 0) return null;

    return data.map(i => `${i.player_name} (${i.status} - ${i.injury_type || 'undisclosed'})`).join(', ');
  } catch {
    return null;
  }
}

/**
 * Get rankings context
 */
async function getRankingsContext(homeTeam, awayTeam) {
  try {
    const { data } = await supabase
      .from('rankings_cache')
      .select('team_name, rank, record')
      .in('team_name', [
        homeTeam.split(' ').slice(-1)[0],
        awayTeam.split(' ').slice(-1)[0]
      ]);

    const result = { home_rank: null, away_rank: null, home_record: null, away_record: null };

    for (const r of (data || [])) {
      if (homeTeam.toLowerCase().includes(r.team_name.toLowerCase())) {
        result.home_rank = r.rank;
        result.home_record = r.record;
      }
      if (awayTeam.toLowerCase().includes(r.team_name.toLowerCase())) {
        result.away_rank = r.rank;
        result.away_record = r.record;
      }
    }

    return result;
  } catch {
    return { home_rank: null, away_rank: null, home_record: null, away_record: null };
  }
}

/**
 * Get recent game results for trend context
 */
async function getRecentResults(teamName, sport, limit = 5) {
  try {
    const mascot = teamName.split(' ').slice(-1)[0];
    const { data } = await supabase
      .from('game_results')
      .select('home_team_name, away_team_name, home_score, away_score, date, metadata')
      .eq('status', 'final')
      .or(`home_team_name.ilike.%${mascot}%,away_team_name.ilike.%${mascot}%`)
      .order('date', { ascending: false })
      .limit(limit);

    if (!data || data.length === 0) return null;

    let wins = 0, losses = 0;
    const results = [];
    for (const g of data) {
      const isHome = g.home_team_name.toLowerCase().includes(mascot.toLowerCase());
      const teamScore = isHome ? g.home_score : g.away_score;
      const oppScore = isHome ? g.away_score : g.home_score;
      const won = teamScore > oppScore;
      if (won) wins++; else losses++;
      const opp = isHome ? g.away_team_name : g.home_team_name;
      results.push(`${won ? 'W' : 'L'} ${teamScore}-${oppScore} vs ${opp}`);
    }

    return { record: `${wins}-${losses}`, games: results };
  } catch {
    return null;
  }
}

/**
 * Get model's past accuracy for this type of pick
 */
async function getPastAccuracy(sport) {
  try {
    const { data } = await supabase
      .from('ai_suggestions')
      .select('actual_outcome, bet_type, odds')
      .eq('sport', sport.toUpperCase().replace('AMERICANFOOTBALL_', '').replace('BASKETBALL_', '').replace('ICEHOCKEY_', ''))
      .in('actual_outcome', ['won', 'lost'])
      .limit(200);

    if (!data || data.length < 5) return null;

    const wins = data.filter(d => d.actual_outcome === 'won').length;
    const total = data.length;
    return `Model is ${wins}/${total} (${(wins/total*100).toFixed(0)}%) on ${sport} picks`;
  } catch {
    return null;
  }
}

/**
 * Generate AI analysis for a single game using GPT-4o-mini
 */
async function analyzeGame(game, oddsCtx, newsCtx, injuryCtx, rankCtx, homeTrend, awayTrend, accuracy) {
  const sportDisplay = game.sport
    .replace('americanfootball_', '').replace('basketball_', '').replace('icehockey_', '')
    .toUpperCase();

  let contextParts = [];
  contextParts.push(`Sport: ${sportDisplay}`);
  contextParts.push(`Matchup: ${game.away_team} @ ${game.home_team}`);

  if (oddsCtx.spread != null) contextParts.push(`Spread: ${game.home_team} ${oddsCtx.spread}`);
  if (oddsCtx.total != null) contextParts.push(`O/U Total: ${oddsCtx.total}`);
  if (oddsCtx.ml_home != null) contextParts.push(`Moneyline: ${game.home_team} ${oddsCtx.ml_home} / ${game.away_team} ${oddsCtx.ml_away}`);

  if (rankCtx.home_rank) contextParts.push(`${game.home_team}: Ranked #${rankCtx.home_rank} (${rankCtx.home_record || ''})`);
  if (rankCtx.away_rank) contextParts.push(`${game.away_team}: Ranked #${rankCtx.away_rank} (${rankCtx.away_record || ''})`);

  if (homeTrend) contextParts.push(`${game.home_team} last ${homeTrend.games.length}: ${homeTrend.record} — ${homeTrend.games.join('; ')}`);
  if (awayTrend) contextParts.push(`${game.away_team} last ${awayTrend.games.length}: ${awayTrend.record} — ${awayTrend.games.join('; ')}`);

  if (injuryCtx) contextParts.push(`Injuries: ${injuryCtx}`);
  if (newsCtx) contextParts.push(`Recent news:\n${newsCtx}`);
  if (accuracy) contextParts.push(`Past accuracy: ${accuracy}`);

  const prompt = `You are a sharp sports betting analyst. Analyze this game and provide a concise betting recommendation.

${contextParts.join('\n')}

Respond in EXACTLY this JSON format (no markdown):
{
  "analysis": "2-3 sentence analysis covering key factors",
  "edge_score": 7.5,
  "recommended_pick": "Kansas -7.5",
  "recommended_side": "home_spread",
  "key_factors": ["factor1", "factor2", "factor3"]
}

edge_score: 1-10 (10 = strongest edge). recommended_side must be one of: home_spread, away_spread, over, under, home_ml, away_ml. Be data-driven and concise.`;

  try {
    const response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    const usage = data.usage;

    if (!content) throw new Error('Empty response from OpenAI');

    // Parse JSON (strip markdown fences if present)
    const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return {
      analysis_snippet: parsed.analysis,
      edge_score: parsed.edge_score,
      recommended_pick: parsed.recommended_pick,
      recommended_side: parsed.recommended_side,
      key_factors: parsed.key_factors,
      prompt_tokens: usage?.prompt_tokens,
      completion_tokens: usage?.completion_tokens
    };
  } catch (err) {
    console.error(`AI analysis failed for ${game.game_key}:`, err.message);
    return null;
  }
}

async function preAnalyzeGames(req, res) {
  const startTime = Date.now();

  try {
    const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
    if (cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('\n🧠 CRON: Pre-analyzing upcoming games...');

    // Sports to analyze (Odds API slugs)
    const sportSlugs = [
      'americanfootball_nfl', 'basketball_nba', 'basketball_ncaab',
      'icehockey_nhl', 'americanfootball_ncaaf'
    ];

    // 1. Get upcoming games from odds cache
    const games = await getUpcomingGames(sportSlugs);
    console.log(`📊 Found ${games.length} upcoming games to analyze`);

    if (games.length === 0) {
      return res.status(200).json({ success: true, analyzed: 0, message: 'No upcoming games found' });
    }

    // 2. Check which games already have fresh analysis
    const { data: existingAnalysis } = await supabase
      .from('game_analysis')
      .select('game_key, generated_at, stale')
      .in('game_key', games.map(g => g.game_key));

    const existingKeys = new Set();
    const staleKeys = new Set();
    for (const ea of (existingAnalysis || [])) {
      const age = Date.now() - new Date(ea.generated_at).getTime();
      if (age < 4 * 60 * 60 * 1000 && !ea.stale) {
        existingKeys.add(ea.game_key); // Fresh, skip
      } else {
        staleKeys.add(ea.game_key); // Needs refresh
      }
    }

    const gamesToAnalyze = games.filter(g => !existingKeys.has(g.game_key));
    console.log(`🔄 ${gamesToAnalyze.length} games need analysis (${existingKeys.size} already fresh)`);

    // 3. Analyze each game
    let analyzed = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    const errors = [];

    // Cap at 30 games per run to stay within limits
    const batch = gamesToAnalyze.slice(0, 30);

    for (const game of batch) {
      try {
        const oddsCtx = extractOddsContext(game);
        const sportDisplay = game.sport.replace('americanfootball_', '').replace('basketball_', '').replace('icehockey_', '').toUpperCase();

        // Fetch context in parallel
        const [newsCtx, injuryCtx, rankCtx, homeTrend, awayTrend, accuracy] = await Promise.all([
          getNewsContext(game.home_team, game.away_team, sportDisplay),
          getInjuryContext(game.home_team, game.away_team),
          getRankingsContext(game.home_team, game.away_team),
          getRecentResults(game.home_team, game.sport),
          getRecentResults(game.away_team, game.sport),
          getPastAccuracy(game.sport)
        ]);

        const result = await analyzeGame(game, oddsCtx, newsCtx, injuryCtx, rankCtx, homeTrend, awayTrend, accuracy);

        if (result) {
          const record = {
            game_key: game.game_key,
            sport: sportDisplay,
            home_team: game.home_team,
            away_team: game.away_team,
            game_date: game.game_date,
            home_record: rankCtx.home_record,
            away_record: rankCtx.away_record,
            home_ranking: rankCtx.home_rank,
            away_ranking: rankCtx.away_rank,
            spread: oddsCtx.spread,
            total: oddsCtx.total,
            moneyline_home: oddsCtx.ml_home,
            moneyline_away: oddsCtx.ml_away,
            analysis_snippet: result.analysis_snippet,
            edge_score: result.edge_score,
            recommended_pick: result.recommended_pick,
            recommended_side: result.recommended_side,
            key_factors: result.key_factors,
            news_context: newsCtx,
            injury_context: injuryCtx,
            model_used: 'gpt-4o-mini',
            prompt_tokens: result.prompt_tokens,
            completion_tokens: result.completion_tokens,
            generated_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
            stale: false
          };

          const { error } = await supabase
            .from('game_analysis')
            .upsert(record, { onConflict: 'game_key' });

          if (error) {
            console.error(`DB error for ${game.game_key}:`, error.message);
            errors.push(`${game.game_key}: ${error.message}`);
          } else {
            analyzed++;
            totalPromptTokens += result.prompt_tokens || 0;
            totalCompletionTokens += result.completion_tokens || 0;
          }
        }

        // Small delay between OpenAI calls
        await new Promise(r => setTimeout(r, 500));

      } catch (err) {
        console.error(`Error analyzing ${game.game_key}:`, err.message);
        errors.push(`${game.game_key}: ${err.message}`);
      }
    }

    const duration = Date.now() - startTime;
    const estimatedCost = ((totalPromptTokens * 0.00000015) + (totalCompletionTokens * 0.0000006)).toFixed(4);

    console.log(`\n🧠 Pre-analysis complete in ${(duration / 1000).toFixed(1)}s`);
    console.log(`📊 Analyzed: ${analyzed}/${batch.length} games`);
    console.log(`💰 Tokens: ${totalPromptTokens} prompt + ${totalCompletionTokens} completion ≈ $${estimatedCost}`);

    return res.status(200).json({
      success: true,
      duration_ms: duration,
      games_found: games.length,
      already_fresh: existingKeys.size,
      analyzed,
      tokens: { prompt: totalPromptTokens, completion: totalCompletionTokens },
      estimated_cost: `$${estimatedCost}`,
      errors
    });

  } catch (error) {
    console.error('❌ Pre-analysis failed:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = preAnalyzeGames;
