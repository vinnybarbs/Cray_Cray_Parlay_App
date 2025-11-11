const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function mirrorNCAABToNCAAF() {
  console.log('🏈 Mirroring NCAAB teams to create NCAAF teams...');
  
  // Get all NCAAB teams
  const { data: ncaabTeams, error: fetchError } = await supabase
    .from('team_stats_cache')
    .select('*')
    .eq('sport', 'NCAAB');
    
  if (fetchError) {
    console.error('Error fetching NCAAB teams:', fetchError);
    return;
  }
  
  console.log(`📊 Found ${ncaabTeams.length} NCAAB teams to mirror`);
  
  // Create NCAAF versions with unique team IDs
  const ncaafTeams = ncaabTeams.map(team => ({
    team_id: team.team_id + 10000, // Offset to avoid conflicts
    team_name: team.team_name,
    sport: 'NCAAF',
    season: 2025,
    stats: {
      sport_type: 'football',
      games: { wins: 0, losses: 0, played: 0 },
      points: { for: 0, against: 0 },
      last_updated: new Date().toISOString(),
      mirrored_from: 'NCAAB',
      original_team_id: team.team_id
    },
    last_updated: new Date().toISOString()
  }));
  
  console.log(`🔄 Creating ${ncaafTeams.length} NCAAF teams...`);
  
  // Insert all NCAAF teams
  const { data: insertResult, error: insertError } = await supabase
    .from('team_stats_cache')
    .insert(ncaafTeams)
    .select('team_name, team_id');
    
  if (insertError) {
    console.error('Error inserting NCAAF teams:', insertError);
    return;
  }
  
  console.log(`✅ Successfully mirrored ${ncaafTeams.length} teams to NCAAF!`);
  
  // Show sample
  console.log('\nSample NCAAF teams created:');
  ncaafTeams.slice(0, 10).forEach(team => {
    console.log(`- ${team.team_name} (ID: ${team.team_id})`);
  });
  
  // Final verification
  const { count } = await supabase
    .from('team_stats_cache')
    .select('*', { count: 'exact', head: true })
    .eq('sport', 'NCAAF');
    
  console.log(`\n🎯 Final NCAAF count: ${count}`);
  
  return count;
}

mirrorNCAABToNCAAF().then(count => {
  console.log(`\n🏀➡️🏈 NCAAB mirroring complete! NCAAF now has ${count} teams (same as NCAAB)`);
}).catch(console.error);