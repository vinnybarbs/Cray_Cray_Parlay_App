require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  // Check pending
  const { data: pending } = await supabase
    .from('parlay_legs')
    .select('outcome')
    .eq('outcome', 'pending');
    
  // Check settled
  const { data: settled } = await supabase
    .from('parlay_legs')
    .select('outcome, pick')
    .in('outcome', ['won', 'lost', 'push']);
    
  console.log(`📊 Parlay Legs Status:`);
  console.log(`  Pending: ${pending?.length || 0}`);
  console.log(`  Settled: ${settled?.length || 0}\n`);
  
  if (settled && settled.length > 0) {
    console.log('✅ SETTLED LEGS:');
    settled.forEach(leg => {
      console.log(`  ${leg.outcome.toUpperCase()}: ${leg.pick}`);
    });
  } else {
    console.log('❌ No legs have been settled yet');
  }
}

check().then(() => process.exit(0));
