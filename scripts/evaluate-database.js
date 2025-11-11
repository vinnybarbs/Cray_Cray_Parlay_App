#!/usr/bin/env node
/**
 * Comprehensive Database & Edge Function Evaluation
 * Checks all endpoints, database functions, cron jobs, and edge functions
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.log('❌ Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function evaluateDatabase() {
  console.log('\n🔍 COMPREHENSIVE DATABASE EVALUATION\n');
  console.log('=' .repeat(80));
  
  // 1. Check Core Tables
  console.log('\n📊 CORE TABLES STATUS');
  console.log('-' .repeat(40));
  
  const coreTables = [
    'odds_cache',
    'sports_cache', 
    'team_stats',
    'player_stats',
    'user_parlays',
    'parlay_legs',
    'sports_metadata'
  ];
  
  for (const table of coreTables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        console.log(`❌ ${table}: ${error.message}`);
      } else {
        console.log(`✅ ${table}: ${count || 0} rows`);
      }
    } catch (err) {
      console.log(`❌ ${table}: ${err.message}`);
    }
  }
  
  // 2. Check Cron Jobs
  console.log('\n⏰ CRON JOBS STATUS');
  console.log('-' .repeat(40));
  
  try {
    const { data: jobs, error } = await supabase
      .from('cron.job')
      .select('*')
      .order('jobname');
    
    if (error) {
      console.log('❌ Cannot access cron jobs:', error.message);
    } else {
      console.log(`Found ${jobs?.length || 0} cron jobs:`);
      jobs?.forEach(job => {
        const status = job.active ? '🟢 Active' : '🔴 Inactive';
        console.log(`  ${status} ${job.jobname} - Schedule: ${job.schedule}`);
      });
    }
  } catch (err) {
    console.log('❌ Cron jobs error:', err.message);
  }
  
  // 3. Check Recent Cron Executions
  console.log('\n📜 RECENT CRON EXECUTIONS (Last 10)');
  console.log('-' .repeat(40));
  
  try {
    const { data: runs, error } = await supabase
      .from('cron.job_run_details')
      .select('*')
      .order('start_time', { ascending: false })
      .limit(10);
    
    if (error) {
      console.log('❌ Cannot access cron history:', error.message);
    } else {
      runs?.forEach((run, i) => {
        const status = run.status === 'succeeded' ? '✅' : 
                      run.status === 'failed' ? '❌' : '⏳';
        const time = new Date(run.start_time).toLocaleString();
        console.log(`  ${i+1}. ${status} ${run.jobname} - ${time} (${run.status})`);
      });
    }
  } catch (err) {
    console.log('❌ Cron history error:', err.message);
  }
  
  // 4. Check Edge Functions (via RPC if available)
  console.log('\n🔌 EDGE FUNCTIONS STATUS');
  console.log('-' .repeat(40));
  
  const edgeFunctions = [
    'refresh-odds',
    'refresh-sports-intelligence', 
    'sync-sports-stats',
    'check-parlay-outcomes'
  ];
  
  for (const func of edgeFunctions) {
    // Try to check if function exists by attempting a test call
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/${func}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ test: true })
      });
      
      if (response.status === 404) {
        console.log(`❌ ${func}: Not deployed`);
      } else {
        console.log(`✅ ${func}: Deployed (Status: ${response.status})`);
      }
    } catch (err) {
      console.log(`⚠️  ${func}: ${err.message}`);
    }
  }
  
  // 5. Check Database Functions
  console.log('\n🛠️  DATABASE FUNCTIONS');
  console.log('-' .repeat(40));
  
  try {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT 
          routine_name,
          routine_type,
          data_type
        FROM information_schema.routines 
        WHERE routine_schema = 'public'
        AND routine_name IN (
          'ensure_pg_net_enabled',
          'check_cron_health',
          'get_team_stats',
          'get_player_stats'
        )
        ORDER BY routine_name;
      `
    });
    
    if (error) {
      console.log('❌ Cannot check database functions:', error.message);
    } else {
      if (data && data.length > 0) {
        data.forEach(func => {
          console.log(`✅ ${func.routine_name} (${func.routine_type})`);
        });
      } else {
        console.log('ℹ️  No custom database functions found');
      }
    }
  } catch (err) {
    console.log('❌ Database functions error:', err.message);
  }
  
  // 6. Check Extensions
  console.log('\n🔧 EXTENSIONS STATUS');
  console.log('-' .repeat(40));
  
  try {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `SELECT name, installed_version FROM pg_available_extensions WHERE name IN ('pg_cron', 'pg_net', 'http') ORDER BY name;`
    });
    
    if (error) {
      console.log('❌ Cannot check extensions:', error.message);
    } else {
      data?.forEach(ext => {
        const status = ext.installed_version ? '✅ Installed' : '❌ Not installed';
        console.log(`  ${status} ${ext.name} ${ext.installed_version || ''}`);
      });
    }
  } catch (err) {
    console.log('❌ Extensions error:', err.message);
  }
  
  // 7. Sample Recent Data
  console.log('\n📈 SAMPLE RECENT DATA');
  console.log('-' .repeat(40));
  
  try {
    const { data: recentOdds, error: oddsError } = await supabase
      .from('odds_cache')
      .select('sport, home_team, away_team, commence_time')
      .order('created_at', { ascending: false })
      .limit(3);
    
    if (oddsError) {
      console.log('❌ Cannot fetch recent odds:', oddsError.message);
    } else if (recentOdds && recentOdds.length > 0) {
      console.log('Recent odds data:');
      recentOdds.forEach((game, i) => {
        console.log(`  ${i+1}. ${game.sport}: ${game.home_team} vs ${game.away_team}`);
      });
    } else {
      console.log('⚠️  No recent odds data found');
    }
  } catch (err) {
    console.log('❌ Sample data error:', err.message);
  }
  
  console.log('\n' + '=' .repeat(80));
  console.log('🏁 EVALUATION COMPLETE');
  console.log('\nNext steps:');
  console.log('1. Check failed cron jobs and fix edge function issues');
  console.log('2. Ensure pg_net extension is working for HTTP calls');
  console.log('3. Optimize edge functions for free tier limits');
  console.log('4. Verify API keys are properly configured');
}

// Add RPC helper for raw SQL if needed
async function createRPCHelper() {
  try {
    await supabase.rpc('exec_sql', {
      sql: `
        CREATE OR REPLACE FUNCTION exec_sql(sql text)
        RETURNS jsonb
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$
        DECLARE
          result jsonb;
        BEGIN
          EXECUTE sql;
          GET DIAGNOSTICS result = ROW_COUNT;
          RETURN json_build_object('success', true, 'rows_affected', result);
        EXCEPTION WHEN OTHERS THEN
          RETURN json_build_object('success', false, 'error', SQLERRM);
        END;
        $$;
      `
    });
  } catch (err) {
    // Function might already exist
  }
}

evaluateDatabase().catch(console.error);