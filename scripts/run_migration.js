#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runMigration() {
  console.log('📋 Running migration: add_api_sports_id_to_players.sql\n');

  const sql = readFileSync('database/migrations/add_api_sports_id_to_players.sql', 'utf-8');

  // Split into individual statements
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));

  let successCount = 0;
  let errorCount = 0;

  for (const statement of statements) {
    if (!statement) continue;

    try {
      console.log(`Executing: ${statement.substring(0, 60)}...`);
      const { error } = await supabase.rpc('exec_sql', { sql: statement });
      
      if (error) {
        console.error(`  ❌ Error:`, error.message);
        errorCount++;
      } else {
        console.log(`  ✅ Success`);
        successCount++;
      }
    } catch (err) {
      console.error(`  ❌ Exception:`, err.message);
      errorCount++;
    }
  }

  console.log(`\n📊 Migration complete:`);
  console.log(`   Success: ${successCount}`);
  console.log(`   Errors: ${errorCount}`);

  // Verify the column exists
  console.log('\n🔍 Verifying column...');
  const { data, error } = await supabase
    .from('players')
    .select('api_sports_id')
    .limit(1);

  if (error) {
    if (error.message.includes('api_sports_id')) {
      console.log('✅ Column api_sports_id added successfully');
    } else {
      console.error('❌ Verification failed:', error.message);
    }
  } else {
    console.log('✅ Column api_sports_id verified and queryable');
  }
}

runMigration().catch(console.error);
