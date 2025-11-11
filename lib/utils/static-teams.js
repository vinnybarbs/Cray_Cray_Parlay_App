/**
 * Static NFL Team Lookup - API-Sports Team IDs are static
 * This eliminates the need for database or API calls for team lookups
 */

const NFL_TEAMS = {
  // Team ID to Team Info mapping
  1: { id: 1, name: "Las Vegas Raiders", code: "LV" },
  2: { id: 2, name: "Jacksonville Jaguars", code: "JAX" },
  3: { id: 3, name: "New England Patriots", code: "NE" },
  4: { id: 4, name: "New York Giants", code: "NYG" },
  5: { id: 5, name: "Baltimore Ravens", code: "BAL" },
  6: { id: 6, name: "Tennessee Titans", code: "TEN" },
  7: { id: 7, name: "Detroit Lions", code: "DET" },
  8: { id: 8, name: "Atlanta Falcons", code: "ATL" },
  9: { id: 9, name: "Cleveland Browns", code: "CLE" },
  10: { id: 10, name: "Cincinnati Bengals", code: "CIN" },
  11: { id: 11, name: "Arizona Cardinals", code: "ARI" },
  12: { id: 12, name: "Philadelphia Eagles", code: "PHI" },
  13: { id: 13, name: "New York Jets", code: "NYJ" },
  14: { id: 14, name: "San Francisco 49ers", code: "SF" },
  15: { id: 15, name: "Green Bay Packers", code: "GB" },
  16: { id: 16, name: "Chicago Bears", code: "CHI" },
  17: { id: 17, name: "Kansas City Chiefs", code: "KC" },
  18: { id: 18, name: "Washington Commanders", code: "WAS" },
  19: { id: 19, name: "Carolina Panthers", code: "CAR" },
  20: { id: 20, name: "Buffalo Bills", code: "BUF" },
  21: { id: 21, name: "Indianapolis Colts", code: "IND" },
  22: { id: 22, name: "Pittsburgh Steelers", code: "PIT" },
  23: { id: 23, name: "Seattle Seahawks", code: "SEA" },
  24: { id: 24, name: "Tampa Bay Buccaneers", code: "TB" },
  25: { id: 25, name: "Miami Dolphins", code: "MIA" },
  26: { id: 26, name: "Houston Texans", code: "HOU" },
  27: { id: 27, name: "New Orleans Saints", code: "NO" },
  28: { id: 28, name: "Denver Broncos", code: "DEN" },
  29: { id: 29, name: "Dallas Cowboys", code: "DAL" },
  30: { id: 30, name: "Los Angeles Chargers", code: "LAC" },
  31: { id: 31, name: "Los Angeles Rams", code: "LAR" },
  32: { id: 32, name: "Minnesota Vikings", code: "MIN" }
};

// Create reverse lookups for fast searching
const TEAM_NAME_TO_ID = {};
const TEAM_CODE_TO_ID = {};

for (const [id, team] of Object.entries(NFL_TEAMS)) {
  // Map full names
  TEAM_NAME_TO_ID[team.name.toLowerCase()] = parseInt(id);
  
  // Map common variations
  TEAM_NAME_TO_ID[team.code.toLowerCase()] = parseInt(id);
  TEAM_CODE_TO_ID[team.code.toLowerCase()] = parseInt(id);
  
  // Map team names without city for easier matching
  const teamOnly = team.name.split(' ').slice(-1)[0].toLowerCase();
  if (!TEAM_NAME_TO_ID[teamOnly]) {
    TEAM_NAME_TO_ID[teamOnly] = parseInt(id);
  }
}

// Add common aliases
const TEAM_ALIASES = {
  'raiders': 1,
  'jaguars': 2, 'jags': 2,
  'patriots': 3, 'pats': 3,
  'giants': 4,
  'ravens': 5,
  'titans': 6,
  'lions': 7,
  'falcons': 8,
  'browns': 9,
  'bengals': 10,
  'cardinals': 11, 'cards': 11,
  'eagles': 12,
  'jets': 13,
  '49ers': 14, 'niners': 14,
  'packers': 15,
  'bears': 16,
  'chiefs': 17,
  'commanders': 18, 'washington': 18,
  'panthers': 19,
  'bills': 20,
  'colts': 21,
  'steelers': 22,
  'seahawks': 23, 'hawks': 23,
  'buccaneers': 24, 'bucs': 24, 'tampa bay': 24,
  'dolphins': 25, 'fins': 25,
  'texans': 26,
  'saints': 27,
  'broncos': 28,
  'cowboys': 29,
  'chargers': 30,
  'rams': 31,
  'vikings': 32, 'vikes': 32
};

Object.assign(TEAM_NAME_TO_ID, TEAM_ALIASES);

class StaticTeamLookup {
  /**
   * Get team info by ID
   */
  static getTeamById(id) {
    return NFL_TEAMS[id] || null;
  }

  /**
   * Find team by name (fuzzy matching)
   */
  static findTeamByName(teamName) {
    if (!teamName) return null;
    
    const cleanName = teamName.toLowerCase().trim();
    
    // Direct lookup
    const id = TEAM_NAME_TO_ID[cleanName];
    if (id) {
      return NFL_TEAMS[id];
    }

    // Fuzzy matching - check if any team name contains the search term
    for (const [id, team] of Object.entries(NFL_TEAMS)) {
      if (team.name.toLowerCase().includes(cleanName) || 
          cleanName.includes(team.name.toLowerCase()) ||
          team.code.toLowerCase() === cleanName) {
        return team;
      }
    }

    return null;
  }

  /**
   * Get all teams
   */
  static getAllTeams() {
    return Object.values(NFL_TEAMS);
  }

  /**
   * Check if team exists
   */
  static teamExists(teamName) {
    return this.findTeamByName(teamName) !== null;
  }
}

module.exports = {
  NFL_TEAMS,
  TEAM_NAME_TO_ID,
  TEAM_CODE_TO_ID,
  StaticTeamLookup
};