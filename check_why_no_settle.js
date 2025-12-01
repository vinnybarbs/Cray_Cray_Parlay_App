require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('🔍 Checking why parlay legs not settling...\n');
  
  // 1. Check recent legs
  const { data: legs } = await supabase
    .from('parlay_legs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);
    
  console.log('📊 Recent parlay_legs:');
  legs.forEach(leg => {
    const gameDate = new Date(leg.game_date);
    const now = new Date();
    const hoursSince = (now - gameDate) / 1000 / 60 / 60;
    
    console.log(`\n  Game: ${leg.away_team} @ ${leg.home_team}`);
    console.log(`  Date: ${leg.game_date} (${hoursSince.toFixed(1)}h ago)`);
    console.log(`  Bet: ${leg.bet_type} - ${leg.pick}`);
    console.log(`  Outcome: ${leg.outcome}`);
  });
  
  // 2. Check if any games are old enough (>4 hours)
  const fourHoursAgo = new Date();
  fourHoursAgo.setHours(fourHoursAgo.getHours() - 4);
  
  const { data: oldLegs } = await supabase
    .from('parlay_legs')
    .select('*')
    .eq('outcome', 'pending')
    .lt('game_date', fourHoursAgo.toISOString());
    
  console.log(`\n\n⏰ Legs >4 hours old that should be checkable: ${oldLegs?.length || 0}`);
  
  if (oldLegs && oldLegs.length > 0) {
    console.log('\nGames that SHOULD be settled:');
    oldLegs.slice(0, 5).forEach(leg => {
      const date = new Date(leg.game_date);
      console.log(`  - ${leg.away_team} @ ${leg.home_team}`);
      console.log(`    Date: ${date.toLocaleString()}`);
      console.log(`    Bet: ${leg.bet_type} - ${leg.pick}\n`);
    });
  } else {
    console.log('\n✅ No old pending legs - all games either:');
    console.log('   - Already settled, OR');
    console.log('   - Not finished yet (<4 hours old)');
  }
}

check().then(() => process.exit(0));
