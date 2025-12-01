require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debug() {
  console.log('🔍 Debugging why legs not updating...\n');
  
  // Get one pending leg
  const { data: legs } = await supabase
    .from('parlay_legs')
    .select('*')
    .eq('outcome', 'pending')
    .limit(3);
    
  if (!legs || legs.length === 0) {
    console.log('❌ No pending legs found!');
    return;
  }
  
  console.log(`Found ${legs.length} pending legs:\n`);
  
  legs.forEach((leg, i) => {
    console.log(`\nLeg ${i+1}:`);
    console.log(`  Game: ${leg.away_team} @ ${leg.home_team}`);
    console.log(`  Date: ${leg.game_date}`);
    console.log(`  Sport: ${leg.sport}`);
    console.log(`  Bet Type: ${leg.bet_type}`);
    console.log(`  Pick: ${leg.pick}`);
    console.log(`  Point: ${leg.point}`);
    
    const gameDate = new Date(leg.game_date);
    const now = new Date();
    const hoursSince = (now - gameDate) / 1000 / 60 / 60;
    console.log(`  Hours since game: ${hoursSince.toFixed(1)}`);
    console.log(`  Should check? ${hoursSince > 4 ? 'YES ✅' : 'NO ❌ (too recent)'}`);
  });
}

debug().then(() => process.exit(0));
