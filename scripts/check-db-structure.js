#!/usr/bin/env node

// Check actual database structure
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDatabaseStructure() {
  console.log('🔍 Checking actual database structure...\n');

  try {
    // 1. Check what tables exist
    console.log('📋 TABLES IN PUBLIC SCHEMA:');
    console.log('=' .repeat(60));
    
    const { data: tables, error: tablesError } = await supabase
      .rpc('sql', {
        query: `
          SELECT 
            table_name,
            COALESCE(
              (SELECT COUNT(*) 
               FROM information_schema.columns 
               WHERE table_schema = 'public' 
               AND table_name = t.table_name), 
              0
            ) as column_count
          FROM information_schema.tables t
          WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
          ORDER BY table_name;
        `
      });

    if (tablesError) {
      console.error('Error fetching tables:', tablesError);
    } else {
      console.table(tables);
    }

    // 2. Check if parlay_legs exists
    console.log('\n🔍 CHECKING FOR PARLAY_LEGS TABLE:');
    console.log('=' .repeat(60));
    
    const { data: legsCols, error: legsError } = await supabase
      .rpc('sql', {
        query: `
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'parlay_legs'
          ORDER BY ordinal_position;
        `
      });

    if (legsError) {
      console.log('❌ parlay_legs table does NOT exist');
    } else if (!legsCols || legsCols.length === 0) {
      console.log('❌ parlay_legs table does NOT exist');
    } else {
      console.log('✅ parlay_legs table EXISTS with columns:');
      console.table(legsCols);
    }

    // 3. Check if ai_suggestions exists
    console.log('\n🔍 CHECKING FOR AI_SUGGESTIONS TABLE:');
    console.log('=' .repeat(60));
    
    const { data: suggCols, error: suggError } = await supabase
      .rpc('sql', {
        query: `
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ai_suggestions'
          ORDER BY ordinal_position;
        `
      });

    if (suggError) {
      console.log('❌ ai_suggestions table does NOT exist');
    } else if (!suggCols || suggCols.length === 0) {
      console.log('❌ ai_suggestions table does NOT exist');
    } else {
      console.log('✅ ai_suggestions table EXISTS with columns:');
      console.table(suggCols);
    }

    // 4. Check parlays table structure
    console.log('\n🔍 PARLAYS TABLE STRUCTURE:');
    console.log('=' .repeat(60));
    
    const { data: parlaysCols, error: parlaysError } = await supabase
      .rpc('sql', {
        query: `
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'parlays'
          ORDER BY ordinal_position;
        `
      });

    if (!parlaysError && parlaysCols) {
      console.table(parlaysCols);
    }

    // 5. Check pending parlays count
    console.log('\n📊 PENDING PARLAYS:');
    console.log('=' .repeat(60));
    
    const { data: pending, error: pendingError } = await supabase
      .from('parlays')
      .select('id, status, created_at, total_legs', { count: 'exact' })
      .eq('status', 'pending');

    if (!pendingError && pending) {
      console.log(`Found ${pending.length} pending parlays:`);
      console.table(pending);
    } else {
      console.log('No pending parlays found or error:', pendingError);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkDatabaseStructure();
