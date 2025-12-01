#!/usr/bin/env node

/**
 * Diagnose why team_stats_season is empty or not matching
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function diagnose() {
  console.log('\n📊 DIAGNOSING TEAM STATS DATA\n');
  console.log('='.repeat(80));

  // 1. Check team_stats_season table
  console.log('\n1️⃣ Checking team_stats_season table:');
  const { data: seasonStats, error: seasonError } = await supabase
    .from('team_stats_season')
    .select('*')
    .eq('season', 2025)
    .limit(5);

  if (seasonError) {
    console.error('❌ Error querying team_stats_season:', seasonError.message);
  } else if (!seasonStats || seasonStats.length === 0) {
    console.log('⚠️  team_stats_season is EMPTY for 2025 season');
  } else {
    console.log(`✅ Found ${seasonStats.length} records (showing first 5):`);
    seasonStats.forEach(s => {
      console.log(`  - ${s.team_name || s.team_id}: ${JSON.stringify(s.metrics || {}).slice(0, 100)}...`);
    });
  }

  // 2. Check standings table
  console.log('\n2️⃣ Checking standings table:');
  const { data: standings, error: standingsError } = await supabase
    .from('standings')
    .select('*')
    .eq('season', 2025)
    .limit(5);

  if (standingsError) {
    console.error('❌ Error querying standings:', standingsError.message);
  } else if (!standings || standings.length === 0) {
    console.log('⚠️  standings table is EMPTY for 2025 season');
  } else {
    console.log(`✅ Found ${standings.length} records (showing first 5):`);
    standings.forEach(s => {
      console.log(`  - Team ID: ${s.team_id}, W-L: ${s.wins}-${s.losses}`);
    });
  }

  // 3. Check current_standings view
  console.log('\n3️⃣ Checking current_standings view:');
  const { data: currentStandings, error: currentError } = await supabase
    .from('current_standings')
    .select('*')
    .limit(5);

  if (currentError) {
    console.error('❌ Error querying current_standings:', currentError.message);
  } else if (!currentStandings || currentStandings.length === 0) {
    console.log('⚠️  current_standings view is EMPTY');
  } else {
    console.log(`✅ Found ${currentStandings.length} records (showing first 5):`);
    currentStandings.forEach(s => {
      console.log(`  - ${s.team_name}: ${s.wins}-${s.losses} (${s.conference})`);
    });
  }

  // 4. Check teams table
  console.log('\n4️⃣ Checking teams table:');
  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('*')
    .limit(5);

  if (teamsError) {
    console.error('❌ Error querying teams:', teamsError.message);
  } else if (!teams || teams.length === 0) {
    console.log('⚠️  teams table is EMPTY');
  } else {
    console.log(`✅ Found ${teams.length} records (showing first 5):`);
    teams.forEach(t => {
      console.log(`  - ${t.name} (${t.league})`);
    });
  }

  // 5. Check player_season_stats
  console.log('\n5️⃣ Checking player_season_stats table:');
  const { data: playerStats, error: playerError } = await supabase
    .from('player_season_stats')
    .select('*')
    .eq('season', 2025)
    .limit(5);

  if (playerError) {
    console.error('❌ Error querying player_season_stats:', playerError.message);
  } else if (!playerStats || playerStats.length === 0) {
    console.log('⚠️  player_season_stats is EMPTY for 2025 season');
  } else {
    console.log(`✅ Found ${playerStats.length} records (showing first 5):`);
    playerStats.forEach(p => {
      console.log(`  - Player ID: ${p.player_id}, Stats: ${JSON.stringify(p.stats || {}).slice(0, 80)}...`);
    });
  }

  // 6. Try to match Patriots and Giants specifically
  console.log('\n6️⃣ Searching for Patriots and Giants specifically:');
  
  const { data: patriotsStanding } = await supabase
    .from('current_standings')
    .select('*')
    .ilike('team_name', '%Patriots%')
    .maybeSingle();
  
  const { data: giantsStanding } = await supabase
    .from('current_standings')
    .select('*')
    .ilike('team_name', '%Giants%')
    .maybeSingle();

  console.log('  Patriots in current_standings:', patriotsStanding ? `${patriotsStanding.team_name} ${patriotsStanding.wins}-${patriotsStanding.losses}` : 'NOT FOUND');
  console.log('  Giants in current_standings:', giantsStanding ? `${giantsStanding.team_name} ${giantsStanding.wins}-${giantsStanding.losses}` : 'NOT FOUND');

  console.log('\n='.repeat(80));
  console.log('✅ DIAGNOSIS COMPLETE\n');
}

diagnose().catch(console.error);
