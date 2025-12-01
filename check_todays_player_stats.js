require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('🏈 Checking player_game_stats for Nov 30, 2025...\n');
  
  const { data, error } = await supabase
    .from('player_game_stats')
    .select('player_name, team, game_date, pass_yards, pass_tds, rush_yards, receptions, rec_yards')
    .eq('game_date', '2025-11-30')
    .limit(20);
    
  if (error) {
    console.log('❌ Error:', error.message);
    return;
  }
  
  console.log(`Found ${data?.length || 0} player stats for today\n`);
  
  if (data && data.length > 0) {
    console.log('Sample player stats:');
    data.slice(0, 10).forEach(stat => {
      console.log(`  ${stat.player_name} (${stat.team})`);
      console.log(`    Pass: ${stat.pass_yards || 0} yds, ${stat.pass_tds || 0} TDs`);
      console.log(`    Rush: ${stat.rush_yards || 0} yds`);
      console.log(`    Rec: ${stat.receptions || 0} rec, ${stat.rec_yards || 0} yds\n`);
    });
  } else {
    console.log('❌ NO PLAYER STATS FOR TODAY!');
    console.log('\n🔧 Need to fetch from API-Sports.');
    console.log('   Triggering sync now...\n');
    
    // Trigger API-Sports sync
    const response = await fetch('https://craycrayparlayapp-production.up.railway.app/api/sync-apisports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    
    const result = await response.json();
    console.log('Sync result:', result);
  }
}

check().then(() => process.exit(0));
