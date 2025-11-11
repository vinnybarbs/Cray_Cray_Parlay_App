require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function cleanupDuplicates() {
  console.log('🧹 Cleaning up duplicate team entries...');
  
  // Get all teams
  const { data: allTeams } = await supabase
    .from('team_stats_cache')
    .select('*')
    .order('team_id, last_updated');
  
  console.log(`Found ${allTeams.length} total entries`);
  
  // Group by team_id and keep the latest entry for each
  const uniqueTeams = {};
  for (const team of allTeams) {
    const key = `${team.team_id}-${team.sport}`;
    if (!uniqueTeams[key] || new Date(team.last_updated) > new Date(uniqueTeams[key].last_updated)) {
      uniqueTeams[key] = team;
    }
  }
  
  console.log(`Keeping ${Object.keys(uniqueTeams).length} unique teams`);
  
  // Delete all entries
  await supabase.from('team_stats_cache').delete().neq('team_id', 0);
  console.log('✅ Deleted all entries');
  
  // Insert unique entries
  const teamArray = Object.values(uniqueTeams);
  const { error } = await supabase
    .from('team_stats_cache')
    .insert(teamArray);
  
  if (error) {
    console.log('❌ Error inserting clean data:', error.message);
  } else {
    console.log('✅ Inserted clean team data');
  }
  
  // Verify
  const { data: finalTeams } = await supabase
    .from('team_stats_cache')
    .select('team_id, team_name, sport')
    .order('team_id');
  
  console.log(`📊 Final verification: ${finalTeams.length} teams`);
  finalTeams.forEach(team => {
    console.log(`ID ${team.team_id}: ${team.team_name} (${team.sport})`);
  });
}

cleanupDuplicates().catch(console.error);