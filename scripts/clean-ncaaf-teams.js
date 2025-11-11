const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Major FBS college football teams (Division I)
// These are the teams that typically have betting lines and are in major conferences
const FBS_TEAMS = [
  // SEC
  'Alabama', 'Arkansas', 'Auburn', 'Florida', 'Georgia', 'Kentucky', 'LSU', 
  'Mississippi State', 'Missouri', 'Ole Miss', 'South Carolina', 'Tennessee', 
  'Texas A&M', 'Vanderbilt', 'Texas', 'Oklahoma',
  
  // Big Ten
  'Illinois', 'Indiana', 'Iowa', 'Maryland', 'Michigan', 'Michigan State', 
  'Minnesota', 'Nebraska', 'Northwestern', 'Ohio State', 'Penn State', 
  'Purdue', 'Rutgers', 'Wisconsin', 'Oregon', 'Washington', 'UCLA', 'USC',
  
  // Big 12
  'Baylor', 'Cincinnati', 'Houston', 'Iowa State', 'Kansas', 'Kansas State', 
  'Oklahoma State', 'TCU', 'Texas Tech', 'West Virginia', 'UCF', 'BYU',
  
  // ACC
  'Boston College', 'Clemson', 'Duke', 'Florida State', 'Georgia Tech', 
  'Louisville', 'Miami', 'NC State', 'North Carolina', 'Notre Dame', 
  'Pittsburgh', 'Syracuse', 'Virginia', 'Virginia Tech', 'Wake Forest',
  'California', 'Stanford', 'SMU',
  
  // Pac-12 (remaining)
  'Arizona', 'Arizona State', 'Colorado', 'Utah', 'Oregon State', 'Washington State',
  
  // AAC
  'East Carolina', 'Memphis', 'Navy', 'South Florida', 'Temple', 'Tulane', 
  'Tulsa', 'SMU', 'Army', 'Air Force',
  
  // Mountain West
  'Boise State', 'Colorado State', 'Fresno State', 'Hawaii', 'Nevada', 
  'New Mexico', 'San Diego State', 'San Jose State', 'UNLV', 'Utah State', 
  'Wyoming',
  
  // Sun Belt
  'Appalachian State', 'Arkansas State', 'Coastal Carolina', 'Georgia Southern', 
  'Georgia State', 'Louisiana', 'Louisiana Monroe', 'South Alabama', 'Texas State', 
  'Troy',
  
  // MAC
  'Akron', 'Ball State', 'Bowling Green', 'Buffalo', 'Central Michigan', 
  'Eastern Michigan', 'Kent State', 'Miami (OH)', 'Northern Illinois', 
  'Ohio', 'Toledo', 'Western Michigan',
  
  // Conference USA
  'Charlotte', 'FAU', 'FIU', 'Louisiana Tech', 'Middle Tennessee', 'North Texas', 
  'Old Dominion', 'Rice', 'UAB', 'UTEP', 'UTSA', 'Western Kentucky',
  
  // Independent
  'Liberty', 'New Mexico State', 'UConn',
  
  // Additional major programs
  'James Madison', 'Jacksonville State', 'Sam Houston State', 'Kennesaw State'
];

async function cleanNCAAFTeams() {
  console.log('🏈 Cleaning NCAAF teams to FBS-only...');
  
  // Get all current NCAAF teams
  const { data: currentTeams, error: fetchError } = await supabase
    .from('team_stats_cache')
    .select('team_id, team_name, sport, stats')
    .eq('sport', 'NCAAF');
    
  if (fetchError) {
    console.error('Error fetching current teams:', fetchError);
    return;
  }
  
  console.log(`Current NCAAF teams: ${currentTeams.length}`);
  
  // Filter to FBS teams only
  const fbsTeams = currentTeams.filter(team => {
    if (!team.team_name) return false;
    
    // Check if team name matches any FBS team (case insensitive, partial match)
    return FBS_TEAMS.some(fbsTeam => {
      const teamName = team.team_name.toLowerCase();
      const fbsName = fbsTeam.toLowerCase();
      
      // Direct match
      if (teamName === fbsName) return true;
      
      // Handle common variations
      if (teamName.includes(fbsName) || fbsName.includes(teamName)) return true;
      
      // Handle specific cases
      if (fbsName === 'miami' && teamName.includes('miami') && !teamName.includes('ohio')) return true;
      if (fbsName === 'miami (oh)' && teamName.includes('miami') && teamName.includes('ohio')) return true;
      if (fbsName === 'ole miss' && (teamName.includes('mississippi') && !teamName.includes('state'))) return true;
      
      return false;
    });
  });
  
  console.log(`FBS teams found: ${fbsTeams.length}`);
  
  // Delete all current NCAAF teams
  const { error: deleteError } = await supabase
    .from('team_stats_cache')
    .delete()
    .eq('sport', 'NCAAF');
    
  if (deleteError) {
    console.error('Error deleting current NCAAF teams:', deleteError);
    return;
  }
  
  console.log('✅ Deleted all current NCAAF teams');
  
  // Insert FBS teams back with season info
  if (fbsTeams.length > 0) {
    const teamsWithSeason = fbsTeams.map(team => ({
      ...team,
      season: team.season || 2025  // Ensure season is set
    }));
    
    const { error: insertError } = await supabase
      .from('team_stats_cache')
      .insert(teamsWithSeason);
      
    if (insertError) {
      console.error('Error inserting FBS teams:', insertError);
      return;
    }
    
    console.log(`✅ Inserted ${fbsTeams.length} FBS teams`);
  }
  
  // Show sample of kept teams
  console.log('\nSample FBS teams kept:');
  fbsTeams.slice(0, 10).forEach(team => {
    console.log(`- ${team.team_name} (ID: ${team.team_id})`);
  });
  
  if (fbsTeams.length > 10) {
    console.log('...');
    console.log(`Total: ${fbsTeams.length} FBS teams`);
  }
  
  // Final count check
  const { count: finalCount } = await supabase
    .from('team_stats_cache')
    .select('*', { count: 'exact', head: true })
    .eq('sport', 'NCAAF');
    
  console.log(`\n🎯 Final NCAAF count: ${finalCount}`);
  
  return finalCount;
}

cleanNCAAFTeams().then(count => {
  console.log(`\n✅ NCAAF cleanup complete! Now have ${count} FBS teams instead of 700+`);
}).catch(console.error);