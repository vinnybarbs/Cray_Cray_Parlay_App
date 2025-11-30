#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ quiet: true });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSchema() {
  console.log('🔍 Checking ai_suggestions table schema...\n');

  // Get a sample row to see actual columns
  const { data: sample, error } = await supabase
    .from('ai_suggestions')
    .select('*')
    .limit(1);

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  if (!sample || sample.length === 0) {
    console.log('⚠️  Table is empty, cannot check columns');
    return;
  }

  console.log('✅ ai_suggestions columns:');
  console.log(Object.keys(sample[0]).sort().join('\n'));
}

checkSchema();
