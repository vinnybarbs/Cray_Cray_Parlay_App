require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkParlays() {
  console.log('\n📊 CHECKING PARLAYS STATUS\n');
  
  // Check parlays table
  const { data: parlays, error: parlaysError } = await supabase
    .from('parlays')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (parlaysError) {
    console.error('❌ Error fetching parlays:', parlaysError);
    return;
  }
  
  console.log(`\n🎲 RECENT PARLAYS (${parlays.length}):\n`);
  parlays.forEach((parlay, i) => {
    console.log(`${i + 1}. ID: ${parlay.id}`);
    console.log(`   User: ${parlay.user_id}`);
    console.log(`   Status: ${parlay.status}`);
    console.log(`   Created: ${parlay.created_at}`);
    console.log(`   Settled: ${parlay.settled_at || 'Not settled'}`);
    console.log(`   Wager: $${parlay.wager_amount || 0}`);
    console.log(`   Potential: $${parlay.potential_payout || 0}`);
    console.log(`   Actual: $${parlay.actual_payout || 0}`);
    console.log('');
  });
  
  // Check parlay_legs for unsettled parlays
  const unsettledParlays = parlays.filter(p => p.status === 'pending');
  
  if (unsettledParlays.length > 0) {
    console.log(`\n🔍 UNSETTLED PARLAY LEGS:\n`);
    
    for (const parlay of unsettledParlays) {
      const { data: legs, error: legsError } = await supabase
        .from('parlay_legs')
        .select('*')
        .eq('parlay_id', parlay.id);
        
      if (!legsError && legs) {
        console.log(`Parlay ${parlay.id} (${legs.length} legs):`);
        legs.forEach((leg, i) => {
          console.log(`  ${i + 1}. ${leg.pick_description}`);
          console.log(`     Outcome: ${leg.outcome || 'pending'}`);
          console.log(`     Odds: ${leg.odds}`);
        });
        console.log('');
      }
    }
  }
  
  // Summary stats
  const statusCounts = parlays.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});
  
  console.log(`\n📈 SUMMARY:`);
  console.log(`   Total parlays: ${parlays.length}`);
  console.log(`   By status:`, statusCounts);
  console.log('');
}

checkParlays().then(() => {
  console.log('✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
