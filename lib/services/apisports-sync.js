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
        try {
          // Check if team exists
          const { data: existing, error: existError } = await this.supabase
            .from('teams')
            .select('id')
            .eq('apisports_id', team.id)
            .eq('apisports_league', leagueName)
            .maybeSingle();

          if (existError) {
            logger.error(`Error checking team ${team.name}:`, existError);
            continue;
          }

          if (existing) {
            // Update existing team (just refresh the name in case it changed)
            const { error: updateError } = await this.supabase
              .from('teams')
              .update({
                name: team.name
              })
              .eq('id', existing.id);
            
            if (updateError) {
              logger.error(`Error updating team ${team.name}:`, updateError);
              continue;
            }
            logger.info(`  ✓ Updated: ${team.name}`);
          } else {
            // Insert new team
            const { error: insertError } = await this.supabase
              .from('teams')
              .insert({
                name: team.name,
                sport: leagueName === 'nfl' ? 'NFL' : 'NCAAF', // Map to sport column
                apisports_id: team.id,
                apisports_league: leagueName
              });
            
            if (insertError) {
              logger.error(`Error inserting team ${team.name}:`, insertError);
              continue;
            }
            logger.info(`  ✓ Inserted: ${team.name}`);
          }
          synced++;
        } catch (error) {
          logger.error(`Exception syncing team ${team.name}:`, error);
        }
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
        const { data: team, error: teamError } = await this.supabase
          .from('teams')
          .select('id')
          .eq('apisports_id', standing.team.id)
          .maybeSingle();

        if (!team || teamError) {
          logger.warn(`Team not found: ${standing.team.name} (ID: ${standing.team.id})`);
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
   * Fetches injuries for all teams in the database
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

      // Get all teams to fetch injuries for
      const { data: teams, error: teamsError } = await this.supabase
        .from('teams')
        .select('id, name, apisports_id')
        .not('apisports_id', 'is', null);

      if (teamsError) {
        logger.error('Error fetching teams:', teamsError);
        return { synced: 0 };
      }

      if (!teams || teams.length === 0) {
        logger.warn('No teams found - sync teams first');
        return { synced: 0 };
      }

      logger.info(`  Found ${teams.length} teams to check for injuries`);


      let synced = 0;
      // Fetch injuries for each team
      for (const dbTeam of teams) {
        try {
          const result = await this.apiClient.getTeamInjuries(dbTeam.apisports_id);
          
          if (!result.response || result.response.length === 0) continue;

          for (const injury of result.response) {
            try {
              // Find or create player
              let playerId;
              const { data: existingPlayer, error: playerLookupError } = await this.supabase
                .from('players')
                .select('id')
                .eq('apisports_id', injury.player.id)
                .eq('league', leagueName)
                .maybeSingle();

              if (playerLookupError) {
                logger.error(`Error looking up player ${injury.player.name}:`, playerLookupError);
                continue;
              }

              if (existingPlayer) {
                playerId = existingPlayer.id;
              } else {
                // Create player
                const { data: newPlayer, error: playerInsertError } = await this.supabase
                  .from('players')
                  .insert({
                    apisports_id: injury.player.id,
                    name: injury.player.name,
                    team_id: dbTeam.id,
                    position: injury.player.position || null,
                    sport: leagueName === 'nfl' ? 'NFL' : 'NCAAF', // Required sport field
                    league: leagueName,
                    active: true
                  })
                  .select('id')
                  .single();
                
                if (playerInsertError) {
                  logger.error(`Error inserting player ${injury.player.name}:`, playerInsertError);
                  continue;
                }
                playerId = newPlayer?.id;
              }

              if (!playerId) {
                logger.warn(`No player ID for ${injury.player.name}`);
                continue;
              }

              // Insert current injury
              const { error: injuryInsertError } = await this.supabase
                .from('injuries')
                .insert({
                  player_id: playerId,
                  team_id: dbTeam.id,
                  status: injury.status || 'Unknown',
                  injury_type: injury.injury?.type || null,
                  description: injury.injury?.description || null,
                  date_reported: injury.date || new Date().toISOString().split('T')[0],
                  is_current: true
                });

              if (injuryInsertError) {
                logger.error(`Error inserting injury for ${injury.player.name}:`, injuryInsertError);
                continue;
              }

              synced++;
            } catch (error) {
              logger.error(`Exception processing injury for ${injury.player?.name}:`, error);
            }
          }
        } catch (error) {
          logger.error(`Error syncing injuries for ${dbTeam.name}:`, error.message);
        }
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
   * Sync game statistics (team + player stats)
   * Optimized: ONE call to get all season games, then stats per game
   * @param {boolean} onlyNew - If true, only sync games we haven't synced yet
   */
  async syncRecentGameStats(onlyNew = false, season = null, league = 1) {
    const leagueName = league === 1 ? 'nfl' : 'ncaaf';
    season = season || this.apiClient.getCurrentSeason();
    
    const mode = onlyNew ? 'new games only' : 'all season games';
    logger.info(`📊 Syncing game stats (${mode}) for ${leagueName.toUpperCase()} ${season}...`);

    try {
      // Get team lookup map
      const { data: teams } = await this.supabase
        .from('teams')
        .select('id, name, apisports_id')
        .eq('apisports_league', leagueName)
        .not('apisports_id', 'is', null);

      if (!teams || teams.length === 0) {
        logger.warn('No teams found in database');
        return { teamGames: 0, playerGames: 0 };
      }

      const teamMap = new Map(teams.map(t => [t.apisports_id, t]));
      
      // Get already synced game IDs if in incremental mode
      let syncedGameIds = new Set();
      if (onlyNew) {
        const { data: syncedGames } = await this.supabase
          .from('team_stats_detailed')
          .select('game_id')
          .eq('season', season);
        
        if (syncedGames) {
          syncedGameIds = new Set(syncedGames.map(g => g.game_id));
          logger.info(`  Found ${syncedGameIds.size} already synced games, will skip them`);
        }
      }

      // Get ALL games for the season in ONE API call!
      logger.info(`  Fetching all ${season} season games...`);
      const gamesResult = await this.apiClient.getAllSeasonGames(season, league);
      
      if (!gamesResult.response || gamesResult.response.length === 0) {
        logger.info(`    No games found for season ${season}`);
        return { teamGames: 0, playerGames: 0 };
      }

      // Filter to completed games only (status = 'FT')
      let completedGames = gamesResult.response.filter(g => g.game.status.short === 'FT');
      
      // Filter out already synced games if in incremental mode
      if (onlyNew) {
        completedGames = completedGames.filter(g => !syncedGameIds.has(g.game.id.toString()));
      }
      
      logger.info(`  Found ${completedGames.length} games to sync`);

      let teamGamesProcessed = 0;
      let playerGamesProcessed = 0;

      // Process each game
      for (const game of completedGames) {
        const gameId = game.game.id;
        const week = game.game.week;

        try {
          // Fetch team stats for this game (gets both teams in one call)
          const teamStatsResult = await this.apiClient.getGameTeamStats(gameId);
          
          if (teamStatsResult.response && teamStatsResult.response.length > 0) {
            for (const teamData of teamStatsResult.response) {
              const dbTeam = teamMap.get(teamData.team.id);
              if (!dbTeam) continue;

              const stats = teamData.statistics;
              
              await this.supabase
                .from('team_stats_detailed')
                .upsert({
                  team_id: dbTeam.id,
                  season,
                  week,
                  game_id: gameId.toString(),
                  points_per_game: stats.points || null,
                  total_yards_per_game: (stats.total_yards || 0),
                  passing_yards_per_game: (stats.passing?.yards || 0),
                  rushing_yards_per_game: (stats.rushing?.yards || 0),
                  turnovers_lost: (stats.turnovers || 0),
                  updated_at: new Date().toISOString()
                }, {
                  onConflict: 'team_id,season,week'
                });

              teamGamesProcessed++;
            }
          }

          // Fetch player stats for this game (gets all players in one call)
          const playerStatsResult = await this.apiClient.getGamePlayerStats(gameId);
          
          if (playerStatsResult.response && playerStatsResult.response.length > 0) {
            // Response structure: [{team: {...}, groups: [{name: "Passing", players: [...]}]}]
            for (const teamData of playerStatsResult.response) {
              const dbTeam = teamMap.get(teamData.team.id);
              if (!dbTeam || !teamData.groups) continue;

              // Loop through stat groups (Passing, Rushing, Receiving, etc.)
              for (const group of teamData.groups) {
                if (!group.players) continue;

                // Loop through players in this group
                for (const playerEntry of group.players) {
                  try {
                    const player = playerEntry.player;
                    const statsArray = playerEntry.statistics;

                    // Find or create player
                    let playerId;
                    const { data: existingPlayer } = await this.supabase
                      .from('players')
                      .select('id')
                      .eq('apisports_id', player.id)
                      .eq('league', leagueName)
                      .maybeSingle();

                    if (existingPlayer) {
                      playerId = existingPlayer.id;
                    } else {
                      const { data: newPlayer } = await this.supabase
                        .from('players')
                        .insert({
                          apisports_id: player.id,
                          name: player.name,
                          team_id: dbTeam.id,
                          position: group.name, // Use group as position hint
                          sport: leagueName === 'nfl' ? 'NFL' : 'NCAAF',
                          league: leagueName,
                          active: true
                        })
                        .select('id')
                        .single();
                      playerId = newPlayer?.id;
                    }

                    if (!playerId) continue;

                    // Convert stats array to object for easier access
                    const stats = {};
                    if (statsArray) {
                      for (const stat of statsArray) {
                        if (stat.value !== null && stat.value !== undefined) {
                          stats[stat.name] = stat.value;
                        }
                      }
                    }

                    // Parse numeric values, handle fractions like "1/1"
                    const parseStatValue = (value) => {
                      if (!value) return null;
                      if (typeof value === 'number') return value;
                      const str = value.toString();
                      if (str.includes('/')) {
                        const parts = str.split('/');
                        return parseInt(parts[0]) || null;
                      }
                      return parseInt(str) || null;
                    };
                    
                    // Store player game stats (merged across all groups)
                    const { data: existing } = await this.supabase
                      .from('player_game_stats')
                      .select('*')
                      .eq('player_id', playerId)
                      .eq('game_id', gameId.toString())
                      .maybeSingle();

                    const statRecord = {
                      player_id: playerId,
                      game_id: gameId.toString(),
                      game_date: game.game.date.date,
                      opponent_team_id: null,
                      // Passing stats
                      passing_attempts: parseStatValue(stats['attempts']) || existing?.passing_attempts || null,
                      passing_completions: parseStatValue(stats['completions']) || existing?.passing_completions || null,
                      passing_yards: parseStatValue(stats['yards']) || existing?.passing_yards || null,
                      passing_touchdowns: parseStatValue(stats['td'] || stats['touchdowns']) || existing?.passing_touchdowns || null,
                      interceptions: parseStatValue(stats['interceptions'] || stats['int']) || existing?.interceptions || null,
                      // Rushing stats
                      rushing_attempts: parseStatValue(stats['carries'] || stats['rushing attempts']) || existing?.rushing_attempts || null,
                      rushing_yards: parseStatValue(stats['rushing yards'] || (group.name === 'Rushing' ? stats['yards'] : null)) || existing?.rushing_yards || null,
                      rushing_touchdowns: parseStatValue(stats['rushing td'] || (group.name === 'Rushing' ? stats['td'] : null)) || existing?.rushing_touchdowns || null,
                      // Receiving stats
                      receptions: parseStatValue(stats['receptions'] || stats['rec']) || existing?.receptions || null,
                      receiving_yards: parseStatValue(stats['receiving yards'] || (group.name === 'Receiving' ? stats['yards'] : null)) || existing?.receiving_yards || null,
                      receiving_touchdowns: parseStatValue(stats['receiving td'] || (group.name === 'Receiving' ? stats['td'] : null)) || existing?.receiving_touchdowns || null,
                      targets: parseStatValue(stats['targets'] || stats['tgt']) || existing?.targets || null,
                      // Defense stats
                      tackles: parseStatValue(stats['tackles']) || existing?.tackles || null,
                      sacks: parseStatValue(stats['sacks']) || existing?.sacks || null,
                    };

                    await this.supabase
                      .from('player_game_stats')
                      .upsert(statRecord, {
                        onConflict: 'player_id,game_id'
                      });

                    playerGamesProcessed++;
                  } catch (playerError) {
                    logger.error(`Error storing player ${playerEntry.player?.name}:`, playerError.message);
                  }
                }
              }
            }
          }

          if ((teamGamesProcessed + playerGamesProcessed) % 50 === 0) {
            logger.info(`  Progress: ${teamGamesProcessed} team stats, ${playerGamesProcessed} player stats...`);
          }

        } catch (gameError) {
          logger.error(`Error processing game ${gameId}:`, gameError.message);
        }
      }

      logger.info(`  ✅ Processed ${teamGamesProcessed} team game stats, ${playerGamesProcessed} player game stats`);
      await this.logSync('game_stats', leagueName, season, 'completed', teamGamesProcessed + playerGamesProcessed);
      return { teamGames: teamGamesProcessed, playerGames: playerGamesProcessed };

    } catch (error) {
      logger.error('Error syncing game stats:', error);
      await this.logSync('game_stats', leagueName, season, 'failed', 0, error);
      throw error;
    }
  }

  /**
   * Daily sync routine (call this from a cron job)
   * Note: Teams are synced once and don't need daily updates
   */
  async dailySync(league = 1) {
    const leagueName = league === 1 ? 'nfl' : 'ncaaf';
    logger.info(`🔄 Starting daily sync for ${leagueName.toUpperCase()}...`);

    const results = {
      standings: await this.syncStandings(),
      injuries: await this.syncInjuries(),
      // Teams already synced - skip to save API calls
    };

    logger.info(`✅ Daily sync complete for ${leagueName.toUpperCase()}`);
    return results;
  }

  /**
   * Weekly sync routine for game stats (call this once a week)
   * Only syncs NEW games since last sync - super efficient!
   */
  async weeklySync(season = null, league = 1) {
    const leagueName = league === 1 ? 'nfl' : 'ncaaf';
    season = season || this.apiClient.getCurrentSeason();
    logger.info(`📊 Starting weekly game stats sync for ${leagueName.toUpperCase()}...`);

    const results = {
      gameStats: await this.syncRecentGameStats(true, season, league), // onlyNew = true
    };

    logger.info(`✅ Weekly sync complete for ${leagueName.toUpperCase()}`);
    return results;
  }
}

module.exports = ApiSportsSync;
