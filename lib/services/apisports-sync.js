/**
 * API-Sports Sync Service
 * Syncs NFL/NCAAF data from API-Sports into Supabase
 */

const { createClient } = require('@supabase/supabase-js');
const ApiSportsClient = require('./apisports-client');
const { logger } = require('../../shared/logger');

class ApiSportsSync {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.apiClient = new ApiSportsClient();
  }

  /**
   * Log sync operation
   */
  async logSync(endpoint, league, season, status, recordsUpdated = 0, error = null) {
    try {
      await this.supabase.from('apisports_sync_log').insert({
        endpoint,
        league,
        season,
        sync_started_at: new Date().toISOString(),
        sync_completed_at: status === 'completed' ? new Date().toISOString() : null,
        records_updated: recordsUpdated,
        status,
        error_message: error?.message || null,
        api_calls_used: this.apiClient.callCount
      });
    } catch (err) {
      logger.error('Failed to log sync:', err);
    }
  }

  /**
   * Sync NFL teams (run once or when teams change)
   */
  async syncTeams(season = null, league = 1) {
    const leagueName = league === 1 ? 'nfl' : 'ncaaf';
    season = season || this.apiClient.getCurrentSeason();
    logger.info(`🏈 Syncing ${leagueName.toUpperCase()} teams for ${season} season...`);

    try {
      const result = await this.apiClient.getTeams(season, league);
      
      if (!result.response || result.response.length === 0) {
        logger.warn('No teams returned from API');
        await this.logSync('teams', leagueName, null, 'completed', 0);
        return { synced: 0 };
      }

      let synced = 0;
      for (const team of result.response) {
        // Check if team exists
        const { data: existing } = await this.supabase
          .from('teams')
          .select('id')
          .eq('apisports_id', team.id)
          .eq('apisports_league', leagueName)
          .single();

        if (existing) {
          // Update existing team
          await this.supabase
            .from('teams')
            .update({
              name: team.name,
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id);
        } else {
          // Insert new team
          await this.supabase
            .from('teams')
            .insert({
              name: team.name,
              apisports_id: team.id,
              apisports_league: leagueName
            });
        }
        synced++;
      }

      logger.info(`  ✅ Synced ${synced} teams`);
      await this.logSync('teams', leagueName, null, 'completed', synced);
      return { synced };

    } catch (error) {
      logger.error('Error syncing teams:', error);
      await this.logSync('teams', leagueName, null, 'failed', 0, error);
      throw error;
    }
  }

  /**
   * Sync standings (run daily)
   */
  async syncStandings(season = null, league = 1) {
    const leagueName = league === 1 ? 'nfl' : 'ncaaf';
    season = season || this.apiClient.getCurrentSeason();
    logger.info(`📊 Syncing ${leagueName.toUpperCase()} standings for ${season}...`);

    try {
      const result = await this.apiClient.getStandings(season, league);
      
      if (!result.response || result.response.length === 0) {
        logger.warn('No standings returned from API');
        await this.logSync('standings', leagueName, season, 'completed', 0);
        return { synced: 0 };
      }

      let synced = 0;
      for (const standing of result.response) {
        // Find team by apisports_id
        const { data: team } = await this.supabase
          .from('teams')
          .select('id')
          .eq('apisports_id', standing.team.id)
          .eq('apisports_league', leagueName)
          .single();

        if (!team) {
          logger.warn(`Team not found: ${standing.team.name}`);
          continue;
        }

        // Upsert standing
        await this.supabase
          .from('standings')
          .upsert({
            team_id: team.id,
            season,
            conference: standing.conference?.name || null,
            division: standing.division?.name || null,
            wins: standing.won || 0,
            losses: standing.lost || 0,
            ties: standing.ties || 0,
            points_for: standing.points?.for || 0,
            points_against: standing.points?.against || 0,
            point_differential: (standing.points?.for || 0) - (standing.points?.against || 0),
            streak: standing.streak || null,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'team_id,season'
          });

        synced++;
      }

      logger.info(`  ✅ Synced ${synced} standings`);
      await this.logSync('standings', leagueName, season, 'completed', synced);
      return { synced };

    } catch (error) {
      logger.error('Error syncing standings:', error);
      await this.logSync('standings', leagueName, season, 'failed', 0, error);
      throw error;
    }
  }

  /**
   * Sync injuries (CRITICAL - run daily!)
   */
  async syncInjuries(season = null, league = 1) {
    const leagueName = league === 1 ? 'nfl' : 'ncaaf';
    season = season || this.apiClient.getCurrentSeason();
    logger.info(`🏥 Syncing ${leagueName.toUpperCase()} injuries...`);

    try {
      // Mark all current injuries as not current
      await this.supabase
        .from('injuries')
        .update({ is_current: false })
        .eq('is_current', true);

      const result = await this.apiClient.getInjuries();
      
      if (!result.response || result.response.length === 0) {
        logger.info('  No injuries reported (good news!)');
        await this.logSync('injuries', leagueName, season, 'completed', 0);
        return { synced: 0 };
      }

      let synced = 0;
      for (const injury of result.response) {
        // Find team
        const { data: team } = await this.supabase
          .from('teams')
          .select('id')
          .eq('apisports_id', injury.team.id)
          .eq('apisports_league', leagueName)
          .single();

        if (!team) continue;

        // Find or create player
        let playerId;
        const { data: existingPlayer } = await this.supabase
          .from('players')
          .select('id')
          .eq('apisports_id', injury.player.id)
          .eq('league', leagueName)
          .single();

        if (existingPlayer) {
          playerId = existingPlayer.id;
        } else {
          // Create player
          const { data: newPlayer } = await this.supabase
            .from('players')
            .insert({
              apisports_id: injury.player.id,
              name: injury.player.name,
              team_id: team.id,
              position: injury.player.position || null,
              league: leagueName,
              active: true
            })
            .select('id')
            .single();
          playerId = newPlayer?.id;
        }

        if (!playerId) continue;

        // Insert current injury
        await this.supabase
          .from('injuries')
          .insert({
            player_id: playerId,
            team_id: team.id,
            status: injury.status || 'Unknown',
            injury_type: injury.injury?.type || null,
            description: injury.injury?.description || null,
            date_reported: injury.date || new Date().toISOString().split('T')[0],
            is_current: true
          });

        synced++;
      }

      logger.info(`  ✅ Synced ${synced} injuries`);
      await this.logSync('injuries', leagueName, season, 'completed', synced);
      return { synced };

    } catch (error) {
      logger.error('Error syncing injuries:', error);
      await this.logSync('injuries', leagueName, season, 'failed', 0, error);
      throw error;
    }
  }

  /**
   * Sync player statistics for recent games
   */
  async syncRecentPlayerStats(teamId, numGames = 5) {
    logger.info(`📈 Syncing recent player stats for team ${teamId} (last ${numGames} games)...`);

    try {
      const season = this.apiClient.getCurrentSeason();
      
      // Get recent games for team
      const gamesResult = await this.apiClient.getTeamGames(teamId, season);
      
      if (!gamesResult.response || gamesResult.response.length === 0) {
        return { synced: 0 };
      }

      // Take last N games
      const recentGames = gamesResult.response.slice(-numGames);
      let synced = 0;

      for (const game of recentGames) {
        // Get player stats for this game
        const statsResult = await this.apiClient.getGamePlayerStats(game.game.id);
        
        if (!statsResult.response) continue;

        for (const playerStats of statsResult.response) {
          // Find player
          const { data: player } = await this.supabase
            .from('players')
            .select('id')
            .eq('apisports_id', playerStats.player.id)
            .single();

          if (!player) continue;

          // Find opponent team
          const opponentTeamId = game.teams.home.id === teamId ? 
            game.teams.away.id : game.teams.home.id;

          const { data: opponentTeam } = await this.supabase
            .from('teams')
            .select('id')
            .eq('apisports_id', opponentTeamId)
            .single();

          // Upsert player game stats
          await this.supabase
            .from('player_game_stats')
            .upsert({
              player_id: player.id,
              game_id: game.game.id.toString(),
              game_date: game.game.date.split('T')[0],
              opponent_team_id: opponentTeam?.id || null,
              passing_attempts: playerStats.statistics?.passing?.attempts || null,
              passing_completions: playerStats.statistics?.passing?.completions || null,
              passing_yards: playerStats.statistics?.passing?.yards || null,
              passing_touchdowns: playerStats.statistics?.passing?.touchdowns || null,
              interceptions: playerStats.statistics?.passing?.interceptions || null,
              rushing_attempts: playerStats.statistics?.rushing?.attempts || null,
              rushing_yards: playerStats.statistics?.rushing?.yards || null,
              rushing_touchdowns: playerStats.statistics?.rushing?.touchdowns || null,
              receptions: playerStats.statistics?.receiving?.receptions || null,
              receiving_yards: playerStats.statistics?.receiving?.yards || null,
              receiving_touchdowns: playerStats.statistics?.receiving?.touchdowns || null,
              targets: playerStats.statistics?.receiving?.targets || null
            }, {
              onConflict: 'player_id,game_id'
            });

          synced++;
        }
      }

      logger.info(`  ✅ Synced ${synced} player game stats`);
      return { synced };

    } catch (error) {
      logger.error('Error syncing player stats:', error);
      throw error;
    }
  }

  /**
   * Sync team season statistics (offensive/defensive rankings)
   */
  async syncTeamStats(season = null, league = 1) {
    const leagueName = league === 1 ? 'nfl' : 'ncaaf';
    season = season || this.apiClient.getCurrentSeason();
    logger.info(`📊 Syncing ${leagueName.toUpperCase()} team statistics for ${season}...`);

    try {
      // Get all teams first
      const { data: teams } = await this.supabase
        .from('teams')
        .select('id, name, apisports_id')
        .eq('apisports_league', leagueName)
        .not('apisports_id', 'is', null);

      if (!teams || teams.length === 0) {
        logger.warn('No teams found in database');
        return { synced: 0 };
      }

      let synced = 0;
      for (const team of teams) {
        try {
          const statsResult = await this.apiClient.getTeamSeasonStats(team.apisports_id, season);
          
          if (!statsResult.response || statsResult.response.length === 0) continue;

          const stats = statsResult.response[0].statistics || {};
          
          // Upsert team stats
          await this.supabase
            .from('team_stats_detailed')
            .upsert({
              team_id: team.id,
              season,
              week: null, // Season totals
              points_per_game: stats.points?.average || null,
              total_yards_per_game: stats.total_yards?.average || null,
              passing_yards_per_game: stats.passing_yards?.average || null,
              rushing_yards_per_game: stats.rushing_yards?.average || null,
              turnovers_lost: stats.turnovers || null,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'team_id,season,week'
            });

          synced++;
          logger.info(`    ✓ Synced stats for ${team.name}`);
        } catch (error) {
          logger.error(`Error syncing stats for ${team.name}:`, error.message);
        }
      }

      logger.info(`  ✅ Synced ${synced} team stats`);
      await this.logSync('team_stats', leagueName, season, 'completed', synced);
      return { synced };

    } catch (error) {
      logger.error('Error syncing team stats:', error);
      await this.logSync('team_stats', leagueName, season, 'failed', 0, error);
      throw error;
    }
  }

  /**
   * Full daily sync (the main function to call)
   */
  async dailySync() {
    logger.info('\n🔄 Starting daily API-Sports sync...\n');
    
    const results = {
      teams: 0,
      standings: 0,
      injuries: 0,
      teamStats: 0,
      errors: []
    };

    try {
      // 1. Sync teams (only if needed - usually skip this after initial setup)
      // results.teams = (await this.syncTeams()).synced;
      
      // 2. Sync standings
      results.standings = (await this.syncStandings()).synced;
      
      // 3. Sync injuries (MOST IMPORTANT)
      results.injuries = (await this.syncInjuries()).synced;
      
      // 4. Sync team stats (weekly or after games)
      // results.teamStats = (await this.syncTeamStats()).synced;
      
      logger.info('\n✅ Daily sync complete!');
      logger.info(`  Teams: ${results.teams}`);
      logger.info(`  Standings: ${results.standings}`);
      logger.info(`  Injuries: ${results.injuries}`);
      logger.info(`  Team Stats: ${results.teamStats}`);
      logger.info(`  API calls used: ${this.apiClient.callCount}/100\n`);
      
      return results;

    } catch (error) {
      logger.error('Daily sync failed:', error);
      results.errors.push(error.message);
      return results;
    }
  }
}

module.exports = ApiSportsSync;
