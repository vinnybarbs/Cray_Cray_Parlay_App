/**
 * ATS (Against The Spread) Tracker
 *
 * Calculates and stores ATS records by comparing final scores to closing spreads.
 * Called after games settle to build historical ATS data for every team.
 */

const { logger } = require('../../shared/logger');
const { teamsMatch: sharedTeamsMatch } = require('../utils/team-matcher');

class ATSTracker {
  constructor(supabase) {
    this.supabase = supabase;
  }

  /**
   * Process a settled game and record ATS results for both teams.
   * @param {Object} gameResult — from game_results table (home_team_name, away_team_name, home_score, away_score, sport, date)
   */
  async recordATS(gameResult) {
    try {
      const { home_team_name, away_team_name, home_score, away_score, sport, date, id: gameResultId } = gameResult;

      if (home_score == null || away_score == null) return;

      // Find the closing spread for this game from odds_cache
      const spread = await this.getClosingSpread(home_team_name, away_team_name, sport, date);
      if (spread == null) {
        // No spread data — can't calculate ATS
        return;
      }

      const finalMargin = home_score - away_score; // Positive = home won outright
      // Spread is from home team perspective (e.g., -7.5 means home favored by 7.5)
      const homeCovered = (finalMargin + spread) > 0;
      const awayCovered = (finalMargin + spread) < 0;
      const isPush = (finalMargin + spread) === 0;

      // Record for home team
      await this.upsertATSRecord({
        team_name: home_team_name,
        sport,
        game_date: date,
        opponent: away_team_name,
        spread: spread,
        final_margin: finalMargin,
        covered: isPush ? false : homeCovered,
        push: isPush,
        home_away: 'home',
        final_score_home: home_score,
        final_score_away: away_score,
        game_result_id: gameResultId
      });

      // Record for away team (spread is inverted)
      await this.upsertATSRecord({
        team_name: away_team_name,
        sport,
        game_date: date,
        opponent: home_team_name,
        spread: -spread,
        final_margin: -finalMargin,
        covered: isPush ? false : awayCovered,
        push: isPush,
        home_away: 'away',
        final_score_home: home_score,
        final_score_away: away_score,
        game_result_id: gameResultId
      });

      logger.info(`ATS recorded: ${away_team_name} @ ${home_team_name} — spread ${spread}, margin ${finalMargin}, ${isPush ? 'PUSH' : homeCovered ? 'HOME covered' : 'AWAY covered'}`);

    } catch (err) {
      logger.error('ATS recording error:', err.message);
    }
  }

  /**
   * Find the closing spread for a game from odds_cache.
   * Returns the spread from the home team's perspective (negative = home favored).
   */
  async getClosingSpread(homeTeam, awayTeam, sport, gameDate) {
    try {
      // Map sport names to odds_cache sport slugs
      const sportSlugMap = {
        'NBA': 'basketball_nba',
        'NCAAB': 'basketball_ncaab',
        'NHL': 'icehockey_nhl',
        'MLB': 'baseball_mlb',
        'NFL': 'americanfootball_nfl',
        'NCAAF': 'americanfootball_ncaaf',
        'EPL': 'soccer_epl'
      };

      const sportSlug = sportSlugMap[sport] || sport;

      // Look for spread odds matching this game
      const { data, error } = await this.supabase
        .from('odds_cache')
        .select('outcomes, home_team, away_team')
        .eq('sport', sportSlug)
        .eq('market_type', 'spreads')
        .or(`home_team.ilike.%${this.mascot(homeTeam)}%,away_team.ilike.%${this.mascot(homeTeam)}%`)
        .order('last_updated', { ascending: false })
        .limit(5);

      if (error || !data?.length) return null;

      // Find the matching game
      for (const row of data) {
        const isMatch = this.teamsMatch(row.home_team, homeTeam) || this.teamsMatch(row.away_team, awayTeam);
        if (!isMatch) continue;

        const outcomes = typeof row.outcomes === 'string' ? JSON.parse(row.outcomes) : row.outcomes;
        if (!Array.isArray(outcomes)) continue;

        // Find the home team's spread
        for (const o of outcomes) {
          if (this.teamsMatch(o.name, homeTeam) && o.point != null) {
            return parseFloat(o.point);
          }
        }
      }

      return null;
    } catch (err) {
      logger.error('Error fetching closing spread:', err.message);
      return null;
    }
  }

  /**
   * Upsert an ATS record (won't duplicate if game already recorded)
   */
  async upsertATSRecord(record) {
    const { error } = await this.supabase
      .from('team_ats_records')
      .upsert(record, { onConflict: 'team_name,sport,game_date,opponent' });

    if (error && !error.message.includes('duplicate')) {
      logger.error('ATS upsert error:', error.message);
    }
  }

  /**
   * Get ATS record for a team (last N games)
   */
  async getTeamATS(teamName, sport, limit = 20) {
    try {
      const mascot = this.mascot(teamName);
      const { data, error } = await this.supabase
        .from('team_ats_records')
        .select('*')
        .eq('sport', sport)
        .ilike('team_name', `%${mascot}%`)
        .order('game_date', { ascending: false })
        .limit(limit);

      if (error || !data?.length) return null;

      const covers = data.filter(r => r.covered).length;
      const losses = data.filter(r => !r.covered && !r.push).length;
      const pushes = data.filter(r => r.push).length;

      // Home/away splits
      const homeGames = data.filter(r => r.home_away === 'home');
      const awayGames = data.filter(r => r.home_away === 'away');
      const homeCovers = homeGames.filter(r => r.covered).length;
      const awayCovers = awayGames.filter(r => r.covered).length;

      // Last 5
      const last5 = data.slice(0, 5);
      const last5Covers = last5.filter(r => r.covered).length;

      return {
        team: teamName,
        sport,
        ats: `${covers}-${losses}${pushes > 0 ? `-${pushes}` : ''}`,
        covers,
        losses,
        pushes,
        total: data.length,
        coverPct: data.length > 0 ? Math.round((covers / (covers + losses)) * 100) : null,
        homeATS: `${homeCovers}-${homeGames.length - homeCovers - homeGames.filter(r=>r.push).length}`,
        awayATS: `${awayCovers}-${awayGames.length - awayCovers - awayGames.filter(r=>r.push).length}`,
        last5ATS: `${last5Covers}-${last5.length - last5Covers - last5.filter(r=>r.push).length}`,
        recentGames: data.slice(0, 5).map(r => ({
          date: r.game_date,
          opponent: r.opponent,
          spread: r.spread,
          margin: r.final_margin,
          covered: r.covered,
          push: r.push
        }))
      };
    } catch (err) {
      logger.error('Error getting team ATS:', err.message);
      return null;
    }
  }

  /**
   * Batch process all recent game_results that don't have ATS records yet
   */
  async backfillATS(days = 30) {
    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const { data: games, error } = await this.supabase
        .from('game_results')
        .select('id, home_team_name, away_team_name, home_score, away_score, sport, date')
        .eq('status', 'final')
        .gte('date', cutoff)
        .order('date', { ascending: false });

      if (error || !games?.length) {
        logger.info('No games to backfill ATS');
        return { processed: 0 };
      }

      let processed = 0;
      for (const game of games) {
        // Check if already recorded
        const { data: existing } = await this.supabase
          .from('team_ats_records')
          .select('id')
          .eq('team_name', game.home_team_name)
          .eq('game_date', game.date)
          .eq('opponent', game.away_team_name)
          .limit(1);

        if (existing?.length > 0) continue;

        await this.recordATS(game);
        processed++;
      }

      logger.info(`ATS backfill: processed ${processed} games`);
      return { processed, total: games.length };

    } catch (err) {
      logger.error('ATS backfill error:', err.message);
      return { processed: 0, error: err.message };
    }
  }

  mascot(teamName) {
    return (teamName || '').split(' ').pop().toLowerCase();
  }

  teamsMatch(name1, name2) {
    return sharedTeamsMatch(name1, name2);
  }
}

module.exports = ATSTracker;
