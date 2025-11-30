#!/usr/bin/env node

// Simple check without RPC
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ quiet: true });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTables() {
  console.log('🔍 Checking database structure...\n');

  // Try to query parlay_legs
  console.log('📋 Checking parlay_legs table...');
  const { data: legs, error: legsError } = await supabase
    .from('parlay_legs')
    .select('*')
    .limit(1);

  if (legsError) {
    console.log('❌ parlay_legs does NOT exist');
    console.log('   Error:', legsError.message);
  } else {
    console.log('✅ parlay_legs EXISTS');
    console.log('   Sample:', legs);
  }

  // Try to query ai_suggestions
  console.log('\n📋 Checking ai_suggestions table...');
  const { data: sugg, error: suggError } = await supabase
    .from('ai_suggestions')
    .select('*')
    .limit(1);

  if (suggError) {
    console.log('❌ ai_suggestions does NOT exist');
    console.log('   Error:', suggError.message);
  } else {
    console.log('✅ ai_suggestions EXISTS');
    console.log('   Sample:', sugg);
  }

  // Check parlays metadata field
  console.log('\n📋 Checking parlays.metadata field...');
  const { data: parlays, error: parlaysError } = await supabase
    .from('parlays')
    .select('id, metadata')
    .limit(1);

  if (!parlaysError && parlays && parlays.length > 0) {
    console.log('✅ parlays table accessible');
    console.log('   Sample metadata:', JSON.stringify(parlays[0].metadata, null, 2));
  }

  // Count pending
  const { count } = await supabase
    .from('parlays')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  console.log(`\n📊 Found ${count} pending parlays`);

  console.log('\n' + '='.repeat(60));
  console.log('💡 DIAGNOSIS:');
  console.log('='.repeat(60));
  
  if (legsError && suggError) {
    console.log('❌ NEITHER parlay_legs NOR ai_suggestions exist!');
    console.log('   Your parlay picks are stored in parlays.metadata field');
    console.log('   This means the settlement system cannot work!');
  } else if (!legsError) {
    console.log('✅ Using parlay_legs table (standard structure)');
  } else if (!suggError) {
    console.log('✅ Using ai_suggestions table (alternative structure)');
  }
}

checkTables();
