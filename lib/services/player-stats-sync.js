const { createClient } = require('@supabase/supabase-js');

class PlayerStatsSync {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.apiKey = process.env.API_SPORTS_KEY || process.env.APISPORTS_API_KEY;
    this.currentSeason = new Date().getFullYear();
  }

  /**
   * Main function to sync player stats for all sports
   */
  async syncAllPlayerStats() {
    console.log('👤 Starting comprehensive player stats sync...');
    
    const sports = ['NFL', 'NBA', 'MLB', 'NHL'];
    const results = {
      total_processed: 0,
      total_updated: 0,
      sports_completed: 0,
      errors: []
    };

    for (const sport of sports) {
      try {
        console.log(`\n🏃 Syncing ${sport} player stats...`);
        const sportResult = await this.syncSportPlayerStats(sport);
        
        results.total_processed += sportResult.processed;
        results.total_updated += sportResult.updated;
        results.sports_completed += 1;
        
        console.log(`✅ ${sport}: ${sportResult.updated}/${sportResult.processed} players updated`);
        
        // Rate limiting pause
        await this.sleep(2000);
        
      } catch (error) {
        console.error(`❌ Error syncing ${sport} players:`, error.message);
        results.errors.push(`${sport}: ${error.message}`);
      }
    }

    console.log('\n🎯 Player stats sync completed:', results);
    return results;
  }

  /**
   * Sync player stats for a specific sport
   */
  async syncSportPlayerStats(sport) {
    const startTime = new Date();
    
    // Log sync start
    const { data: syncLog } = await this.supabase
      .from('stats_sync_log')
      .insert({
        sync_type: 'player_stats',
        sport: sport,
        start_time: startTime.toISOString()
      })
      .select()
      .single();

    let processed = 0;
    let updated = 0;
    let failed = 0;

    try {
      // Get teams for this sport to fetch their players
      const { data: teams, error: teamsError } = await this.supabase
        .from('team_stats_cache')
        .select('team_id, team_name')
        .eq('sport', sport)
        .limit(10); // Start with limited teams to avoid API limits

      if (teamsError) throw teamsError;

      console.log(`📋 Found ${teams.length} ${sport} teams to sync players for`);

      // Process teams sequentially to avoid overwhelming APIs
      for (const team of teams) {
        try {
          const teamResult = await this.syncTeamPlayers(team, sport);
          processed += teamResult.processed;
          updated += teamResult.updated;
          failed += teamResult.failed;
          
          // Rate limiting between teams
          await this.sleep(1500);
          
        } catch (teamError) {
          console.error(`Error syncing team ${team.team_name}:`, teamError.message);
          failed += 1;
        }
      }

      // Update sync log
      const endTime = new Date();
      const duration = Math.round((endTime - startTime) / 1000);

      await this.supabase
        .from('stats_sync_log')
        .update({
          end_time: endTime.toISOString(),
          duration_seconds: duration,
          records_processed: processed,
          records_updated: updated,
          records_failed: failed,
          status: failed > 0 ? 'partial' : 'completed'
        })
        .eq('id', syncLog.id);

      return { processed, updated, failed };

    } catch (error) {
      // Log sync failure
      await this.supabase
        .from('stats_sync_log')
        .update({
          end_time: new Date().toISOString(),
          status: 'failed',
          error_message: error.message,
          records_processed: processed,
          records_updated: updated,
          records_failed: failed
        })
        .eq('id', syncLog.id);

      throw error;
    }
  }

  /**
   * Sync players for a specific team
   */
  async syncTeamPlayers(team, sport) {
    let processed = 0;
    let updated = 0;
    let failed = 0;

    try {
      // Get player roster for this team (mock data for now)
      const players = await this.getTeamRoster(team.team_id, sport);
      
      console.log(`👥 Found ${players.length} players for ${team.team_name}`);

      // Process players in smaller batches
      const batchSize = 5;
      for (let i = 0; i < players.length; i += batchSize) {
        const batch = players.slice(i, i + batchSize);
        
        const batchResults = await Promise.allSettled(
          batch.map(player => this.syncPlayerSeasonStats(player, team, sport))
        );

        for (const result of batchResults) {
          processed++;
          if (result.status === 'fulfilled' && result.value) {
            updated++;
          } else {
            failed++;
            console.error('Player sync failed:', result.reason?.message);
          }
        }

        // Short pause between batches
        if (i + batchSize < players.length) {
          await this.sleep(500);
        }
      }

      return { processed, updated, failed };

    } catch (error) {
      console.error(`Error syncing players for ${team.team_name}:`, error);
      return { processed, updated, failed: processed + 1 };
    }
  }

  /**
   * Sync individual player's season stats
   */
  async syncPlayerSeasonStats(player, team, sport) {
    try {
      // Get player stats based on sport
      const playerStats = await this.getPlayerStats(player, sport);
      
      if (!playerStats) {
        console.log(`⚠️ No stats found for ${player.name}`);
        return false;
      }

      // Calculate performance scores
      const performanceMetrics = this.calculatePerformanceMetrics(playerStats, sport);
      
      // Upsert player season stats
      const { error: upsertError } = await this.supabase
        .from('player_season_stats')
        .upsert({
          player_id: player.id,
          player_name: player.name,
          team_id: team.team_id,
          team_name: team.team_name,
          sport: sport,
          season: this.currentSeason,
          position: player.position,
          ...playerStats,
          ...performanceMetrics,
          last_updated: new Date().toISOString(),
          data_quality: 'good'
        }, {
          onConflict: 'player_id,team_id,sport,season'
        });

      if (upsertError) {
        console.error(`Error upserting ${player.name}:`, upsertError);
        return false;
      }

      return true;

    } catch (error) {
      console.error(`Error syncing player ${player.name}:`, error.message);
      return false;
    }
  }

  /**
   * Get team roster (mock data for now, will integrate with real APIs)
   */
  async getTeamRoster(teamId, sport) {
    // Generate mock roster data - in production, this would call API-Sports
    const positions = this.getSportPositions(sport);
    const players = [];

    for (let i = 0; i < 15; i++) { // Mock 15 players per team
      players.push({
        id: teamId * 1000 + i, // Mock player ID
        name: this.generatePlayerName(),
        position: positions[Math.floor(Math.random() * positions.length)],
        jersey_number: i + 1
      });
    }

    return players;
  }

  /**
   * Get player stats (mock data structure for now)
   */
  async getPlayerStats(player, sport) {
    try {
      const baseStats = {
        games_played: Math.floor(Math.random() * 20) + 5,
        games_started: Math.floor(Math.random() * 15) + 2,
        minutes_played: Math.floor(Math.random() * 2000) + 500,
        injury_status: this.randomInjuryStatus(),
        prop_bet_eligible: true
      };

      // Add sport-specific stats
      baseStats.sport_stats = this.generateSportSpecificStats(sport, player.position);
      
      return baseStats;
    } catch (error) {
      console.error('Error generating player stats:', error);
      return null;
    }
  }

  /**
   * Generate sport-specific statistics
   */
  generateSportSpecificStats(sport, position) {
    switch (sport) {
      case 'NFL':
        return this.generateNFLStats(position);
      case 'NBA':
        return this.generateNBAStats(position);
      case 'MLB':
        return this.generateMLBStats(position);
      case 'NHL':
        return this.generateNHLStats(position);
      default:
        return {};
    }
  }

  /**
   * Generate NFL player statistics
   */
  generateNFLStats(position) {
    const stats = {};
    
    if (position === 'QB') {
      stats.passing_yards = Math.floor(Math.random() * 3000) + 1000;
      stats.passing_touchdowns = Math.floor(Math.random() * 25) + 5;
      stats.interceptions = Math.floor(Math.random() * 12) + 2;
      stats.completion_percentage = 0.55 + Math.random() * 0.15;
    } else if (position === 'RB') {
      stats.rushing_yards = Math.floor(Math.random() * 1200) + 300;
      stats.rushing_touchdowns = Math.floor(Math.random() * 12) + 2;
      stats.receiving_yards = Math.floor(Math.random() * 400) + 100;
    } else if (position === 'WR' || position === 'TE') {
      stats.receiving_yards = Math.floor(Math.random() * 1000) + 200;
      stats.receptions = Math.floor(Math.random() * 60) + 20;
      stats.receiving_touchdowns = Math.floor(Math.random() * 8) + 1;
    }
    
    return stats;
  }

  /**
   * Generate NBA player statistics
   */
  generateNBAStats(position) {
    return {
      points_per_game: Math.random() * 25 + 5,
      rebounds_per_game: Math.random() * 12 + 2,
      assists_per_game: Math.random() * 8 + 1,
      field_goal_percentage: 0.35 + Math.random() * 0.25,
      three_point_percentage: 0.25 + Math.random() * 0.20,
      minutes_per_game: Math.random() * 25 + 15
    };
  }

  /**
   * Generate MLB player statistics
   */
  generateMLBStats(position) {
    if (position === 'P') { // Pitcher
      return {
        era: 2.50 + Math.random() * 3,
        wins: Math.floor(Math.random() * 15) + 2,
        losses: Math.floor(Math.random() * 10) + 1,
        strikeouts: Math.floor(Math.random() * 150) + 50,
        innings_pitched: Math.random() * 150 + 50
      };
    } else { // Position player
      return {
        batting_average: 0.200 + Math.random() * 0.15,
        home_runs: Math.floor(Math.random() * 30) + 2,
        rbis: Math.floor(Math.random() * 80) + 20,
        stolen_bases: Math.floor(Math.random() * 20) + 1,
        on_base_percentage: 0.280 + Math.random() * 0.15
      };
    }
  }

  /**
   * Generate NHL player statistics
   */
  generateNHLStats(position) {
    if (position === 'G') { // Goalie
      return {
        goals_against_average: 2.0 + Math.random() * 2,
        save_percentage: 0.88 + Math.random() * 0.08,
        wins: Math.floor(Math.random() * 30) + 5,
        losses: Math.floor(Math.random() * 20) + 3,
        shutouts: Math.floor(Math.random() * 5)
      };
    } else { // Skater
      return {
        goals: Math.floor(Math.random() * 25) + 2,
        assists: Math.floor(Math.random() * 35) + 5,
        points: Math.floor(Math.random() * 50) + 10,
        plus_minus: Math.floor(Math.random() * 40) - 20,
        penalty_minutes: Math.floor(Math.random() * 60) + 5
      };
    }
  }

  /**
   * Calculate performance metrics for betting relevance
   */
  calculatePerformanceMetrics(playerStats, sport) {
    // Basic performance rating (0-10 scale)
    let performanceRating = 5.0; // Base rating
    
    // Adjust based on games played (consistency indicator)
    const gamesPlayedRatio = playerStats.games_played / this.getMaxGames(sport);
    performanceRating += gamesPlayedRatio * 2; // Up to +2 for playing all games
    
    // Add some randomness for variety (in production, this would be calculated from real stats)
    performanceRating += (Math.random() - 0.5) * 3;
    performanceRating = Math.max(1.0, Math.min(10.0, performanceRating));
    
    // Consistency score (lower variance = higher score)
    const consistencyScore = 5.0 + (Math.random() * 4); // 5-9 range
    
    // Recent form (last 5 games performance)
    const recentFormScore = 3.0 + (Math.random() * 6); // 3-9 range
    
    // Betting value score
    const bettingValueScore = this.calculateBettingValue(playerStats, sport);
    
    return {
      performance_rating: Math.round(performanceRating * 100) / 100,
      consistency_score: Math.round(consistencyScore * 100) / 100,
      recent_form_score: Math.round(recentFormScore * 100) / 100,
      betting_value_score: bettingValueScore
    };
  }

  /**
   * Calculate betting value for prop bets
   */
  calculateBettingValue(playerStats, sport) {
    // In production, this would analyze prop bet lines vs player performance
    // For now, return a random value with some logic
    
    let bettingValue = 5.0; // Base value
    
    // Higher games played = more reliable for betting
    if (playerStats.games_played > 10) bettingValue += 1.0;
    if (playerStats.games_played > 15) bettingValue += 0.5;
    
    // Injury status affects betting value
    if (playerStats.injury_status === 'injured') bettingValue -= 3.0;
    if (playerStats.injury_status === 'questionable') bettingValue -= 1.0;
    
    // Add randomness
    bettingValue += (Math.random() - 0.5) * 2;
    
    return Math.max(1.0, Math.min(10.0, Math.round(bettingValue * 100) / 100));
  }

  /**
   * Helper functions
   */
  getSportPositions(sport) {
    const positions = {
      'NFL': ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K'],
      'NBA': ['PG', 'SG', 'SF', 'PF', 'C'],
      'MLB': ['P', 'C', '1B', '2B', '3B', 'SS', 'OF'],
      'NHL': ['G', 'D', 'LW', 'C', 'RW']
    };
    return positions[sport] || ['Player'];
  }

  getMaxGames(sport) {
    const maxGames = {
      'NFL': 17,
      'NBA': 82,
      'MLB': 162,
      'NHL': 82
    };
    return maxGames[sport] || 20;
  }

  generatePlayerName() {
    const firstNames = ['John', 'Mike', 'David', 'Chris', 'Matt', 'Steve', 'Tom', 'Jake', 'Alex', 'Ryan'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
    
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    
    return `${firstName} ${lastName}`;
  }

  randomInjuryStatus() {
    const statuses = ['healthy', 'healthy', 'healthy', 'healthy', 'questionable', 'injured'];
    return statuses[Math.floor(Math.random() * statuses.length)];
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = PlayerStatsSync;