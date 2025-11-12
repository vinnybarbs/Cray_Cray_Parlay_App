#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

class ESPNRosterPopulator {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Focus on the 3 sports with player props
    this.sports = {
      'NFL': { path: 'football/nfl' },
      'NBA': { path: 'basketball/nba' },
      'MLB': { path: 'baseball/mlb' }
    };
  }

  /**
   * Simple one-time roster population
   */
  async populateAllRosters() {
    console.log('🏈 ESPN Roster Population - One Time Setup\n');
    
    const results = { total_teams: 0, total_players: 0, errors: [] };

    for (const [sport, config] of Object.entries(this.sports)) {
      try {
        console.log(`📊 Populating ${sport} rosters...`);
        const result = await this.populateSport(sport, config);
        
        results.total_teams += result.teams;
        results.total_players += result.players;
        
        console.log(`✅ ${sport}: ${result.players} players from ${result.teams} teams\n`);
        
      } catch (error) {
        console.error(`❌ ${sport} failed:`, error.message);
        results.errors.push(`${sport}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Populate one sport
   */
  async populateSport(sport, config) {
    let teams = 0, players = 0;
    
    // Get teams
    const teamsData = await this.fetchTeams(sport, config);
    console.log(`  📋 Found ${teamsData.length} teams`);
    
    // Process all teams
    for (const team of teamsData) {
      try {
        const roster = await this.fetchRoster(sport, config, team);
        if (roster && roster.length > 0) {
          const inserted = await this.insertRoster(sport, team, roster);
          players += inserted;
          console.log(`    ${team.displayName}: ${inserted} players`);
        }
        teams++;
        
        // Rate limit
        await this.sleep(500);
        
      } catch (error) {
        console.error(`    ❌ ${team.displayName}: ${error.message}`);
      }
    }
    
    return { teams, players };
  }

  /**
   * Fetch teams for sport
   */
  async fetchTeams(sport, config) {
    const url = `http://site.api.espn.com/apis/site/v2/sports/${config.path}/teams`;
    const response = await fetch(url);
    const data = await response.json();
    
    return data.sports[0].leagues[0].teams.map(t => t.team);
  }

  /**
   * Fetch roster for team
   */
  async fetchRoster(sport, config, team) {
    const url = `http://site.api.espn.com/apis/site/v2/sports/${config.path}/teams/${team.id}/roster`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.athletes) return [];
    
    // Handle different roster structures
    const players = [];
    
    data.athletes.forEach(group => {
      if (group.items && Array.isArray(group.items)) {
        // NFL/MLB: position groups with items
        players.push(...group.items);
      } else if (group.id && group.displayName) {
        // NBA: direct athletes
        players.push(group);
      }
    });
    
    return players;
  }

  /**
   * Insert roster into database (simplified)
   */
  async insertRoster(sport, team, roster) {
    try {
      // Simple approach: just store the basic player info
      const players = roster.map(athlete => ({
        name: athlete.displayName || athlete.fullName || 'Unknown',
        sport: sport.toLowerCase(),
        position: athlete.position?.name || 'Unknown',
        provider_ids: JSON.stringify({
          espn_id: athlete.id,
          espn_team_id: team.id,
          team_name: team.displayName,
          jersey: athlete.jersey,
          age: athlete.age,
          height: athlete.displayHeight,
          weight: athlete.displayWeight
        })
      })).filter(p => p.name !== 'Unknown');

      // Insert without upsert to avoid constraint issues
      let inserted = 0;
      for (const player of players) {
        try {
          const { error } = await this.supabase
            .from('players')
            .insert(player);
          
          if (!error) inserted++;
          
        } catch (e) {
          // Skip duplicates
        }
      }
      
      return inserted;
      
    } catch (error) {
      console.error('Insert error:', error);
      return 0;
    }
  }

  /**
   * Check current roster status
   */
  async getRosterStatus() {
    try {
      const { data, error } = await this.supabase
        .from('players')
        .select('sport, name')
        .in('sport', ['nfl', 'nba', 'mlb']);

      if (error) throw error;

      const summary = { nfl: 0, nba: 0, mlb: 0 };
      data.forEach(player => {
        if (summary.hasOwnProperty(player.sport)) {
          summary[player.sport]++;
        }
      });

      return summary;
      
    } catch (error) {
      console.error('Status check error:', error);
      return { nfl: 0, nba: 0, mlb: 0 };
    }
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Main execution
async function main() {
  const populator = new ESPNRosterPopulator();
  
  console.log('🚀 Starting ESPN Roster Population\n');
  
  try {
    // Check current status
    console.log('📊 Current roster status:');
    const status = await populator.getRosterStatus();
    console.log(`  NFL: ${status.nfl} players`);
    console.log(`  NBA: ${status.nba} players`);
    console.log(`  MLB: ${status.mlb} players\n`);
    
    // Populate rosters
    const results = await populator.populateAllRosters();
    
    console.log('🎯 Final Results:');
    console.log(`  Teams: ${results.total_teams}`);
    console.log(`  Players: ${results.total_players}`);
    
    if (results.errors.length > 0) {
      console.log('  Errors:', results.errors);
    }
    
    // Check final status
    console.log('\n📈 Updated roster status:');
    const finalStatus = await populator.getRosterStatus();
    console.log(`  NFL: ${finalStatus.nfl} players`);
    console.log(`  NBA: ${finalStatus.nba} players`);
    console.log(`  MLB: ${finalStatus.mlb} players`);
    
    console.log('\n✅ Roster population completed!');
    console.log('💡 Next: Create periodic sync for trades/moves');
    
  } catch (error) {
    console.error('❌ Population failed:', error);
  }
}

if (require.main === module) {
  main();
}

module.exports = { ESPNRosterPopulator, main };