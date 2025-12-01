require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data: legs } = await supabase
    .from('parlay_legs')
    .select('game_date, created_at')
    .order('created_at', { ascending: false })
    .limit(3);
    
  console.log('📅 Date formats in database:\n');
  legs.forEach((leg, i) => {
    console.log(`Leg ${i+1}:`);
    console.log(`  game_date: "${leg.game_date}" (type: ${typeof leg.game_date})`);
    console.log(`  created_at: "${leg.created_at}"`);
    console.log(`  Parsed game_date: ${new Date(leg.game_date)}`);
    console.log('');
  });
  
  // Test the comparison
  const fourHoursAgo = new Date();
  fourHoursAgo.setHours(fourHoursAgo.getHours() - 4);
  console.log(`\n4 hours ago: ${fourHoursAgo.toISOString()}`);
  console.log(`Comparing: game_date < ${fourHoursAgo.toISOString()}`);
  
  const { data: test } = await supabase
    .from('parlay_legs')
    .select('game_date, away_team, home_team')
    .eq('outcome', 'pending')
    .limit(5);
    
  console.log(`\n\n🔍 Raw pending legs:`);
  test.forEach(leg => {
    const gameDate = new Date(leg.game_date);
    const isOld = gameDate < fourHoursAgo;
    console.log(`  ${leg.away_team} @ ${leg.home_team}`);
    console.log(`    game_date: ${leg.game_date}`);
    console.log(`    Parsed: ${gameDate.toISOString()}`);
    console.log(`    Is old enough? ${isOld ? 'YES ✅' : 'NO ❌'}`);
  });
}

check().then(() => process.exit(0));
