#!/usr/bin/env node
/**
 * Check database status - odds cache, cron jobs, and data population
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

async function checkDatabase() {
  console.log('\n🔍 Database Status Check\n');
  console.log('=' .repeat(60));
  
  try {
    // Check odds_cache table
    console.log('\n📊 Checking odds_cache table...');
    const { data: oddsData, error: oddsError } = await supabase
      .from('odds_cache')
      .select('*', { count: 'exact' })
      .limit(5);
    
    if (oddsError) {
      console.log('❌ Error accessing odds_cache:', oddsError.message);
    } else {
      console.log(`✅ odds_cache exists with ${oddsData?.length || 0} rows (showing first 5)`);
      if (oddsData && oddsData.length > 0) {
        console.log('📝 Sample data:');
        oddsData.forEach((row, i) => {
          console.log(`   ${i+1}. ${row.sport} - ${row.home_team} vs ${row.away_team} (${row.commence_time})`);
        });
      }
    }

    // Check cron jobs status
    console.log('\n⏰ Checking cron jobs...');
    const { data: cronData, error: cronError } = await supabase
      .from('cron.job')
      .select('*');
    
    if (cronError) {
      console.log('❌ Error accessing cron jobs:', cronError.message);
    } else {
      console.log(`✅ Found ${cronData?.length || 0} cron jobs`);
      if (cronData && cronData.length > 0) {
        cronData.forEach(job => {
          console.log(`   • ${job.jobname} - Active: ${job.active} - Schedule: ${job.schedule}`);
        });
      }
    }

    // Check recent cron history
    console.log('\n📜 Checking recent cron history...');
    const { data: historyData, error: historyError } = await supabase
      .from('cron.job_run_details')
      .select('*')
      .order('start_time', { ascending: false })
      .limit(10);
    
    if (historyError) {
      console.log('❌ Error accessing cron history:', historyError.message);
    } else {
      console.log(`✅ Found ${historyData?.length || 0} recent cron runs`);
      if (historyData && historyData.length > 0) {
        historyData.forEach(run => {
          const status = run.status || 'unknown';
          const startTime = new Date(run.start_time).toLocaleString();
          console.log(`   • ${run.jobname} - ${status} at ${startTime}`);
        });
      }
    }

    // Check sports_cache table (if exists)
    console.log('\n🏈 Checking sports_cache table...');
    const { data: sportsData, error: sportsError } = await supabase
      .from('sports_cache')
      .select('*', { count: 'exact' })
      .limit(5);
    
    if (sportsError) {
      console.log('❌ sports_cache table not accessible:', sportsError.message);
    } else {
      console.log(`✅ sports_cache exists with ${sportsData?.length || 0} rows`);
    }

    // Check user_parlays table
    console.log('\n🎰 Checking user_parlays table...');
    const { data: parlayData, error: parlayError } = await supabase
      .from('user_parlays')
      .select('*', { count: 'exact' })
      .limit(3);
    
    if (parlayError) {
      console.log('❌ Error accessing user_parlays:', parlayError.message);
    } else {
      console.log(`✅ user_parlays exists with ${parlayData?.length || 0} rows`);
    }

  } catch (error) {
    console.log('❌ Database check failed:', error.message);
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('🏁 Database check complete\n');
}

checkDatabase();