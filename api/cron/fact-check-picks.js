/**
 * Cron: Fact-check AI suggestions against actual database data
 *
 * Runs after picks are generated. For each un-checked suggestion:
 * 1. Gathers real data: odds, scores, standings, injuries, articles
 * 2. Asks gpt-4o-mini to compare the reasoning against the data
 * 3. Stores verified claims, unverifiable claims, and flagged issues
 */

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../../shared/logger');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function factCheckPicks(req, res) {
  const startTime = Date.now();
  let checked = 0;
  let flagged = 0;

  try {
    // Get recent suggestions that haven't been fact-checked
    const { data: picks, error } = await supabase
      .from('ai_suggestions')
      .select('id, sport, home_team, away_team, game_date, bet_type, pick, odds, point, confidence, reasoning')
      .is('fact_checked_at', null)
      .not('reasoning', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    if (!picks?.length) {
      return res.json({ success: true, checked: 0, message: 'No picks to fact-check' });
    }

    for (const pick of picks) {
      try {
        // Gather real data for this matchup
        const realData = await gatherRealData(pick);

        // Ask mini to fact-check the reasoning
        const factCheck = await runFactCheck(pick, realData);

        // Save results
        await supabase
          .from('ai_suggestions')
          .update({
            fact_check: factCheck,
            fact_check_score: factCheck.accuracy_score,
            fact_checked_at: new Date().toISOString()
          })
          .eq('id', pick.id);

        checked++;
        if (factCheck.accuracy_score < 6) flagged++;

      } catch (err) {
        logger.warn(`Fact-check failed for pick ${pick.id}: ${err.message}`);
      }
    }

    const duration = Date.now() - startTime;
    res.json({ success: true, checked, flagged, duration: `${duration}ms` });

  } catch (error) {
    logger.error('Fact-check error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

async function gatherRealData(pick) {
  const data = {};

  // Get actual odds from cache
  const { data: odds } = await supabase
    .from('odds_cache')
    .select('market_type, bookmaker, outcomes')
    .or(`home_team.ilike.%${pick.home_team.split(' ').pop()}%,away_team.ilike.%${pick.away_team.split(' ').pop()}%`)
    .eq('sport', mapSportToOddsKey(pick.sport))
    .limit(10);
  data.odds = odds || [];

  // Get standings/record from news_cache
  const { data: standings } = await supabase
    .from('news_cache')
    .select('summary')
    .eq('sport', pick.sport)
    .eq('search_type', 'standings')
    .order('last_updated', { ascending: false })
    .limit(1);
  data.standings = standings?.[0]?.summary || 'No standings data';

  // Get recent scores
  const { data: scores } = await supabase
    .from('news_cache')
    .select('summary')
    .eq('sport', pick.sport)
    .eq('search_type', 'recent_results')
    .order('last_updated', { ascending: false })
    .limit(1);
  data.recent_scores = scores?.[0]?.summary || 'No recent scores';

  // Get injuries for both teams
  const homeNick = pick.home_team.split(' ').pop();
  const awayNick = pick.away_team.split(' ').pop();

  const { data: homeInjuries } = await supabase
    .from('news_cache')
    .select('summary')
    .eq('sport', pick.sport)
    .eq('search_type', 'injuries')
    .ilike('team_name', `%${homeNick}%`)
    .limit(1);

  const { data: awayInjuries } = await supabase
    .from('news_cache')
    .select('summary')
    .eq('sport', pick.sport)
    .eq('search_type', 'injuries')
    .ilike('team_name', `%${awayNick}%`)
    .limit(1);

  data.home_injuries = homeInjuries?.[0]?.summary || 'No injury data';
  data.away_injuries = awayInjuries?.[0]?.summary || 'No injury data';

  // Get relevant articles
  const { data: articles } = await supabase
    .from('news_articles')
    .select('title, betting_summary')
    .or(`title.ilike.%${homeNick}%,title.ilike.%${awayNick}%`)
    .order('published_at', { ascending: false })
    .limit(5);
  data.articles = (articles || []).map(a => `${a.title}: ${a.betting_summary || 'no analysis'}`);

  return data;
}

async function runFactCheck(pick, realData) {
  const prompt = `You are a sports data fact-checker. Your job is to verify claims in betting analysis against actual data.

PICK BEING CHECKED:
- Game: ${pick.away_team} @ ${pick.home_team}
- Bet: ${pick.bet_type} — ${pick.pick} (${pick.odds})
- Confidence: ${pick.confidence}/10
- Reasoning: ${pick.reasoning}

ACTUAL DATA FROM OUR DATABASE:
Standings: ${realData.standings}
Recent Scores: ${realData.recent_scores}
${pick.home_team} Injuries: ${realData.home_injuries}
${pick.away_team} Injuries: ${realData.away_injuries}
Odds: ${JSON.stringify(realData.odds?.slice(0, 5))}
Related Articles: ${realData.articles.join('\n')}

INSTRUCTIONS:
1. Go through EACH factual claim in the reasoning
2. Mark each as: VERIFIED (matches our data), UNVERIFIABLE (not in our data), or FALSE (contradicts our data)
3. Give an overall accuracy_score from 1-10
4. List specific issues

Respond in this exact JSON format:
{
  "verified_claims": ["claim 1 that matches data", "claim 2"],
  "unverifiable_claims": ["claim we can't confirm from data"],
  "false_claims": ["claim that contradicts actual data"],
  "issues": ["specific concern about the analysis"],
  "accuracy_score": 7,
  "summary": "One-line verdict on this analysis quality"
}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) throw new Error(`OpenAI error: ${response.statusText}`);

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

function mapSportToOddsKey(sport) {
  const map = {
    'NBA': 'basketball_nba',
    'NCAAB': 'basketball_ncaab',
    'NFL': 'americanfootball_nfl',
    'NHL': 'icehockey_nhl',
    'MLB': 'baseball_mlb'
  };
  return map[sport] || sport;
}

module.exports = factCheckPicks;
