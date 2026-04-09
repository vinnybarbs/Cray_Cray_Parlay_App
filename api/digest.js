const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../shared/logger');

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function safeQuery(fn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn('Digest query failed', { error: err.message });
    return null;
  }
}

const SPORT_SLUG_TO_DISPLAY = {
  basketball_nba: 'NBA',
  basketball_ncaab: 'NCAAB',
  americanfootball_nfl: 'NFL',
  americanfootball_ncaaf: 'NCAAF',
  baseball_mlb: 'MLB',
  icehockey_nhl: 'NHL',
  soccer_epl: 'EPL',
  soccer_usa_mls: 'MLS',
};

async function getDigest(req, res) {
  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    // 1. Today's games by sport from game_analysis
    const todaysGamesResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('game_analysis')
        .select(
          'game_key, home_team, away_team, game_date, edge_score, recommended_pick, recommended_side, analysis_snippet, key_factors, spread, total, moneyline_home, moneyline_away, home_record, away_record, home_ranking, away_ranking, sport, analysis_version, edge_movement, what_changed'
        )
        .eq('stale', false)
        .gt('expires_at', new Date().toISOString())
        .gt('game_date', new Date().toISOString())
        .order('edge_score', { ascending: false });

      if (error) throw error;
      return data || [];
    });

    // Group games by sport
    const gamesBySport = {};
    for (const game of todaysGamesResult || []) {
      const sport = game.sport || 'Unknown';
      if (!gamesBySport[sport]) gamesBySport[sport] = [];
      gamesBySport[sport].push(game);
    }

    // 2. Key injuries from news_cache — sport-level summaries
    const injuriesResult = await safeQuery(async () => {
      const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('news_cache')
        .select('team_name, content, last_updated, sport')
        .eq('search_type', 'injuries')
        .gt('last_updated', cutoff)
        .in('team_name', ['NBA', 'NHL', 'MLB', 'NFL', 'NCAAB', 'NCAAF', 'EPL', 'MLS', 'Soccer']);

      if (error) throw error;

      // Limit to 1 per sport/team_name
      const seen = new Set();
      const filtered = [];
      for (const row of data || []) {
        if (!seen.has(row.team_name)) {
          seen.add(row.team_name);
          filtered.push(row);
        }
      }
      return filtered;
    });

    // Index injuries by sport code
    const injuriesBySport = {};
    for (const entry of injuriesResult || []) {
      injuriesBySport[entry.team_name] = entry;
    }

    // 3. Recent results from ai_suggestions (last 3 days for more data)
    const yesterdayResultsResult = await safeQuery(async () => {
      const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('ai_suggestions')
        .select('sport, actual_outcome, pick, home_team, away_team, bet_type, resolved_at')
        .gt('resolved_at', cutoff)
        .in('actual_outcome', ['won', 'lost'])
        .order('resolved_at', { ascending: false });

      if (error) throw error;

      const bySport = {};
      for (const row of data || []) {
        const sport = row.sport || 'Unknown';
        if (!bySport[sport]) bySport[sport] = { won: 0, lost: 0, picks: [] };
        bySport[sport][row.actual_outcome]++;
        bySport[sport].picks.push({
          pick: row.pick,
          outcome: row.actual_outcome,
          home_team: row.home_team,
          away_team: row.away_team,
          bet_type: row.bet_type,
          resolved_at: row.resolved_at,
        });
      }
      return bySport;
    });

    // 4. 7-day model accuracy by sport
    const sevenDayAccuracyResult = await safeQuery(async () => {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('ai_suggestions')
        .select('sport, actual_outcome')
        .gt('resolved_at', cutoff)
        .in('actual_outcome', ['won', 'lost']);

      if (error) throw error;

      const bySport = {};
      let totalWon = 0;
      let totalLost = 0;

      for (const row of data || []) {
        const sport = row.sport || 'Unknown';
        if (!bySport[sport]) bySport[sport] = { won: 0, lost: 0 };
        bySport[sport][row.actual_outcome]++;
        if (row.actual_outcome === 'won') totalWon++;
        else totalLost++;
      }

      const overall = {
        won: totalWon,
        lost: totalLost,
        total: totalWon + totalLost,
        winRate: totalWon + totalLost > 0 ? Math.round((totalWon / (totalWon + totalLost)) * 100) : null,
      };

      const bySportFormatted = {};
      for (const [sport, counts] of Object.entries(bySport)) {
        const total = counts.won + counts.lost;
        bySportFormatted[sport] = {
          won: counts.won,
          lost: counts.lost,
          total,
          winRate: total > 0 ? Math.round((counts.won / total) * 100) : null,
        };
      }

      return { overall, bySport: bySportFormatted };
    });

    // 4b. All-time model accuracy by sport
    const allTimeAccuracyResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('ai_suggestions')
        .select('sport, actual_outcome')
        .in('actual_outcome', ['won', 'lost']);

      if (error) throw error;

      const bySport = {};
      let totalWon = 0;
      let totalLost = 0;

      for (const row of data || []) {
        const sport = row.sport || 'Unknown';
        if (!bySport[sport]) bySport[sport] = { won: 0, lost: 0 };
        bySport[sport][row.actual_outcome]++;
        if (row.actual_outcome === 'won') totalWon++;
        else totalLost++;
      }

      const overall = {
        won: totalWon, lost: totalLost, total: totalWon + totalLost,
        winRate: totalWon + totalLost > 0 ? Math.round((totalWon / (totalWon + totalLost)) * 100) : null,
      };

      const bySportFormatted = {};
      for (const [sport, counts] of Object.entries(bySport)) {
        const total = counts.won + counts.lost;
        bySportFormatted[sport] = {
          won: counts.won, lost: counts.lost, total,
          winRate: total > 0 ? Math.round((counts.won / total) * 100) : null,
        };
      }

      return { overall, bySport: bySportFormatted };
    });

    // 5. Upcoming game count by sport from odds_cache
    const upcomingCountResult = await safeQuery(async () => {
      const now = new Date().toISOString();
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('odds_cache')
        .select('sport, home_team, away_team')
        .gt('commence_time', now)
        .lt('commence_time', tomorrow);

      if (error) throw error;

      const countsBySport = {};
      const seenGames = new Set();
      for (const row of data || []) {
        const key = `${row.sport}::${row.home_team}::${row.away_team}`;
        if (!seenGames.has(key)) {
          seenGames.add(key);
          const display = SPORT_SLUG_TO_DISPLAY[row.sport] || row.sport;
          countsBySport[display] = (countsBySport[display] || 0) + 1;
        }
      }
      return countsBySport;
    });

    // 6. Golf tournaments (leaderboard from ESPN + outright odds)
    const golfResult = await safeQuery(async () => {
      try {
        const espnRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
        if (!espnRes.ok) return null;
        const espnData = await espnRes.json();
        const events = espnData.events || [];
        if (events.length === 0) return null;

        const event = events[0];
        const comp = event.competitions?.[0];
        if (!comp) return null;

        const players = (comp.competitors || []).slice(0, 20).map((p, idx) => {
          const athlete = p.athlete || {};
          const round1 = p.linescores?.[0];
          return {
            position: idx + 1,
            name: athlete.displayName || 'Unknown',
            score: p.score || 'E',
            round1Score: round1?.displayValue || null,
            round1Strokes: round1?.value || null
          };
        });

        // Get outright odds from odds_cache if available
        const { data: oddsData } = await supabase
          .from('odds_cache')
          .select('outcomes, bookmaker')
          .eq('sport', 'golf_masters_tournament_winner')
          .eq('market_type', 'outrights')
          .limit(1);

        let topOdds = null;
        if (oddsData?.[0]?.outcomes) {
          const outcomes = typeof oddsData[0].outcomes === 'string'
            ? JSON.parse(oddsData[0].outcomes)
            : oddsData[0].outcomes;
          topOdds = outcomes
            .sort((a, b) => {
              // Sort favorites first (lowest positive or most negative)
              const aPrice = a.price || 99999;
              const bPrice = b.price || 99999;
              return aPrice - bPrice;
            })
            .slice(0, 15)
            .map(o => ({ name: o.name, odds: o.price }));
        }

        return {
          tournament: event.name,
          status: event.status?.type?.description || 'In Progress',
          venue: comp.venue?.fullName || null,
          leaderboard: players,
          outrightOdds: topOdds
        };
      } catch (err) {
        console.warn('Golf fetch error:', err.message);
        return null;
      }
    });

    // First game time for countdown
    const firstGameResult = await safeQuery(async () => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('odds_cache')
        .select('commence_time')
        .gt('commence_time', now)
        .order('commence_time', { ascending: true })
        .limit(1);
      if (error) throw error;
      return data && data.length > 0 ? data[0].commence_time : null;
    });

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      gamesBySport: gamesBySport || {},
      injuries: injuriesBySport || {},
      yesterdayResults: yesterdayResultsResult || {},
      sevenDayAccuracy: sevenDayAccuracyResult || { overall: null, bySport: {} },
      allTimeAccuracy: allTimeAccuracyResult || { overall: null, bySport: {} },
      upcomingCounts: upcomingCountResult || {},
      firstGameTime: firstGameResult || null,
      golf: golfResult || null,
    });
  } catch (err) {
    logger.error('Digest endpoint error', { error: err.message });
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}

async function deepResearch(req, res) {
  const { game_key } = req.query;
  if (!game_key) {
    return res.status(400).json({ error: 'game_key query param required' });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    // 1. game_analysis row for this game_key
    const gameAnalysisResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('game_analysis')
        .select(
          'home_team, away_team, game_date, sport, edge_score, edge_movement, analysis_snippet, key_factors, what_changed, prior_analysis, analysis_version, recommended_pick, recommended_side, spread, total, moneyline_home, moneyline_away, home_record, away_record'
        )
        .eq('game_key', game_key)
        .maybeSingle();
      if (error) throw error;
      return data;
    });

    if (!gameAnalysisResult) {
      return res.status(404).json({ error: 'Game not found', game_key });
    }

    const { home_team, away_team, sport } = gameAnalysisResult;

    // 2. Injury reports for both teams' sport from news_cache
    const injuriesResult = await safeQuery(async () => {
      const sportCode = SPORT_SLUG_TO_DISPLAY[sport] || sport;
      const teamsToSearch = [home_team, away_team, sportCode];
      const { data, error } = await supabase
        .from('news_cache')
        .select('team_name, content, last_updated')
        .eq('search_type', 'injuries')
        .in('team_name', teamsToSearch);
      if (error) throw error;
      return data || [];
    });

    // 3. News articles mentioning either team (last 5 days, limit 10)
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const articlesResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('news_articles')
        .select('title, betting_summary, published_at, sentiment')
        .or(`title.ilike.%${home_team}%,title.ilike.%${away_team}%`)
        .gt('published_at', fiveDaysAgo)
        .order('published_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    });

    // 4. Current odds lines for this matchup
    const oddsResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('odds_cache')
        .select('market_type, home_team, away_team, spread, total, moneyline_home, moneyline_away, bookmaker, commence_time')
        .eq('home_team', home_team)
        .eq('away_team', away_team)
        .order('market_type');
      if (error) throw error;
      return data || [];
    });

    // 5. Last 5 games for each team from game_results
    const [homeResultsResult, awayResultsResult] = await Promise.all([
      safeQuery(async () => {
        const { data, error } = await supabase
          .from('game_results')
          .select('home_team_name, away_team_name, home_score, away_score, date, status')
          .or(`home_team_name.eq.${home_team},away_team_name.eq.${home_team}`)
          .eq('status', 'final')
          .order('date', { ascending: false })
          .limit(5);
        if (error) throw error;
        return data || [];
      }),
      safeQuery(async () => {
        const { data, error } = await supabase
          .from('game_results')
          .select('home_team_name, away_team_name, home_score, away_score, date, status')
          .or(`home_team_name.eq.${away_team},away_team_name.eq.${away_team}`)
          .eq('status', 'final')
          .order('date', { ascending: false })
          .limit(5);
        if (error) throw error;
        return data || [];
      }),
    ]);

    res.json({
      status: 'ok',
      game_key,
      analysis: gameAnalysisResult,
      injuries: injuriesResult || [],
      articles: articlesResult || [],
      odds: oddsResult || [],
      homeTeamResults: homeResultsResult || [],
      awayTeamResults: awayResultsResult || [],
    });
  } catch (err) {
    logger.error('Deep research endpoint error', { error: err.message, game_key });
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}

module.exports = { getDigest, deepResearch };
