#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pcjhulzyqmhrhsrgvwvx.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkCronStatus() {
  console.log('🔍 Checking cron job status...\n');
  
  try {
    // Check current cron jobs
    const { data: jobs, error: jobsError } = await supabase
      .from('cron.job')
      .select('jobname, schedule, active, database')
      .order('jobname');
    
    if (jobsError) {
      console.error('Error fetching jobs:', jobsError);
    } else {
      console.log('📋 Current cron jobs:');
      console.table(jobs);
    }
    
    // Check recent cron job runs
    const { data: runs, error: runsError } = await supabase.rpc('sql', {
      query: `
        SELECT 
          jobname,
          start_time,
          end_time,
          return_message,
          status
        FROM cron.job_run_details 
        WHERE start_time > now() - interval '4 hours'
        ORDER BY start_time DESC 
        LIMIT 10
      `
    });
    
    if (runsError) {
      console.error('Error fetching job runs:', runsError);
    } else {
      console.log('\n📊 Recent cron job executions (last 4 hours):');
      console.table(runs);
    }
    
    // Check odds cache freshness
    const { data: oddsData, error: oddsError } = await supabase
      .from('odds_cache')
      .select('last_updated')
      .order('last_updated', { ascending: false })
      .limit(1);
    
    if (oddsError) {
      console.error('Error fetching odds data:', oddsError);
    } else if (oddsData && oddsData.length > 0) {
      const lastUpdate = new Date(oddsData[0].last_updated);
      const now = new Date();
      const hoursOld = (now - lastUpdate) / (1000 * 60 * 60);
      
      console.log(`\n📈 Odds data last updated: ${lastUpdate.toISOString()}`);
      console.log(`⏰ Data age: ${hoursOld.toFixed(1)} hours old`);
      
      if (hoursOld > 2) {
        console.log('⚠️  Odds data is stale (> 2 hours old)');
      } else {
        console.log('✅ Odds data is reasonably fresh');
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkCronStatus();
