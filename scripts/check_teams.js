#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTeams() {
  console.log('\n🔍 Checking teams table...\n');

  // Get all teams
  const { data: allTeams, error } = await supabase
    .from('teams')
    .select('*')
    .limit(10);

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  if (!allTeams || allTeams.length === 0) {
    console.log('⚠️  Teams table is EMPTY');
    return;
  }

  console.log(`✅ Found ${allTeams.length} teams (showing first 10):\n`);
  
  allTeams.forEach(team => {
    console.log(`  - ${team.name || 'N/A'}`);
    console.log(`    ID: ${team.id}`);
    console.log(`    League: ${team.league || 'NULL'}`);
    console.log(`    API-Sports ID: ${team.api_sports_id || team.external_id || 'NULL'}`);
    console.log('');
  });

  // Check for NFL teams specifically
  const { data: nflTeams } = await supabase
    .from('teams')
    .select('*')
    .eq('league', 'nfl');

  console.log(`\n📊 Teams with league='nfl': ${nflTeams?.length || 0}`);

  // Check for teams with different league values
  const { data: allWithLeague } = await supabase
    .from('teams')
    .select('league')
    .not('league', 'is', null);

  if (allWithLeague && allWithLeague.length > 0) {
    const leagues = new Set(allWithLeague.map(t => t.league));
    console.log(`📋 Unique league values: ${Array.from(leagues).join(', ')}`);
  }
}

checkTeams().catch(console.error);
