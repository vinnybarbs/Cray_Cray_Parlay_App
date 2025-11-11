const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Definitive list of FBS team names - the exact 130 teams that compete in FBS
const FBS_TEAMS_EXACT = [
  // Power 5 Conferences
  // SEC (16 teams)
  'Alabama', 'Arkansas', 'Auburn', 'Florida', 'Georgia', 'Kentucky', 'LSU', 
  'Mississippi State', 'Missouri', 'Ole Miss', 'South Carolina', 'Tennessee', 
  'Texas A&M', 'Vanderbilt', 'Texas', 'Oklahoma',
  
  // Big Ten (18 teams)
  'Illinois', 'Indiana', 'Iowa', 'Maryland', 'Michigan', 'Michigan State', 
  'Minnesota', 'Nebraska', 'Northwestern', 'Ohio State', 'Penn State', 
  'Purdue', 'Rutgers', 'Wisconsin', 'Oregon', 'Washington', 'UCLA', 'USC',
  
  // Big 12 (16 teams)  
  'Arizona', 'Arizona State', 'Baylor', 'BYU', 'Cincinnati', 'Colorado', 
  'Houston', 'Iowa State', 'Kansas', 'Kansas State', 'Oklahoma State', 
  'TCU', 'Texas Tech', 'UCF', 'Utah', 'West Virginia',
  
  // ACC (17 teams)
  'Boston College', 'California', 'Clemson', 'Duke', 'Florida State', 'Georgia Tech', 
  'Louisville', 'Miami', 'NC State', 'North Carolina', 'Notre Dame', 
  'Pittsburgh', 'SMU', 'Stanford', 'Syracuse', 'Virginia', 'Virginia Tech', 'Wake Forest',
  
  // Group of 5 Conferences
  // AAC (14 teams)
  'Army', 'Charlotte', 'East Carolina', 'Florida Atlantic', 'Memphis', 'Navy', 
  'North Texas', 'Rice', 'South Florida', 'Temple', 'Tulane', 'Tulsa', 'UAB', 'UTSA',
  
  // Mountain West (12 teams)
  'Air Force', 'Boise State', 'Colorado State', 'Fresno State', 'Hawaii', 'Nevada', 
  'New Mexico', 'San Diego State', 'San Jose State', 'UNLV', 'Utah State', 'Wyoming',
  
  // Sun Belt (14 teams)
  'Appalachian State', 'Arkansas State', 'Coastal Carolina', 'Georgia Southern', 
  'Georgia State', 'James Madison', 'Louisiana', 'Louisiana Monroe', 'Marshall', 
  'Old Dominion', 'South Alabama', 'Southern Miss', 'Texas State', 'Troy',
  
  // MAC (12 teams)
  'Akron', 'Ball State', 'Bowling Green', 'Buffalo', 'Central Michigan', 
  'Eastern Michigan', 'Kent State', 'Miami (OH)', 'Northern Illinois', 
  'Ohio', 'Toledo', 'Western Michigan',
  
  // Conference USA (9 teams)
  'Florida International', 'Jacksonville State', 'Kennesaw State', 'Liberty', 
  'Louisiana Tech', 'Middle Tennessee', 'New Mexico State', 'Sam Houston', 'Western Kentucky',
  
  // Pac-12 (2 teams)
  'Oregon State', 'Washington State',
  
  // Independent (2 teams)
  'Connecticut', 'Massachusetts'
];

async function finalNCAAFCleanup() {
  console.log('🏈 Final NCAAF cleanup to exact FBS teams...');
  console.log(`Target: ${FBS_TEAMS_EXACT.length} FBS teams`);
  
  // Get current teams
  const { data: currentTeams, error } = await supabase
    .from('team_stats_cache')
    .select('team_id, team_name, sport')
    .eq('sport', 'NCAAF');
    
  if (error) {
    console.error('Error fetching teams:', error);
    return;
  }
  
  console.log(`Current NCAAF teams: ${currentTeams.length}`);
  
  // Filter to exact FBS matches only
  const fbsMatches = currentTeams.filter(team => {
    if (!team.team_name) return false;
    
    const teamName = team.team_name.toLowerCase().trim();
    
    return FBS_TEAMS_EXACT.some(fbsTeam => {
      const fbsName = fbsTeam.toLowerCase();
      
      // Exact match
      if (teamName === fbsName) return true;
      
      // Handle specific variations
      if (fbsName === 'ole miss' && (teamName.includes('mississippi') && !teamName.includes('state'))) return true;
      if (fbsName === 'miami' && teamName.includes('miami') && teamName.includes('hurricane')) return true;
      if (fbsName === 'miami (oh)' && teamName.includes('miami') && (teamName.includes('ohio') || teamName.includes('redhawk'))) return true;
      if (fbsName === 'nc state' && teamName.includes('north carolina state')) return true;
      if (fbsName === 'usc' && teamName.includes('southern california') && !teamName.includes('south carolina')) return true;
      if (fbsName === 'ucf' && (teamName.includes('central florida') || teamName === 'ucf')) return true;
      if (fbsName === 'smu' && (teamName.includes('southern methodist') || teamName === 'smu')) return true;
      if (fbsName === 'tcu' && (teamName.includes('texas christian') || teamName === 'tcu')) return true;
      if (fbsName === 'byu' && (teamName.includes('brigham young') || teamName === 'byu')) return true;
      if (fbsName === 'connecticut' && (teamName.includes('connecticut') || teamName === 'uconn')) return true;
      if (fbsName === 'massachusetts' && (teamName.includes('massachusetts') || teamName === 'umass')) return true;
      
      // Handle abbreviated names
      if (fbsName.includes('florida atlantic') && teamName.includes('fau')) return true;
      if (fbsName.includes('florida international') && teamName.includes('fiu')) return true;
      
      return false;
    });
  });
  
  console.log(`✅ Found ${fbsMatches.length} exact FBS matches`);
  
  // Delete all current NCAAF teams
  const { error: deleteError } = await supabase
    .from('team_stats_cache')
    .delete()
    .eq('sport', 'NCAAF');
    
  if (deleteError) {
    console.error('Error deleting teams:', deleteError);
    return;
  }
  
  // Re-insert only FBS teams with proper season
  if (fbsMatches.length > 0) {
    const teamsWithSeason = fbsMatches.map(team => ({
      ...team,
      season: 2025,
      last_updated: new Date().toISOString()
    }));
    
    const { error: insertError } = await supabase
      .from('team_stats_cache')
      .insert(teamsWithSeason);
      
    if (insertError) {
      console.error('Error inserting FBS teams:', insertError);
      return;
    }
  }
  
  // Final count
  const { count } = await supabase
    .from('team_stats_cache')
    .select('*', { count: 'exact', head: true })
    .eq('sport', 'NCAAF');
    
  console.log(`\n🎯 Final NCAAF count: ${count} (target was ${FBS_TEAMS_EXACT.length})`);
  
  // Show sample
  const { data: sampleTeams } = await supabase
    .from('team_stats_cache')
    .select('team_name')
    .eq('sport', 'NCAAF')
    .order('team_name')
    .limit(10);
    
  console.log('\nSample FBS teams:');
  sampleTeams.forEach(team => console.log(`- ${team.team_name}`));
  
  return count;
}

finalNCAAFCleanup().then(count => {
  console.log(`\n✅ NCAAF cleanup complete! Now have ${count} FBS teams (should be ~130)`);
}).catch(console.error);