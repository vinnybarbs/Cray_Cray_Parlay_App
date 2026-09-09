const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

class ESPNApiService {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.baseUrl = 'https://site.web.api.espn.com/apis/site/v2/sports';
    this.coreUrl = 'https://sports.core.api.espn.com/v2/sports';
    this.currentSeason = new Date().getFullYear();
    
    // Sport configurations for ESPN API - Focus on MLB, NFL, NBA for player props
    this.sports = {
      'NFL': {
        path: 'football/nfl',
        season: 2024, // 2024 NFL season
        coreLeague: 'nfl'
      },
      'NBA': {
        path: 'basketball/nba',
        season: 2024, // 2024-25 NBA season  
        coreLeague: 'nba'
      },
      'MLB': {
        path: 'baseball/mlb',
        season: 2024, // 2024 MLB season
        coreLeague: 'mlb'
      }
    };
  }

  /**
   * Main function to populate all team rosters from ESPN
   */
  async populateAllTeamRosters() {
    console.log('🏈 Starting ESPN team roster population...');
    
    const results = {
      total_teams: 0,
      total_players: 0,
      sports_completed: 0,
      errors: []
    };

    for (const [sport, config] of Object.entries(this.sports)) {
      try {
        console.log(`\n📊 Populating ${sport} rosters...`);
        const sportResult = await this.populateSportRosters(sport, config);
        
        results.total_teams += sportResult.teams_processed;
        results.total_players += sportResult.players_added;
        results.sports_completed += 1;
        
        console.log(`✅ ${sport}: ${sportResult.players_added} players from ${sportResult.teams_processed} teams`);
        
        // Rate limiting between sports
        await this.sleep(1000);
        
      } catch (error) {
        console.error(`❌ Error populating ${sport}:`, error.message);
        results.errors.push(`${sport}: ${error.message}`);
      }
    }

    console.log('\n🎯 ESPN roster population completed:', results);
    return results;
  }

  /**
   * Populate team rosters for a specific sport
   */
  async populateSportRosters(sport, config) {
    let teamsProcessed = 0;
    let playersAdded = 0;

    try {
      // Step 1: Get all teams for this sport
      const teams = await this.getTeamsForSport(sport, config);
      console.log(`📋 Found ${teams.length} ${sport} teams from ESPN`);

      // Step 2: Process each team to get roster (process all teams from ESPN)
      for (const team of teams) {
        try {
          console.log(`👥 Fetching roster for ${team.displayName}...`);
          
          const rosterData = await this.getTeamRoster(team.id, sport, config);
          
          if (rosterData && rosterData.athletes && rosterData.athletes.length > 0) {
            const inserted = await this.insertTeamRoster(team, rosterData.athletes, sport);
            playersAdded += inserted;
            console.log(`  ✅ Added ${inserted} players for ${team.displayName}`);
          } else {
            console.log(`  ⚠️ No roster data found for ${team.displayName}`);
          }
          
          teamsProcessed += 1;
          
          // Rate limiting between teams
          await this.sleep(800);
          
        } catch (teamError) {
          console.error(`  ❌ Error processing ${team.displayName}:`, teamError.message);
        }
      }

      return { teams_processed: teamsProcessed, players_added: playersAdded };

    } catch (error) {
      console.error(`Error populating ${sport} rosters:`, error);
      throw error;
    }
  }

  /**
   * Get all teams for a sport from ESPN
   */
  async getTeamsForSport(sport, config) {
    try {
      const url = `${this.baseUrl}/${config.path}/teams`;
      console.log(`📡 Fetching teams from: ${url}`);

      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`ESPN API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.sports || !data.sports[0] || !data.sports[0].leagues || !data.sports[0].leagues[0]) {
        throw new Error('Unexpected ESPN API response structure');
      }

      const teams = data.sports[0].leagues[0].teams || [];
      
      return teams.map(teamWrapper => {
        const team = teamWrapper.team;
        return {
          id: team.id,
          displayName: team.displayName,
          name: team.name,
          abbreviation: team.abbreviation,
          location: team.location,
          color: team.color,
          alternateColor: team.alternateColor,
          logos: team.logos || [],
          sport: sport
        };
      });

    } catch (error) {
      console.error(`Error fetching teams for ${sport}:`, error);
      return [];
    }
  }

  /**
   * Get team roster using the correct ESPN roster endpoint
   */
  async getTeamRoster(teamId, sport, config) {
    try {
      const url = `${this.baseUrl}/${config.path}/teams/${teamId}/roster`;
      console.log(`📡 Fetching team roster from: ${url}`);

      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`ESPN roster request failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.athletes) {
        console.log(`  ⚠️ No athletes found in roster response for team ${teamId}`);
        return null;
      }

      console.log(`  📊 Found ${data.athletes.length} athletes in roster`);

      return {
        athletes: data.athletes,
        team: data.team,
        rawData: data // Keep full response for debugging
      };

    } catch (error) {
      console.error(`Error fetching roster for team ${teamId}:`, error);
      return null;
    }
  }

  /**
   * Insert team roster into database
   */
  async insertTeamRoster(team, rosterGroups, sport) {
    try {
      if (!rosterGroups || !Array.isArray(rosterGroups)) {
        console.log(`  ⚠️ Invalid roster data for ${team.displayName}`);
        return 0;
      }

      // ESPN rosters have different structures by sport:
      // NFL/MLB: grouped by position with .items arrays
      // NBA: direct athletes array
      const allPlayers = [];
      
      rosterGroups.forEach(group => {
        if (group.items && Array.isArray(group.items)) {
          // NFL/MLB structure: position groups with items
          group.items.forEach(athlete => {
            const player = {
              ...athlete,
              positionGroup: group.position // Add position group info
            };
            allPlayers.push(player);
          });
        } else if (group.id && group.displayName) {
          // NBA structure: direct athlete objects
          const player = {
            ...group,
            positionGroup: 'Player' // Generic position for NBA
          };
          allPlayers.push(player);
        }
      });

      console.log(`  📋 Processing ${allPlayers.length} individual players from ${rosterGroups.length} ${sport === 'NBA' ? 'athletes' : 'position groups'}`);

      if (allPlayers.length === 0) {
        console.log(`  ⚠️ No players found in position groups for ${team.displayName}`);
        return 0;
      }

      // First, ensure we have the team in the teams table (no strict upsert constraints)
      const teamRecord = {
        name: team.displayName,
        sport: sport.toLowerCase(),
        provider_ids: JSON.stringify({
          espn_id: team.id,
          espn_abbreviation: team.abbreviation
        })
      };

      let teamUUID = null;

      try {
        // Try to find an existing team by sport + name
        const { data: existingTeams, error: fetchTeamError } = await this.supabase
          .from('teams')
          .select('id')
          .eq('sport', teamRecord.sport)
          .eq('name', teamRecord.name)
          .limit(1);

        if (fetchTeamError) {
          console.error('Error querying existing team:', fetchTeamError);
        }

        if (existingTeams && existingTeams.length > 0) {
          teamUUID = existingTeams[0].id;
        } else {
          // Insert a new team row; if this fails, we still continue with null team_id
          const { data: insertedTeam, error: insertTeamError } = await this.supabase
            .from('teams')
            .insert(teamRecord)
            .select('id')
            .single();

          if (insertTeamError) {
            console.error('Error inserting team:', insertTeamError);
          } else if (insertedTeam && insertedTeam.id) {
            teamUUID = insertedTeam.id;
          }
        }
      } catch (teamError) {
        console.error('Error upserting team:', teamError);
      }

      // Create player records for proper players table structure
      const playerRecords = allPlayers.map(athlete => {
        return {
          team_id: teamUUID,
          sport: sport.toLowerCase(),
          name: athlete.displayName || athlete.fullName || 'Unknown Player',
          position: athlete.position?.name || athlete.positionGroup || 'Unknown',
          
          // Store ESPN data and additional info in provider_ids
          provider_ids: JSON.stringify({
            espn_id: athlete.id,
            espn_uid: athlete.uid,
            espn_guid: athlete.guid,
            
            // Player details
            first_name: athlete.firstName,
            last_name: athlete.lastName,
            short_name: athlete.shortName,
            jersey_number: athlete.jersey || null,
            age: athlete.age || null,
            height: athlete.displayHeight || null,
            weight: athlete.displayWeight || null,
            birth_date: athlete.dateOfBirth || null,
            debut_year: athlete.debutYear || null,
            experience: athlete.experience || null,
            college: athlete.college || null,
            headshot_url: athlete.headshot?.href || null,
            
            // Metadata
            season: this.currentSeason,
            prop_bet_eligible: true,
            performance_rating: 5.0,
            betting_value_score: 5.0,
            api_source: 'espn',
            data_quality: 'excellent',
            last_updated: new Date().toISOString()
          })
        };
      }).filter(player => player.name && player.name !== 'Unknown Player');

      console.log(`  📊 Prepared ${playerRecords.length} players for database insertion`);

      if (playerRecords.length === 0) {
        console.log(`  ⚠️ No valid player records for ${team.displayName}`);
        return 0;
      }

      // Insert players into proper players table (use regular insert, handle duplicates manually)
      const { data, error } = await this.supabase
        .from('players')
        .insert(playerRecords)
        .select('id');

      if (error) {
        console.error('Error inserting players:', error);
        return 0;
      }

      console.log(`  💾 Successfully inserted ${playerRecords.length} players into database`);
      return playerRecords.length;

    } catch (error) {
      console.error('Error inserting team roster:', error);
      return 0;
    }
  }

  /**
   * Get current scores and live game data
   */
  async getLiveScores(sport) {
    try {
      const config = this.sports[sport];
      if (!config) {
        throw new Error(`Unsupported sport: ${sport}`);
      }

      const url = `${this.baseUrl}/${config.path}/scoreboard`;
      console.log(`📡 Fetching live scores from: ${url}`);

      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`ESPN scoreboard request failed: ${response.status}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      console.error(`Error fetching live scores for ${sport}:`, error);
      return null;
    }
  }

  /**
   * Get player statistics from ESPN's core API
   */
  async getPlayerStats(playerId, sport) {
    try {
      const config = this.sports[sport];
      if (!config) {
        throw new Error(`Unsupported sport: ${sport}`);
      }

      const url = `${this.coreUrl}/${config.coreLeague}/athletes/${playerId}/statistics`;
      console.log(`📡 Fetching player stats from: ${url}`);

      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`ESPN player stats request failed: ${response.status}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      console.error(`Error fetching player stats for ${playerId}:`, error);
      return null;
    }
  }

  async getPlayerSeasonStats(playerId, sport, season, seasonType = 2) {
    try {
      const config = this.sports[sport];
      if (!config) {
        throw new Error(`Unsupported sport: ${sport}`);
      }

      const targetSeason = season || config.season || this.currentSeason;
      const type = seasonType || 2;

      const url = `${this.coreUrl}/${config.coreLeague}/seasons/${targetSeason}/types/${type}/athletes/${playerId}/statistics`;
      console.log(`📡 Fetching explicit season stats from: ${url}`);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`ESPN season stats request failed: ${response.status}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      console.error(`Error fetching season stats for ${playerId}:`, error);
      return null;
    }
  }

  async getPlayerStatisticsLog(playerId, sport, season, seasonType = 2) {
    try {
      const config = this.sports[sport];
      if (!config) {
        throw new Error(`Unsupported sport: ${sport}`);
      }

      const targetSeason = season || config.season || this.currentSeason;
      const type = seasonType || 2;

      const url = `${this.coreUrl}/${config.coreLeague}/athletes/${playerId}/statisticslog?season=${targetSeason}&seasontype=${type}`;
      console.log(`📡 Fetching statistics log from: ${url}`);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`ESPN statisticslog request failed: ${response.status}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      console.error(`Error fetching statistics log for ${playerId}:`, error);
      return null;
    }
  }

  getStatFromSeasonSplits(statsPayload, categoryName, statName) {
    try {
      if (!statsPayload || !Array.isArray(statsPayload.splits) || statsPayload.splits.length === 0) {
        return null;
      }

      const split = statsPayload.splits[0];
      const categories = Array.isArray(split.categories) ? split.categories : [];
      const category = categories.find((c) => c.name === categoryName);
      if (!category || !Array.isArray(category.stats)) {
        return null;
      }

      const stat = category.stats.find((s) => s.name === statName);
      if (!stat) {
        return null;
      }

      return typeof stat.value === 'number' ? stat.value : Number(stat.value) || null;

    } catch (error) {
      console.error('Error extracting stat from season splits:', error);
      return null;
    }
  }

  /**
   * Test ESPN API connectivity
   */
  async testConnectivity() {
    console.log('🔌 Testing ESPN API connectivity...');
    
    const results = {};

    for (const [sport, config] of Object.entries(this.sports)) {
      try {
        const url = `${this.baseUrl}/${config.path}/teams`;
        
        const response = await fetch(url);
        
        results[sport] = {
          status: response.status,
          ok: response.ok,
          message: response.ok ? 'Connected ✅' : `Error ${response.status} ❌`
        };

        console.log(`  ${sport}: ${results[sport].message}`);

        // Rate limiting
        await this.sleep(300);

      } catch (error) {
        results[sport] = {
          status: 'error',
          ok: false,
          message: `${error.message} ❌`
        };
        console.log(`  ${sport}: ${error.message} ❌`);
      }
    }

    return results;
  }

  /**
   * Get roster summary from database
   */
  async getRosterSummary() {
    try {
      console.log('📊 Getting ESPN roster summary...');

      const { data: playerCounts, error } = await this.supabase
        .from('players')
        .select(`
          id, 
          sport, 
          teams!inner(name)
        `)
        .in('sport', ['nfl', 'nba', 'mlb']);

      if (error) throw error;

      const summary = {};

      playerCounts.forEach(record => {
        const sport = record.sport?.toUpperCase() || 'Unknown';
        const teamName = record.teams?.name || 'Unknown Team';
        
        if (!summary[sport]) {
          summary[sport] = {
            total_players: 0,
            teams_with_players: new Set()
          };
        }
        summary[sport].total_players++;
        summary[sport].teams_with_players.add(teamName);
      });

      // Convert sets to counts
      Object.keys(summary).forEach(sport => {
        summary[sport].teams_with_rosters = summary[sport].teams_with_players.size;
        delete summary[sport].teams_with_players;
      });

      console.log('📈 ESPN Roster Summary:');
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
   * Utility function for rate limiting
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ESPNApiService;