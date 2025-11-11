/**
 * Static team ID mapping for API-Sports
 * NFL teams: IDs 1-32 (33-34 are AFC/NFC conferences)
 * NCAAF teams: IDs 35+ (major teams)
 */

const NFL_TEAMS = {
  // NFL teams with static IDs
  1: { id: 1, name: 'Las Vegas Raiders', league: 'NFL' },
  2: { id: 2, name: 'Jacksonville Jaguars', league: 'NFL' },
  3: { id: 3, name: 'New England Patriots', league: 'NFL' },
  4: { id: 4, name: 'New York Giants', league: 'NFL' },
  5: { id: 5, name: 'Baltimore Ravens', league: 'NFL' },
  6: { id: 6, name: 'Tennessee Titans', league: 'NFL' },
  7: { id: 7, name: 'Detroit Lions', league: 'NFL' },
  8: { id: 8, name: 'Atlanta Falcons', league: 'NFL' },
  9: { id: 9, name: 'Cleveland Browns', league: 'NFL' },
  10: { id: 10, name: 'Cincinnati Bengals', league: 'NFL' },
  11: { id: 11, name: 'Arizona Cardinals', league: 'NFL' },
  12: { id: 12, name: 'Philadelphia Eagles', league: 'NFL' },
  13: { id: 13, name: 'New York Jets', league: 'NFL' },
  14: { id: 14, name: 'San Francisco 49ers', league: 'NFL' },
  15: { id: 15, name: 'Green Bay Packers', league: 'NFL' },
  16: { id: 16, name: 'Chicago Bears', league: 'NFL' },
  17: { id: 17, name: 'Kansas City Chiefs', league: 'NFL' },
  18: { id: 18, name: 'Washington Commanders', league: 'NFL' },
  19: { id: 19, name: 'Carolina Panthers', league: 'NFL' },
  20: { id: 20, name: 'Buffalo Bills', league: 'NFL' },
  21: { id: 21, name: 'Indianapolis Colts', league: 'NFL' },
  22: { id: 22, name: 'Pittsburgh Steelers', league: 'NFL' },
  23: { id: 23, name: 'Seattle Seahawks', league: 'NFL' },
  24: { id: 24, name: 'Tampa Bay Buccaneers', league: 'NFL' },
  25: { id: 25, name: 'Miami Dolphins', league: 'NFL' },
  26: { id: 26, name: 'Houston Texans', league: 'NFL' },
  27: { id: 27, name: 'New Orleans Saints', league: 'NFL' },
  28: { id: 28, name: 'Denver Broncos', league: 'NFL' },
  29: { id: 29, name: 'Dallas Cowboys', league: 'NFL' },
  30: { id: 30, name: 'Los Angeles Chargers', league: 'NFL' },
  31: { id: 31, name: 'Los Angeles Rams', league: 'NFL' },
  32: { id: 32, name: 'Minnesota Vikings', league: 'NFL' }
  // Note: IDs 33-34 are AFC/NFC conferences, not teams
};

// NCAAF and NCAAB teams use the same IDs (35+) since they're the same universities
// We have populated both sports in our team_stats_cache with 161 teams each
const COLLEGE_TEAMS = {
  // Note: College teams (NCAAF/NCAAB) are stored in database cache
  // Same team IDs used for both football and basketball (same universities)
  // IDs range from 35+ with 161 major college programs cached
};

// Combined lookup (only NFL teams are static, college teams are in database)
const ALL_TEAMS = { ...NFL_TEAMS };

// Name-based lookup (case insensitive)
const TEAM_NAME_LOOKUP = {};
Object.values(ALL_TEAMS).forEach(team => {
  const cleanName = team.name.toLowerCase();
  TEAM_NAME_LOOKUP[cleanName] = team;
  
  // Add common variations
  const words = cleanName.split(' ');
  const lastWord = words[words.length - 1];
  const cityName = words.slice(0, -1).join(' ');
  
  // Add city name lookup
  if (cityName) {
    TEAM_NAME_LOOKUP[cityName] = team;
  }
  
  // Add team name lookup
  TEAM_NAME_LOOKUP[lastWord] = team;
});

/**
 * Find team by name using static mapping
 */
function findTeamByName(teamName) {
  if (!teamName) return null;
  
  const clean = teamName.toLowerCase().trim();
  
  // Direct match
  if (TEAM_NAME_LOOKUP[clean]) {
    return TEAM_NAME_LOOKUP[clean];
  }
  
  // Partial match
  for (const [key, team] of Object.entries(TEAM_NAME_LOOKUP)) {
    if (key.includes(clean) || clean.includes(key)) {
      return team;
    }
  }
  
  return null;
}

/**
 * Find team by ID
 */
function findTeamById(teamId) {
  return ALL_TEAMS[teamId] || null;
}

/**
 * Find team by name and sport using database cache
 * This is used for NCAAF/NCAAB teams since we have 161 teams cached
 */
async function findTeamBySport(teamName, sport, supabase) {
  if (!supabase || !teamName || !sport) return null;
  
  try {
    const { data, error } = await supabase
      .from('team_stats_cache')
      .select('team_id, team_name, sport')
      .eq('sport', sport)
      .or(`team_name.ilike.%${teamName}%,team_name.ilike.%${teamName.replace(/\s+/g, ' ')}%`)
      .limit(1);
    
    if (error || !data || data.length === 0) {
      return null;
    }
    
    return { 
      id: data[0].team_id, 
      name: data[0].team_name, 
      league: data[0].sport 
    };
  } catch (error) {
    return null;
  }
}

/**
 * Universal team finder - tries static lookup first, then database cache
 */
async function findTeamUniversal(teamName, sport = null, supabase = null) {
  // For NFL, use static lookup (fastest)
  if (sport === 'NFL' || !sport) {
    const nflTeam = findTeamByName(teamName);
    if (nflTeam) return nflTeam;
  }
  
  // For college sports or when NFL lookup fails, use database cache
  if (supabase) {
    const sports = sport ? [sport] : ['NCAAF', 'NCAAB'];
    
    for (const checkSport of sports) {
      const team = await findTeamBySport(teamName, checkSport, supabase);
      if (team) return team;
    }
  }
  
  return null;
}

module.exports = {
  NFL_TEAMS,
  COLLEGE_TEAMS,
  ALL_TEAMS,
  TEAM_NAME_LOOKUP,
  findTeamByName,
  findTeamById,
  findTeamBySport,
  findTeamUniversal
};