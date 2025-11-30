require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function find() {
  // Get a team from teams table
  const { data: team } = await supabase
    .from('teams')
    .select('*')
    .ilike('name', '%Broncos%')
    .single();
    
  console.log('\n🏈 Denver Broncos in teams table:');
  console.log(JSON.stringify(team, null, 2).substring(0, 500));
  
  // Get a stats record
  const { data: stats } = await supabase
    .from('team_stats_season')
    .select('team_id, metrics')
    .eq('season', 2025)
    .limit(3);
    
  console.log('\n📊 Sample team_stats_season rows:');
  stats.forEach(s => {
    console.log(`  team_id: ${s.team_id}`);
    console.log(`  wins: ${s.metrics.wins}, losses: ${s.metrics.losses}`);
  });
  
  // Check if there's an ESPN ID match
  if (team.espn_id) {
    console.log(`\n🔍 Looking for ESPN ID ${team.espn_id} in stats...`);
    // The metrics might have team info we're not seeing
  }
}

find().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
