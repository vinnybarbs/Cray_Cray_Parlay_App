#!/usr/bin/env node
// Quick script to check and fix pg_net extension via API
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAndFixPgNet() {
  console.log('🔍 Checking pg_net extension status...');
  
  try {
    // Check if pg_net extension exists
    const { data: extensions, error: checkError } = await supabase
      .from('pg_extension')
      .select('extname, extversion')
      .eq('extname', 'pg_net');
      
    if (checkError) {
      console.log('⚠️ Could not check extensions via table, trying direct query...');
      
      // Try direct SQL query
      const { data, error } = await supabase.rpc('exec_sql', {
        sql: "SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_net'"
      });
      
      if (error) {
        console.error('❌ Cannot check pg_net status:', error.message);
        console.log('\n🔧 MANUAL FIX REQUIRED:');
        console.log('1. Go to Supabase Dashboard → SQL Editor');
        console.log('2. Run: CREATE EXTENSION IF NOT EXISTS pg_net;');
        console.log('3. Verify with: SELECT extname FROM pg_extension WHERE extname = \'pg_net\';');
        return;
      }
    }
    
    if (!extensions || extensions.length === 0) {
      console.log('❌ pg_net extension not found - this explains the cron failures!');
      console.log('\n🔧 MANUAL FIX REQUIRED:');
      console.log('1. Go to: https://supabase.com/dashboard/project/pcjhulzyqmhrhsrgvwvx/sql');
      console.log('2. Run this SQL:');
      console.log('   CREATE EXTENSION IF NOT EXISTS pg_net;');
      console.log('3. Verify with:');
      console.log('   SELECT extname, extversion FROM pg_extension WHERE extname = \'pg_net\';');
    } else {
      console.log('✅ pg_net extension found:', extensions[0]);
      console.log('🤔 Extension exists but cron jobs still failing - checking jobs...');
      
      // Check recent cron job status
      const { data: cronJobs, error: cronError } = await supabase
        .from('cron_job_run_details')
        .select('*')
        .order('start_time', { ascending: false })
        .limit(5);
        
      if (cronJobs) {
        console.log('\n📋 Recent cron job status:');
        cronJobs.forEach(job => {
          const status = job.status === 'succeeded' ? '✅' : '❌';
          console.log(`${status} ${job.jobname}: ${job.status} (${job.start_time})`);
          if (job.status === 'failed') {
            console.log(`   Error: ${job.message}`);
          }
        });
      }
    }
    
  } catch (err) {
    console.error('❌ Error checking pg_net:', err.message);
    console.log('\n🔧 MANUAL FIX - Go to Supabase Dashboard and run:');
    console.log('CREATE EXTENSION IF NOT EXISTS pg_net;');
  }
}

checkAndFixPgNet().then(() => {
  console.log('\n🎯 Summary: pg_net extension is required for cron jobs to call Edge Functions');
  console.log('Without it, all refresh-odds and refresh-intelligence jobs will fail.');
});