const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

class PlayerRosterPopulator {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.apiKey = process.env.API_SPORTS_KEY || process.env.APISPORTS_API_KEY;
    this.currentSeason = new Date().getFullYear();
  }

  /**
   * Main function to populate rosters for all sports
   */
  async populateAllRosters() {
    console.log('👥 Starting player roster population from API-Sports...');
    
    const results = {
      total_teams: 0,
      total_players: 0,
      sports_completed: 0,
      errors: []
    };

    // Start with NFL since it has the most reliable roster data
    const sports = [
      { name: 'NFL', season: 2024 }, // Use 2024 season for free tier access
      { name: 'NBA', season: 2023 },
      { name: 'MLB', season: 2023 },
      { name: 'NHL', season: 2023 }
    ];

    for (const sport of sports) {
      try {
        console.log(`\n🏈 Populating ${sport.name} rosters (${sport.season} season)...`);
        const sportResult = await this.populateSportRosters(sport.name, sport.season);
        
        results.total_teams += sportResult.teams_processed;
        results.total_players += sportResult.players_added;
        results.sports_completed += 1;
        
        console.log(`✅ ${sport.name}: ${sportResult.players_added} players from ${sportResult.teams_processed} teams`);
        
        // Rate limiting pause between sports
        await this.sleep(2000);
        
      } catch (error) {
        console.error(`❌ Error populating ${sport.name}:`, error.message);
        results.errors.push(`${sport.name}: ${error.message}`);
      }
    }

    console.log('\n🎯 Player roster population completed:', results);
    return results;
  }

  /**
   * Populate rosters for a specific sport
   */
  async populateSportRosters(sport, season) {
    let teamsProcessed = 0;
    let playersAdded = 0;

    try {
      // Get teams for this sport from our cached teams
      const { data: teams, error: teamsError } = await this.supabase
        .from('team_stats_cache')
        .select('team_id, team_name, sport')
        .eq('sport', sport)
        .limit(10); // Start with limited teams to test

      if (teamsError) throw teamsError;

      console.log(`📋 Found ${teams.length} ${sport} teams in cache`);

      // Process teams one by one to avoid rate limiting
      for (const team of teams) {
        try {
          console.log(`👥 Fetching roster for ${team.team_name}...`);
          
          const players = await this.fetchTeamRoster(team.team_id, sport, season);
          
          if (players && players.length > 0) {
            const inserted = await this.insertTeamPlayers(team, players, sport);
            playersAdded += inserted;
            console.log(`  ✅ Added ${inserted} players for ${team.team_name}`);
          } else {
            console.log(`  ⚠️ No players found for ${team.team_name}`);
          }
          
          teamsProcessed += 1;
          
          // Rate limiting pause between teams
          await this.sleep(1500);
          
        } catch (teamError) {
          console.error(`  ❌ Error processing ${team.team_name}:`, teamError.message);
        }
      }

      return { teams_processed: teamsProcessed, players_added: playersAdded };

    } catch (error) {
      console.error(`Error populating ${sport} rosters:`, error);
      throw error;
    }
  }

  /**
   * Fetch team roster from API-Sports
   */
  async fetchTeamRoster(teamId, sport, season) {
    try {
      let apiUrl;
      
      // Build API URL based on sport
      switch (sport) {
        case 'NFL':
          apiUrl = `https://v1.american-football.api-sports.io/players?team=${teamId}&season=${season}`;
          break;
        case 'NBA':
          apiUrl = `https://v1.basketball.api-sports.io/players?team=${teamId}&season=${season}`;
          break;
        case 'MLB':
          // Baseball API uses different format
          apiUrl = `https://v1.baseball.api-sports.io/players?team=${teamId}&season=${season}`;
          break;
        case 'NHL':
          // Hockey API
          apiUrl = `https://v1.hockey.api-sports.io/players?team=${teamId}&season=${season}`;
          break;
        default:
          throw new Error(`Unsupported sport: ${sport}`);
      }

      console.log(`📡 Fetching from: ${apiUrl.split('?')[0]}`);

      const response = await fetch(apiUrl, {
        headers: {
          'X-RapidAPI-Key': this.apiKey,
          'X-RapidAPI-Host': this.getApiHost(sport)
        }
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.errors && Object.keys(data.errors).length > 0) {
        console.log(`⚠️ API errors:`, data.errors);
        return null;
      }

      console.log(`📊 API returned ${data.results} players`);
      
      return this.normalizePlayerData(data.response, sport);

    } catch (error) {
      console.error('Error fetching team roster:', error);
      return null;
    }
  }

  /**
   * Get API host for different sports
   */
  getApiHost(sport) {
    const hosts = {
      'NFL': 'v1.american-football.api-sports.io',
      'NBA': 'v1.basketball.api-sports.io',
      'MLB': 'v1.baseball.api-sports.io',
      'NHL': 'v1.hockey.api-sports.io'
    };
    return hosts[sport];
  }

  /**
   * Normalize player data from different APIs
   */
  normalizePlayerData(apiPlayers, sport) {
    if (!apiPlayers || !Array.isArray(apiPlayers)) {
      return [];
    }

    return apiPlayers.map(playerData => {
      // Different sports have different API response structures
      let player, position, jersey;

      switch (sport) {
        case 'NFL':
          player = playerData.player || playerData;
          position = playerData.position || 'Unknown';
          jersey = playerData.number || null;
          break;
          
        case 'NBA':
          player = playerData.player || playerData;
          position = playerData.position || 'Unknown';
          jersey = playerData.number || null;
          break;
          
        case 'MLB':
          player = playerData.player || playerData;
          position = playerData.position || 'Unknown';
          jersey = playerData.number || null;
          break;
          
        case 'NHL':
          player = playerData.player || playerData;
          position = playerData.position || 'Unknown';
          jersey = playerData.number || null;
          break;
          
        default:
          player = playerData;
          position = 'Unknown';
          jersey = null;
      }

      return {
        api_player_id: player.id,
        name: player.name || `${player.firstname || ''} ${player.lastname || ''}`.trim(),
        position: position,
        jersey_number: jersey,
        age: player.age || null,
        height: player.height || null,
        weight: player.weight || null,
        birth_date: player.birth?.date || null,
        birth_country: player.birth?.country || null,
        photo_url: player.photo || null
      };
    }).filter(player => player.name && player.name.length > 0);
  }

  /**
   * Insert players for a team into the database
   */
  async insertTeamPlayers(team, players, sport) {
    try {
      // Prepare player records for database
      const playerRecords = players.map(player => ({
        player_id: player.api_player_id,
        player_name: player.name,
        team_id: team.team_id,
        team_name: team.team_name,
        sport: sport,
        season: this.currentSeason,
        position: player.position,
        jersey_number: player.jersey_number,
        age: player.age,
        height: player.height,
        weight: player.weight,
        birth_date: player.birth_date,
        birth_country: player.birth_country,
        photo_url: player.photo_url,
        
        // Initialize performance metrics
        games_played: 0,
        games_started: 0,
        injury_status: 'healthy',
        prop_bet_eligible: true,
        performance_rating: 5.0,
        betting_value_score: 5.0,
        
        // Empty sport-specific stats (will be populated later)
        sport_stats: {},
        
        last_updated: new Date().toISOString(),
        api_source: 'api-sports',
        data_quality: 'good'
      }));

      // Insert players (use upsert to handle duplicates)
      const { data, error } = await this.supabase
        .from('player_season_stats')
        .upsert(playerRecords, {
          onConflict: 'player_id,team_id,sport,season',
          ignoreDuplicates: false
        })
        .select('player_id');

      if (error) {
        console.error('Error inserting players:', error);
        return 0;
      }

      return playerRecords.length;

    } catch (error) {
      console.error('Error inserting team players:', error);
      return 0;
    }
  }

  /**
   * Get roster summary for all sports
   */
  async getRosterSummary() {
    try {
      console.log('📊 Getting roster summary...');

      // Get player counts by sport and team
      const { data: playerCounts, error } = await this.supabase
        .from('player_season_stats')
        .select('sport, team_name, player_id')
        .eq('season', this.currentSeason);

      if (error) throw error;

      const summary = {};

      playerCounts.forEach(record => {
        if (!summary[record.sport]) {
          summary[record.sport] = {
            total_players: 0,
            teams_with_players: new Set()
          };
        }
        summary[record.sport].total_players++;
        summary[record.sport].teams_with_players.add(record.team_name);
      });

      // Convert sets to counts
      Object.keys(summary).forEach(sport => {
        summary[sport].teams_with_rosters = summary[sport].teams_with_players.size;
        delete summary[sport].teams_with_players;
      });

      console.log('📈 Roster Summary:');
      Object.entries(summary).forEach(([sport, stats]) => {
        console.log(`  ${sport}: ${stats.total_players} players across ${stats.teams_with_rosters} teams`);
      });

      return summary;

    } catch (error) {
      console.error('Error getting roster summary:', error);
      return {};
    }
  }

  /**
   * Test API connectivity for all sports
   */
  async testApiConnectivity() {
    console.log('🔌 Testing API-Sports connectivity...');
    
    const sports = ['NFL', 'NBA', 'MLB', 'NHL'];
    const results = {};

    for (const sport of sports) {
      try {
        // Test with a simple leagues endpoint
        let testUrl;
        
        switch (sport) {
          case 'NFL':
            testUrl = 'https://v1.american-football.api-sports.io/leagues';
            break;
          case 'NBA':
            testUrl = 'https://v1.basketball.api-sports.io/leagues';
            break;
          case 'MLB':
            testUrl = 'https://v1.baseball.api-sports.io/leagues';
            break;
          case 'NHL':
            testUrl = 'https://v1.hockey.api-sports.io/leagues';
            break;
        }

        const response = await fetch(testUrl, {
          headers: {
            'X-RapidAPI-Key': this.apiKey,
            'X-RapidAPI-Host': this.getApiHost(sport)
          }
        });

        results[sport] = {
          status: response.status,
          ok: response.ok,
          message: response.ok ? 'Connected' : `Error ${response.status}`
        };

        console.log(`  ${sport}: ${results[sport].message}`);

      } catch (error) {
        results[sport] = {
          status: 'error',
          ok: false,
          message: error.message
        };
        console.log(`  ${sport}: ${error.message}`);
      }

      // Rate limiting
      await this.sleep(500);
    }

    return results;
  }

  /**
   * Utility function for rate limiting
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = PlayerRosterPopulator;