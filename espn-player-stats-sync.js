const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

class ESPNPlayerStatsSync {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Focus on prop betting relevant sports for current season
    // 2025 season: only NFL and NBA for now (MLB stats skipped)
    this.sports = {
      'NFL': {
        path: 'football/nfl',
        currentSeason: 2025,
        statsPeriod: 'season'
      },
      'NBA': {
        path: 'basketball/nba',
        currentSeason: 2025,
        statsPeriod: 'season'
      }
    };
  }

  /**
   * Main function to sync all player stats from ESPN
   */
  async syncAllPlayerStats() {
    console.log('📊 Starting ESPN Player Stats Sync for Prop Betting\n');
    
    const results = { 
      total_players_updated: 0, 
      sports_completed: 0,
      errors: [],
      stats_by_sport: {}
    };

    for (const [sport, config] of Object.entries(this.sports)) {
      try {
        console.log(`🏈 Syncing ${sport} player stats...`);
        const sportResult = await this.syncSportPlayerStats(sport, config);
        
        results.total_players_updated += sportResult.players_updated;
        results.sports_completed += 1;
        results.stats_by_sport[sport] = sportResult;
        
        console.log(`✅ ${sport}: ${sportResult.players_updated} players updated\n`);
        
        // Rate limiting between sports
        await this.sleep(2000);
        
      } catch (error) {
        console.error(`❌ Error syncing ${sport} stats:`, error.message);
        results.errors.push(`${sport}: ${error.message}`);
      }
    }

    console.log('🎯 Player stats sync completed:', results);
    return results;
  }

  /**
   * Sync player stats for one sport
   */
  async syncSportPlayerStats(sport, config) {
    try {
      // Get our cached players for this sport
      const { data: players, error } = await this.supabase
        .from('players')
        .select('id, name, provider_ids')
        .eq('sport', sport.toLowerCase())
        .limit(300); // Start with 50 players for testing

      if (error) throw error;

      console.log(`  📋 Found ${players.length} cached ${sport} players`);

      let playersUpdated = 0;
      const statsSamples = [];

      // Process each player
      for (const player of players) {
        try {
          const espnData = JSON.parse(player.provider_ids || '{}');
          const espnPlayerId = espnData.espn_id;
          
          if (!espnPlayerId) {
            console.log(`    ⚠️ No ESPN ID for ${player.name}, skipping`);
            continue;
          }

          console.log(`    📊 Fetching stats for ${player.name}...`);
          
          const stats = await this.fetchPlayerStats(espnPlayerId, sport, config);
          
          if (stats && Object.keys(stats).length > 0) {
            await this.updatePlayerStats(player.id, stats);
            playersUpdated++;
            statsSamples.push({ name: player.name, stats });
            
            console.log(`      ✅ Updated stats for ${player.name}`);
          } else {
            console.log(`      ⚠️ No stats found for ${player.name}`);
          }
          
          // Rate limiting per player
          await this.sleep(800);
          
        } catch (playerError) {
          console.error(`    ❌ Error processing ${player.name}:`, playerError.message);
        }
      }

      return {
        players_updated: playersUpdated,
        total_players: players.length,
        sample_stats: statsSamples.slice(0, 3) // Show first 3 as examples
      };

    } catch (error) {
      console.error(`Error syncing ${sport} player stats:`, error);
      throw error;
    }
  }

  /**
   * Fetch player statistics from ESPN API
   */
  async fetchPlayerStats(playerId, sport, config) {
    try {
      const sportKey = config.path.split('/')[0];
      const leagueKey = config.path.split('/')[1];

      // 1) Fetch the season-specific athlete resource to discover the stats URL
      const athleteUrl = `https://sports.core.api.espn.com/v2/sports/${sportKey}/leagues/${leagueKey}/seasons/${config.currentSeason}/athletes/${playerId}`;
      console.log(`      📡 Fetching athlete from ESPN: ${athleteUrl}`);

      const athleteResponse = await fetch(athleteUrl);

      if (!athleteResponse.ok) {
        if (athleteResponse.status === 404) {
          console.log(`      ℹ️ No athlete resource for player ${playerId} (404)`);
          return null;
        }
        throw new Error(`ESPN athlete API request failed: ${athleteResponse.status}`);
      }

      const athleteData = await athleteResponse.json();

      const statsRef = athleteData.statistics && athleteData.statistics.$ref;
      if (!statsRef) {
        console.log(`      ℹ️ No stats reference found for player ${playerId}`);
        return null;
      }

      // 2) Follow the statistics.$ref URL, which includes the correct /types/{id}/athletes/{playerId}/statistics path
      console.log(`      📡 Fetching stats from ESPN: ${statsRef}`);
      const statsResponse = await fetch(statsRef);

      if (!statsResponse.ok) {
        if (statsResponse.status === 404) {
          console.log(`      ℹ️ No stats available for player ${playerId} (404)`);
          return null;
        }
        throw new Error(`ESPN stats API request failed: ${statsResponse.status}`);
      }

      let statsData = await statsResponse.json();

      // Some ESPN stats resources expose splits via a nested $ref; follow it if present
      if (statsData && statsData.splits && statsData.splits.$ref) {
        const splitsUrl = statsData.splits.$ref;
        console.log(`      📡 Fetching stats splits from ESPN: ${splitsUrl}`);
        const splitsResponse = await fetch(splitsUrl);
        if (splitsResponse.ok) {
          const splitsData = await splitsResponse.json();
          // Prefer the splits array from this payload
          if (Array.isArray(splitsData.splits)) {
            statsData = splitsData;
          } else {
            statsData = { splits: splitsData.splits || splitsData.items || [] };
          }
        }
      }

      // Extract meaningful stats based on sport
      const stats = this.normalizePlayerStats(statsData, sport);

      return stats;

    } catch (error) {
      console.error(`Error fetching stats for player ${playerId}:`, error.message);
      return null;
    }
  }

  /**
   * Normalize player stats from different sports for prop betting
   */
  normalizePlayerStats(apiData, sport) {
    const stats = {
      last_updated: new Date().toISOString(),
      api_source: 'espn',
      season: this.sports[sport]?.currentSeason || null
    };

    try {
      if (!apiData || !apiData.splits) {
        return stats;
      }

      // Normalize splits structure (can be array or nested under another object)
      let splitsArray = apiData.splits;
      if (!Array.isArray(splitsArray)) {
        if (Array.isArray(splitsArray.splits)) {
          splitsArray = splitsArray.splits;
        } else if (Array.isArray(splitsArray.items)) {
          splitsArray = splitsArray.items;
        }
      }

      if (!Array.isArray(splitsArray) || splitsArray.length === 0) {
        return stats;
      }

      // Look for season stats in the splits
      const currentSeason = this.sports[sport]?.currentSeason;
      const seasonLabel = currentSeason ? String(currentSeason) : '';
      const seasonStats = splitsArray.find(split => 
        split.name === 'Total' || 
        split.name === 'Regular Season' ||
        (seasonLabel && String(split.name).includes(seasonLabel))
      );

      if (!seasonStats || !seasonStats.stats) {
        return stats;
      }

      const rawStats = seasonStats.stats;

      // Normalize stats by sport for prop betting
      switch (sport) {
        case 'NFL':
          stats.nfl = {
            // Passing props
            passing_yards: rawStats.passingYards || 0,
            passing_touchdowns: rawStats.passingTouchdowns || 0,
            completions: rawStats.completions || 0,
            passing_attempts: rawStats.passingAttempts || 0,
            
            // Rushing props  
            rushing_yards: rawStats.rushingYards || 0,
            rushing_touchdowns: rawStats.rushingTouchdowns || 0,
            rushing_attempts: rawStats.rushingAttempts || 0,
            
            // Receiving props
            receptions: rawStats.receptions || 0,
            receiving_yards: rawStats.receivingYards || 0,
            receiving_touchdowns: rawStats.receivingTouchdowns || 0,
            
            // General
            games_played: rawStats.gamesPlayed || 0,
            fantasy_points: rawStats.fantasyPoints || 0
          };
          break;

        case 'NBA':
          stats.nba = {
            // Scoring props
            points: rawStats.points || 0,
            field_goals_made: rawStats.fieldGoalsMade || 0,
            three_pointers_made: rawStats.threePointFieldGoalsMade || 0,
            free_throws_made: rawStats.freeThrowsMade || 0,
            
            // Other props
            rebounds: rawStats.totalRebounds || 0,
            assists: rawStats.assists || 0,
            steals: rawStats.steals || 0,
            blocks: rawStats.blocks || 0,
            
            // Averages (per game)
            points_per_game: rawStats.avgPoints || 0,
            rebounds_per_game: rawStats.avgRebounds || 0,
            assists_per_game: rawStats.avgAssists || 0,
            
            // General
            games_played: rawStats.gamesPlayed || 0,
            minutes_per_game: rawStats.avgMinutes || 0
          };
          break;

        case 'MLB':
          stats.mlb = {
            // Hitting props
            hits: rawStats.hits || 0,
            home_runs: rawStats.homeRuns || 0,
            rbis: rawStats.RBIs || 0,
            runs: rawStats.runs || 0,
            stolen_bases: rawStats.stolenBases || 0,
            
            // Batting average
            batting_average: rawStats.battingAverage || 0,
            on_base_percentage: rawStats.onBasePercentage || 0,
            
            // Pitching props (if applicable)
            wins: rawStats.wins || 0,
            strikeouts: rawStats.strikeouts || 0,
            earned_run_average: rawStats.ERA || 0,
            innings_pitched: rawStats.inningsPitched || 0,
            
            // General
            games_played: rawStats.gamesPlayed || 0
          };
          break;
      }

      return stats;

    } catch (error) {
      console.error('Error normalizing stats:', error);
      return stats;
    }
  }

  /**
   * Update player stats in database
   */
  async updatePlayerStats(playerId, stats) {
    try {
      // Store stats in player_game_stats table or create new stats table
      const statsRecord = {
        player_id: playerId,
        stats: JSON.stringify(stats),
        updated_at: new Date().toISOString()
      };

      // For now, update the player record with latest stats
      const { error } = await this.supabase
        .from('players')
        .update({
          provider_ids: await this.supabase
            .from('players')
            .select('provider_ids')
            .eq('id', playerId)
            .single()
            .then(({ data }) => {
              const existing = JSON.parse(data?.provider_ids || '{}');
              existing.season_stats = stats;
              return JSON.stringify(existing);
            })
        })
        .eq('id', playerId);

      if (error) {
        console.error('Error updating player stats:', error);
        return false;
      }

      return true;

    } catch (error) {
      console.error('Error updating player stats:', error);
      return false;
    }
  }

  /**
   * Get stats summary for verification
   */
  async getStatsSummary() {
    try {
      const { data: players, error } = await this.supabase
        .from('players')
        .select('sport, name, provider_ids')
        .in('sport', ['nfl', 'nba'])
        .limit(100);

      if (error) throw error;

      const summary = {
        players_with_stats: 0,
        by_sport: { nfl: 0, nba: 0 },
        sample_stats: []
      };

      players.forEach(player => {
        try {
          const data = JSON.parse(player.provider_ids || '{}');
          if (data.season_stats) {
            summary.players_with_stats++;
            summary.by_sport[player.sport]++;
            
            if (summary.sample_stats.length < 3) {
              summary.sample_stats.push({
                name: player.name,
                sport: player.sport,
                stats: data.season_stats
              });
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      });

      return summary;

    } catch (error) {
      console.error('Error getting stats summary:', error);
      return null;
    }
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Main execution
async function main() {
  const statsSync = new ESPNPlayerStatsSync();
  
  console.log('🚀 Starting ESPN Player Stats Sync\n');
  
  try {
    // Check current stats status
    console.log('📊 Current stats summary:');
    const currentSummary = await statsSync.getStatsSummary();
    if (currentSummary) {
      console.log(`  Players with stats: ${currentSummary.players_with_stats}`);
      console.log(`  NFL: ${currentSummary.by_sport.nfl} | NBA: ${currentSummary.by_sport.nba}\n`);
    }
    
    // Sync player stats
    const results = await statsSync.syncAllPlayerStats();
    
    console.log('\n🎯 Final Results:');
    console.log(`  Players Updated: ${results.total_players_updated}`);
    console.log(`  Sports Completed: ${results.sports_completed}`);
    
    if (results.errors.length > 0) {
      console.log('  Errors:', results.errors);
    }
    
    // Show sample stats
    Object.entries(results.stats_by_sport).forEach(([sport, data]) => {
      if (data.sample_stats && data.sample_stats.length > 0) {
        console.log(`\n📈 ${sport} Sample Stats:`);
        data.sample_stats.forEach(sample => {
          console.log(`  ${sample.name}:`, Object.keys(sample.stats).join(', '));
        });
      }
    });
    
    console.log('\n✅ Player stats sync completed!');
    console.log('🎯 Ready for prop betting with real player performance data!');
    
  } catch (error) {
    console.error('❌ Stats sync failed:', error);
  }
}

if (require.main === module) {
  main();
}

module.exports = { ESPNPlayerStatsSync, main };