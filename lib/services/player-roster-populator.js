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
   * Populate rosters for all teams across all sports
   */
  async populateAllRosters() {
    console.log('👥 Starting roster population for all sports...');
    
    const sports = ['NFL', 'NBA', 'MLB', 'NHL'];
    let totalPlayers = 0;
    let totalTeams = 0;

    for (const sport of sports) {
      try {
        console.log(`\n🏈 Populating ${sport} rosters...`);
        const result = await this.populateSportRosters(sport);
        
        totalPlayers += result.players;
        totalTeams += result.teams;
        
        console.log(`✅ ${sport}: ${result.players} players added across ${result.teams} teams`);
        
        // Rate limiting between sports
        await this.sleep(2000);
        
      } catch (error) {
        console.error(`❌ Error populating ${sport} rosters:`, error.message);
      }
    }

    console.log(`\n🎯 Total roster population complete: ${totalPlayers} players across ${totalTeams} teams`);
    return { totalPlayers, totalTeams };
  }

  /**
   * Populate rosters for a specific sport
   */
  async populateSportRosters(sport) {
    // Get all teams for this sport
    const { data: teams, error: teamsError } = await this.supabase
      .from('team_stats_cache')
      .select('team_id, team_name, sport')
      .eq('sport', sport);

    if (teamsError) {
      throw new Error(`Failed to get teams: ${teamsError.message}`);
    }

    console.log(`📋 Found ${teams.length} ${sport} teams`);

    let totalPlayersAdded = 0;

    // Process teams one by one to avoid overwhelming APIs
    for (const team of teams) {
      try {
        const players = await this.getTeamRoster(team, sport);
        
        if (players && players.length > 0) {
          await this.savePlayersToDatabase(players, team, sport);
          totalPlayersAdded += players.length;
          
          console.log(`  ✓ ${team.team_name}: ${players.length} players`);
        } else {
          console.log(`  ⚠ ${team.team_name}: No players found`);
        }
        
        // Rate limiting between teams
        await this.sleep(500);
        
      } catch (teamError) {
        console.error(`  ❌ ${team.team_name}: ${teamError.message}`);
      }
    }

    return {
      teams: teams.length,
      players: totalPlayersAdded
    };
  }

  /**
   * Get roster for a specific team
   * For now, we'll generate realistic mock rosters
   * In production, this would call API-Sports endpoints
   */
  async getTeamRoster(team, sport) {
    try {
      // For now, generate realistic mock rosters
      // TODO: Replace with actual API-Sports calls
      return this.generateMockRoster(team, sport);
      
    } catch (error) {
      console.error(`Error getting roster for ${team.team_name}:`, error);
      return [];
    }
  }

  /**
   * Generate realistic mock roster for a team
   */
  generateMockRoster(team, sport) {
    const positions = this.getSportPositions(sport);
    const rosterSize = this.getRosterSize(sport);
    const players = [];

    // Generate players for each position
    const positionCounts = this.getPositionCounts(sport);
    
    let playerId = team.team_id * 1000; // Base player ID

    for (const [position, count] of Object.entries(positionCounts)) {
      for (let i = 0; i < count; i++) {
        playerId++;
        
        const player = {
          player_id: playerId,
          player_name: this.generateRealisticPlayerName(sport),
          team_id: team.team_id,
          team_name: team.team_name,
          position: position,
          jersey_number: this.generateJerseyNumber(sport, position, i),
          height: this.generateHeight(sport, position),
          weight: this.generateWeight(sport, position),
          age: 20 + Math.floor(Math.random() * 15), // 20-34 years old
          experience: Math.floor(Math.random() * 12), // 0-11 years experience
          status: 'active',
          injury_status: this.getRandomInjuryStatus(),
          
          // Prop bet relevant stats
          prop_categories: this.getPropCategories(sport, position),
          betting_eligible: true,
          fantasy_relevant: true,
          
          // Season context
          season: this.currentSeason,
          last_updated: new Date().toISOString()
        };
        
        players.push(player);
      }
    }

    return players;
  }

  /**
   * Save players to database
   */
  async savePlayersToDatabase(players, team, sport) {
    try {
      // First, delete existing players for this team to avoid duplicates
      await this.supabase
        .from('team_rosters')
        .delete()
        .eq('team_id', team.team_id)
        .eq('sport', sport)
        .eq('season', this.currentSeason);

      // Insert new roster
      const { error: insertError } = await this.supabase
        .from('team_rosters')
        .insert(players);

      if (insertError) {
        throw new Error(`Database insert failed: ${insertError.message}`);
      }

      return true;
    } catch (error) {
      console.error(`Error saving roster for ${team.team_name}:`, error);
      throw error;
    }
  }

  /**
   * Get sport-specific positions
   */
  getSportPositions(sport) {
    const positions = {
      'NFL': ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'OLB', 'ILB', 'CB', 'S', 'K', 'P'],
      'NBA': ['PG', 'SG', 'SF', 'PF', 'C'],
      'MLB': ['SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'],
      'NHL': ['G', 'LD', 'RD', 'LW', 'C', 'RW']
    };
    return positions[sport] || ['Player'];
  }

  /**
   * Get realistic roster composition by position
   */
  getPositionCounts(sport) {
    const counts = {
      'NFL': {
        'QB': 3, 'RB': 4, 'FB': 1, 'WR': 6, 'TE': 3,
        'OT': 4, 'OG': 4, 'C': 2,
        'DE': 4, 'DT': 4, 'OLB': 4, 'ILB': 4,
        'CB': 5, 'S': 4, 'K': 1, 'P': 1
      },
      'NBA': {
        'PG': 3, 'SG': 3, 'SF': 3, 'PF': 3, 'C': 3
      },
      'MLB': {
        'SP': 5, 'RP': 8, 'C': 2, '1B': 2, '2B': 2, '3B': 2, 'SS': 2,
        'LF': 2, 'CF': 2, 'RF': 2, 'DH': 1
      },
      'NHL': {
        'G': 2, 'LD': 4, 'RD': 4, 'LW': 4, 'C': 4, 'RW': 4
      }
    };
    return counts[sport] || { 'Player': 20 };
  }

  /**
   * Get realistic roster size for sport
   */
  getRosterSize(sport) {
    const sizes = {
      'NFL': 53,
      'NBA': 15,
      'MLB': 28,
      'NHL': 22
    };
    return sizes[sport] || 20;
  }

  /**
   * Generate realistic player names by sport demographics
   */
  generateRealisticPlayerName(sport) {
    const firstNames = {
      'NFL': ['Dak', 'Josh', 'Lamar', 'Patrick', 'Aaron', 'Tom', 'Russell', 'Kyler', 'Joe', 'Justin', 'Derek', 'Saquon', 'Ezekiel', 'Alvin', 'Davante', 'DeAndre', 'Julio', 'Mike', 'Travis', 'George'],
      'NBA': ['LeBron', 'Stephen', 'Kevin', 'Giannis', 'Luka', 'Joel', 'Nikola', 'Jayson', 'Jimmy', 'Paul', 'Chris', 'Russell', 'James', 'Damian', 'Anthony', 'Klay', 'Kawhi', 'Kyrie', 'Ben', 'Trae'],
      'MLB': ['Mike', 'Mookie', 'Aaron', 'Ronald', 'Juan', 'Fernando', 'Manny', 'Jose', 'Vladimir', 'Pete', 'Cody', 'Jacob', 'Gerrit', 'Shane', 'Walker', 'Freddie', 'Bo', 'Corey', 'Kyle', 'Tyler'],
      'NHL': ['Connor', 'Sidney', 'Alex', 'Nathan', 'Leon', 'David', 'Erik', 'Victor', 'Artemi', 'Auston', 'Mitch', 'Brad', 'Patrice', 'Ryan', 'John', 'Carey', 'Igor', 'Andrei', 'Nikita', 'Kirill']
    };

    const lastNames = {
      'NFL': ['Prescott', 'Allen', 'Jackson', 'Mahomes', 'Rodgers', 'Brady', 'Wilson', 'Murray', 'Burrow', 'Herbert', 'Carr', 'Barkley', 'Elliott', 'Kamara', 'Adams', 'Hopkins', 'Jones', 'Evans', 'Kelce', 'Kittle'],
      'NBA': ['James', 'Curry', 'Durant', 'Antetokounmpo', 'Doncic', 'Embiid', 'Jokic', 'Tatum', 'Butler', 'George', 'Paul', 'Westbrook', 'Harden', 'Lillard', 'Davis', 'Thompson', 'Leonard', 'Irving', 'Simmons', 'Young'],
      'MLB': ['Trout', 'Betts', 'Judge', 'Acuna', 'Soto', 'Tatis', 'Machado', 'Altuve', 'Guerrero', 'Alonso', 'Bellinger', 'deGrom', 'Cole', 'Bieber', 'Buehler', 'Freeman', 'Bichette', 'Seager', 'Schwarber', 'Tucker'],
      'NHL': ['McDavid', 'Crosby', 'Ovechkin', 'MacKinnon', 'Draisaitl', 'Pastrnak', 'Karlsson', 'Hedman', 'Panarin', 'Matthews', 'Marner', 'Marchand', 'Bergeron', 'McDonagh', 'Carlson', 'Price', 'Shesterkin', 'Vasilevskiy', 'Kucherov', 'Kaprizov']
    };

    const sportFirstNames = firstNames[sport] || firstNames['NFL'];
    const sportLastNames = lastNames[sport] || lastNames['NFL'];

    const firstName = sportFirstNames[Math.floor(Math.random() * sportFirstNames.length)];
    const lastName = sportLastNames[Math.floor(Math.random() * sportLastNames.length)];

    return `${firstName} ${lastName}`;
  }

  /**
   * Generate jersey numbers by sport rules
   */
  generateJerseyNumber(sport, position, index) {
    const ranges = {
      'NFL': {
        'QB': [1, 19], 'RB': [20, 49], 'WR': [10, 19, 80, 89], 'TE': [80, 89],
        'OT': [70, 79], 'OG': [60, 79], 'C': [60, 79],
        'DE': [50, 99], 'DT': [50, 99], 'OLB': [50, 99], 'ILB': [50, 99],
        'CB': [20, 49], 'S': [20, 49], 'K': [1, 19], 'P': [1, 19]
      },
      'NBA': { 'default': [0, 99] },
      'MLB': { 'default': [1, 99] },
      'NHL': { 'default': [1, 99] }
    };

    const sportRanges = ranges[sport] || ranges['NBA'];
    const positionRange = sportRanges[position] || sportRanges['default'] || [1, 99];

    if (Array.isArray(positionRange[0])) {
      // Multiple ranges (like NFL WR)
      const range = positionRange[Math.floor(Math.random() * positionRange.length)];
      return range[0] + Math.floor(Math.random() * (range[1] - range[0] + 1));
    } else {
      // Single range
      return positionRange[0] + Math.floor(Math.random() * (positionRange[1] - positionRange[0] + 1));
    }
  }

  /**
   * Generate height by sport and position
   */
  generateHeight(sport, position) {
    const heights = {
      'NFL': {
        'QB': [72, 77], 'RB': [68, 72], 'WR': [68, 76], 'TE': [74, 79],
        'OT': [76, 80], 'OG': [74, 78], 'C': [74, 77],
        'DE': [74, 79], 'DT': [74, 77], 'OLB': [72, 76], 'ILB': [71, 75],
        'CB': [68, 72], 'S': [69, 74], 'K': [68, 74], 'P': [70, 76]
      },
      'NBA': { 'PG': [70, 74], 'SG': [72, 76], 'SF': [74, 78], 'PF': [76, 80], 'C': [78, 84] },
      'MLB': { 'default': [68, 76] },
      'NHL': { 'default': [68, 76] }
    };

    const sportHeights = heights[sport] || heights['MLB'];
    const positionHeight = sportHeights[position] || sportHeights['default'] || [68, 76];
    
    const inches = positionHeight[0] + Math.floor(Math.random() * (positionHeight[1] - positionHeight[0] + 1));
    const feet = Math.floor(inches / 12);
    const remainingInches = inches % 12;
    
    return `${feet}'${remainingInches}"`;
  }

  /**
   * Generate weight by sport and position
   */
  generateWeight(sport, position) {
    const weights = {
      'NFL': {
        'QB': [200, 240], 'RB': [180, 220], 'WR': [170, 220], 'TE': [240, 270],
        'OT': [290, 330], 'OG': [290, 320], 'C': [280, 310],
        'DE': [250, 280], 'DT': [290, 330], 'OLB': [230, 260], 'ILB': [220, 250],
        'CB': [170, 200], 'S': [180, 210], 'K': [170, 200], 'P': [180, 210]
      },
      'NBA': { 'PG': [160, 200], 'SG': [180, 220], 'SF': [200, 240], 'PF': [220, 260], 'C': [240, 300] },
      'MLB': { 'default': [160, 240] },
      'NHL': { 'default': [170, 220] }
    };

    const sportWeights = weights[sport] || weights['MLB'];
    const positionWeight = sportWeights[position] || sportWeights['default'] || [170, 220];
    
    return positionWeight[0] + Math.floor(Math.random() * (positionWeight[1] - positionWeight[0] + 1));
  }

  /**
   * Get prop bet categories by sport and position
   */
  getPropCategories(sport, position) {
    const categories = {
      'NFL': {
        'QB': ['passing_yards', 'passing_touchdowns', 'interceptions', 'rushing_yards'],
        'RB': ['rushing_yards', 'rushing_touchdowns', 'receiving_yards', 'receptions'],
        'WR': ['receiving_yards', 'receptions', 'receiving_touchdowns'],
        'TE': ['receiving_yards', 'receptions', 'receiving_touchdowns'],
        'K': ['field_goals_made', 'extra_points_made'],
        'default': ['tackles', 'sacks', 'interceptions']
      },
      'NBA': {
        'default': ['points', 'rebounds', 'assists', 'steals', 'blocks', 'three_pointers_made']
      },
      'MLB': {
        'SP': ['strikeouts', 'wins', 'earned_runs_allowed'],
        'RP': ['saves', 'strikeouts'],
        'default': ['hits', 'runs', 'rbis', 'home_runs', 'stolen_bases']
      },
      'NHL': {
        'G': ['saves', 'goals_allowed', 'wins'],
        'default': ['goals', 'assists', 'points', 'shots_on_goal']
      }
    };

    const sportCategories = categories[sport] || categories['NBA'];
    return sportCategories[position] || sportCategories['default'] || ['performance'];
  }

  /**
   * Generate random injury status
   */
  getRandomInjuryStatus() {
    const statuses = ['healthy', 'healthy', 'healthy', 'healthy', 'healthy', 'questionable', 'injured'];
    return statuses[Math.floor(Math.random() * statuses.length)];
  }

  /**
   * Utility sleep function
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = PlayerRosterPopulator;