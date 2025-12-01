require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('🏈 Checking player_game_stats with proper join...\n');
  
  const { data, error } = await supabase
    .from('player_game_stats')
    .select(`
      *,
      players (
        name,
        team:teams (name)
      )
    `)
    .eq('game_date', '2025-11-30')
    .limit(10);
    
  if (error) {
    console.log('❌ Error:', error.message);
    console.log('\nTrying simpler query...\n');
    
    const { data: simple, error: simpleError } = await supabase
      .from('player_game_stats')
      .select('*')
      .gte('game_date', '2025-11-29')
      .limit(5);
      
    if (simpleError) {
      console.log('❌ Still error:', simpleError.message);
    } else {
      console.log(`Found ${simple?.length || 0} records since Nov 29`);
      if (simple && simple.length > 0) {
        console.log('\nSample record:', JSON.stringify(simple[0], null, 2));
      }
    }
    return;
  }
  
  console.log(`Found ${data?.length || 0} player stats for Nov 30\n`);
  
  if (data && data.length > 0) {
    console.log('✅ Player stats available:');
    data.forEach(stat => {
      console.log(`  ${stat.players?.name || 'Unknown'} (${stat.players?.team?.name || 'Unknown'})`);
      console.log(`    Pass: ${stat.passing_yards || 0} yds, ${stat.passing_touchdowns || 0} TDs`);
      console.log(`    Rush: ${stat.rushing_yards || 0} yds, ${stat.rushing_touchdowns || 0} TDs`);
      console.log(`    Rec: ${stat.receptions || 0} rec, ${stat.receiving_yards || 0} yds\n`);
    });
  } else {
    console.log('❌ NO PLAYER STATS FOR TODAY!');
    console.log('\n🔧 Need to trigger API-Sports sync for today\'s games.');
  }
}

check().then(() => process.exit(0));
