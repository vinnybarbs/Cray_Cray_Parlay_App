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
          'home_team, away_team, game_date, edge_score, recommended_pick, recommended_side, analysis_snippet, key_factors, spread, total, moneyline_home, moneyline_away, home_record, away_record, home_ranking, away_ranking, sport'
        )
        .eq('stale', false)
        .gt('expires_at', new Date().toISOString())
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

    // 3. Yesterday's results from ai_suggestions
    const yesterdayResultsResult = await safeQuery(async () => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
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
      upcomingCounts: upcomingCountResult || {},
      firstGameTime: firstGameResult || null,
    });
  } catch (err) {
    logger.error('Digest endpoint error', { error: err.message });
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}

module.exports = { getDigest };
