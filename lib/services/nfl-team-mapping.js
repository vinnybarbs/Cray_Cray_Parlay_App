/**
 * Maps team names from The Odds API to API-Sports team IDs
 * The Odds API uses full names, API-Sports uses IDs
 */

const NFL_TEAM_MAPPING = {
  // AFC East
  'Buffalo Bills': 2,
  'Miami Dolphins': 15,
  'New England Patriots': 17,
  'New York Jets': 20,
  
  // AFC North
  'Baltimore Ravens': 1,
  'Cincinnati Bengals': 4,
  'Cleveland Browns': 5,
  'Pittsburgh Steelers': 23,
  
  // AFC South
  'Houston Texans': 11,
  'Indianapolis Colts': 13,
  'Jacksonville Jaguars': 14,
  'Tennessee Titans': 27,
  
  // AFC West
  'Denver Broncos': 8,
  'Kansas City Chiefs': 12,
  'Las Vegas Raiders': 16,
  'Los Angeles Chargers': 24,
  
  // NFC East
  'Dallas Cowboys': 7,
  'New York Giants': 19,
  'Philadelphia Eagles': 22,
  'Washington Commanders': 28,
  
  // NFC North
  'Chicago Bears': 3,
  'Detroit Lions': 9,
  'Green Bay Packers': 10,
  'Minnesota Vikings': 18,
  
  // NFC South
  'Atlanta Falcons': 1,
  'Carolina Panthers': 29,
  'New Orleans Saints': 18,
  'Tampa Bay Buccaneers': 26,
  
  // NFC West
  'Arizona Cardinals': 22,
  'Los Angeles Rams': 14,
  'San Francisco 49ers': 25,
  'Seattle Seahawks': 26
};

/**
 * Get API-Sports team ID from team name
 */
function getTeamId(teamName) {
  // Try exact match first
  if (NFL_TEAM_MAPPING[teamName]) {
    return NFL_TEAM_MAPPING[teamName];
  }
  
  // Try partial match (case insensitive)
  const normalizedName = teamName.toLowerCase();
  for (const [name, id] of Object.entries(NFL_TEAM_MAPPING)) {
    if (name.toLowerCase().includes(normalizedName) || normalizedName.includes(name.toLowerCase())) {
      return id;
    }
  }
  
  return null;
}

/**
 * Get team name from API-Sports team ID
 */
function getTeamName(teamId) {
  for (const [name, id] of Object.entries(NFL_TEAM_MAPPING)) {
    if (id === teamId) {
      return name;
    }
  }
  return null;
}

module.exports = {
  NFL_TEAM_MAPPING,
  getTeamId,
  getTeamName
};
