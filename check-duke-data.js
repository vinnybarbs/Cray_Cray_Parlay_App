const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDukeData() {
  console.log('Checking Duke data in database...\n');
  
  // Check teams table
  const { data: team } = await supabase
    .from('teams')
    .select('*')
    .ilike('name', '%Duke%')
    .eq('sport', 'NCAAB')
    .maybeSingle();
  
  console.log('Team:', team);
  
  // Check standings
  if (team) {
    const { data: standing } = await supabase
      .from('standings')
      .select('*')
      .eq('team_id', team.id)
      .maybeSingle();
    
    console.log('Standing:', standing);
    
    // Check team_stats_season
    const { data: stats } = await supabase
      .from('team_stats_season')
      .select('*')
      .eq('team_id', team.id)
      .maybeSingle();
    
    console.log('Stats:', stats);
  }
}

checkDukeData();
