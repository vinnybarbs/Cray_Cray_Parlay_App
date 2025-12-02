#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function addColumn() {
  console.log('📋 Adding api_sports_id column to players table...\n');

  // Try to select from the column to see if it already exists
  const { data: testData, error: testError } = await supabase
    .from('players')
    .select('api_sports_id')
    .limit(1);

  if (!testError) {
    console.log('✅ Column api_sports_id already exists!');
    return;
  }

  if (!testError?.message?.includes('does not exist')) {
    console.error('❌ Unexpected error:', testError.message);
    return;
  }

  console.log('Column does not exist, adding it now...\n');
  console.log('⚠️  Please run this SQL in Supabase SQL Editor:\n');
  console.log('-------------------------------------------');
  console.log(`
ALTER TABLE players 
ADD COLUMN api_sports_id INTEGER;

CREATE UNIQUE INDEX idx_players_api_sports_id 
ON players(api_sports_id) 
WHERE api_sports_id IS NOT NULL;
  `.trim());
  console.log('-------------------------------------------\n');
  console.log('Or visit: https://supabase.com/dashboard/project/pcjhulzyqmhrhsrgvwvx/sql/new');
  console.log('\nAfter running, press Enter to continue...');
}

addColumn().catch(console.error);
