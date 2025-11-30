require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLegs() {
  console.log('\n🔍 CHECKING PARLAY LEGS IN DETAIL\n');
  
  // Get a sample parlay
  const { data: parlays } = await supabase
    .from('parlays')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(3);
    
  if (!parlays || parlays.length === 0) {
    console.log('❌ No pending parlays found');
    return;
  }
  
  for (const parlay of parlays) {
    console.log(`\n📋 PARLAY ${parlay.id}:`);
    console.log(`   Created: ${parlay.created_at}`);
    console.log(`   Status: ${parlay.status}`);
    console.log(`   Potential: $${parlay.potential_payout}`);
    
    const { data: legs, error } = await supabase
      .from('parlay_legs')
      .select('*')
      .eq('parlay_id', parlay.id)
      .order('created_at', { ascending: true });
      
    if (error) {
      console.error('   ❌ Error:', error);
      continue;
    }
    
    if (!legs || legs.length === 0) {
      console.log('   ⚠️  NO LEGS FOUND!');
      continue;
    }
    
    console.log(`\n   🦵 LEGS (${legs.length}):\n`);
    legs.forEach((leg, i) => {
      console.log(`   ${i + 1}. ${leg.pick_description || 'No description'}`);
      console.log(`      ID: ${leg.id}`);
      console.log(`      Sport: ${leg.sport || 'N/A'}`);
      console.log(`      Game: ${leg.away_team || '?'} @ ${leg.home_team || '?'}`);
      console.log(`      Game Date: ${leg.game_date || 'N/A'}`);
      console.log(`      Bet Type: ${leg.bet_type || 'N/A'}`);
      console.log(`      Pick: ${leg.pick || 'N/A'}`);
      console.log(`      Odds: ${leg.odds || 'N/A'}`);
      console.log(`      Outcome: ${leg.outcome || 'pending'}`);
      console.log(`      Settled: ${leg.settled_at || 'Not settled'}`);
      console.log('');
    });
  }
  
  // Check if legs table exists and has correct schema
  const { data: schema, error: schemaError } = await supabase
    .from('parlay_legs')
    .select('*')
    .limit(1);
    
  if (schemaError) {
    console.log('\n❌ Schema check failed:', schemaError);
  } else {
    console.log('\n✅ Parlay legs table schema looks good');
    if (schema && schema.length > 0) {
      console.log('   Sample columns:', Object.keys(schema[0]).join(', '));
    }
  }
}

checkLegs().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
