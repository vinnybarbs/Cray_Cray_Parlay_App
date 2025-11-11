// Populate team cache using 2024 season data (most recent with actual teams)
// Mark as 2025 season for current team lookups

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const apiKey = process.env.APISPORTS_API_KEY;

async function populateTeamCache() {
  try {
    console.log('🏈 Fetching NFL teams from API-Sports (2024 season data for 2025 lookups)...');
    
    // Try 2025 first, then fallback to 2024, then 2023
    const seasonsToTry = [2025, 2024, 2023];
    let teams = [];
    let workingSeason = null;
    
    for (const season of seasonsToTry) {
      console.log(`  Trying season ${season}...`);
      const response = await fetch(`https://v1.american-football.api-sports.io/teams?league=1&season=${season}`, {
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': 'v1.american-football.api-sports.io'
        }
      });
      
      const data = await response.json();
      if (data.response && data.response.length > 0) {
        teams = data.response;
        workingSeason = season;
        console.log(`  ✅ Found ${teams.length} teams in ${season} season`);
        break;
      } else {
        console.log(`  ❌ No teams in ${season} season`);
      }
    }
    
    if (teams.length === 0) {
      throw new Error('No teams found in any recent season');
    }
    
    console.log(`\n📊 Using ${workingSeason} season data to populate 2025 team cache...`);
    let successCount = 0;
    
    for (const teamData of teams) {
      try {
        const team = teamData.team || teamData;
        
        console.log(`  Caching: ${team.name} (ID: ${team.id})`);
        
        const { error } = await supabase
          .from('team_stats_cache')
          .upsert({
            sport: 'NFL',
            team_id: team.id,
            team_name: team.name,
            season: 2025
          }, {
            onConflict: 'sport,team_id,season'
          });

        if (error) {
          console.error(`❌ Error caching ${team.name}:`, error.message);
        } else {
          successCount++;
        }
        
      } catch (teamError) {
        console.error(`Error processing team:`, teamError.message);
      }
    }
    
    console.log(`\n✅ Successfully cached ${successCount}/${teams.length} teams`);
    
    // Verify cache and test key lookups
    const { data: cachedTeams } = await supabase
      .from('team_stats_cache')
      .select('team_name, team_id, team_code')
      .eq('sport', 'NFL')
      .eq('season', 2025)
      .order('team_name');
      
    console.log(`\n📊 Cache verification: ${cachedTeams?.length || 0} teams in 2025 season cache`);
    
    if (cachedTeams && cachedTeams.length > 0) {
      console.log('\n🔍 Testing team name lookups...');
      const testTeams = ['Kansas City Chiefs', 'Buffalo Bills', 'Tampa Bay Buccaneers'];
      
      for (const teamName of testTeams) {
        const match = cachedTeams.find(t => t.team_name === teamName);
        if (match) {
          console.log(`  ✅ ${match.team_name} (ID: ${match.team_id}, Code: ${match.team_code})`);
        } else {
          console.log(`  ❌ Not found: ${teamName}`);
        }
      }
    }
    
  } catch (error) {
    console.error('💥 Team cache population failed:', error.message);
  }
}

populateTeamCache().then(() => {
  console.log('\n🎉 Team cache population completed! This should resolve API-Sports timeouts in suggest-picks.');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Population failed:', error);
  process.exit(1);
});