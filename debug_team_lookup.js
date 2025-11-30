require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugTeamLookup() {
  const teamName = 'Denver Broncos';
  
  console.log(`\n🔍 DEBUGGING: "${teamName}"\n`);
  
  // Step 1: Find team in teams table
  const { data: teams, error: teamError } = await supabase
    .from('teams')
    .select('id, name')
    .ilike('name', `%${teamName}%`)
    .limit(1);
    
  console.log('Step 1: Team lookup');
  console.log('  Error:', teamError);
  console.log('  Results:', teams);
  
  if (!teams || teams.length === 0) {
    console.log('\n❌ Team not found in teams table!');
    
    // Show what teams DO exist
    const { data: allTeams } = await supabase
      .from('teams')
      .select('id, name, sport')
      .eq('sport', 'NFL')
      .order('name')
      .limit(10);
      
    console.log('\n📋 Sample teams in table:');
    allTeams?.forEach(t => console.log(`  - ${t.name} (${t.id})`));
    return;
  }
  
  const teamId = teams[0].id;
  console.log(`\n✅ Found team: ${teams[0].name} (${teamId})`);
  
  // Step 2: Look for stats
  const { data: seasonData, error: statsError } = await supabase
    .from('team_stats_season')
    .select('*')
    .eq('team_id', teamId)
    .eq('season', 2025)
    .single();
    
  console.log('\nStep 2: Stats lookup');
  console.log('  Error:', statsError);
  console.log('  Has data:', !!seasonData);
  
  if (seasonData) {
    console.log('  Metrics:', Object.keys(seasonData.metrics || {}));
    console.log('  Sample:', JSON.stringify(seasonData.metrics).substring(0, 200));
  } else {
    // Check if stats exist but not matching
    const { data: anyStats } = await supabase
      .from('team_stats_season')
      .select('team_id, season')
      .limit(5);
      
    console.log('\n📋 Sample team_stats_season rows:');
    anyStats?.forEach(s => console.log(`  - team_id: ${s.team_id}, season: ${s.season}`));
  }
}

debugTeamLookup().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
