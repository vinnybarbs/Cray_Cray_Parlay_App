require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('🔍 Checking parlay_legs table...\n');
  
  // Check table exists
  const { data: tables, error: tablesError } = await supabase
    .from('parlay_legs')
    .select('*')
    .limit(1);
    
  if (tablesError) {
    console.log('❌ parlay_legs table error:', tablesError.message);
    console.log('\n⚠️  Table may not exist. Run:');
    console.log('   cat CREATE_PARLAY_LEGS_TABLE.sql | supabase db execute');
    return;
  }
  
  console.log('✅ parlay_legs table exists');
  
  // Count legs
  const { count } = await supabase
    .from('parlay_legs')
    .select('*', { count: 'exact', head: true });
    
  console.log(`📊 Total legs in database: ${count}`);
  
  if (count === 0) {
    console.log('\n📭 No legs found - either:');
    console.log('   1. No parlays have been locked yet');
    console.log('   2. Insert is failing silently');
    console.log('\nCheck browser console when locking a parlay for errors.');
    return;
  }
  
  // Check recent legs
  const { data: recent } = await supabase
    .from('parlay_legs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);
    
  console.log('\n📋 Recent legs:');
  recent.forEach(leg => {
    console.log(`  - ${leg.pick} (${leg.bet_type}) - ${leg.outcome}`);
  });
}

check().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
