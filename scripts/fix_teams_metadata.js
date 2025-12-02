#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// API-Sports NFL team ID mapping (from their API)
const NFL_TEAM_IDS = {
  'Arizona Cardinals': 1,
  'Atlanta Falcons': 2,
  'Baltimore Ravens': 3,
  'Buffalo Bills': 4,
  'Carolina Panthers': 5,
  'Chicago Bears': 6,
  'Cincinnati Bengals': 7,
  'Cleveland Browns': 8,
  'Dallas Cowboys': 9,
  'Denver Broncos': 10,
  'Detroit Lions': 11,
  'Green Bay Packers': 12,
  'Houston Texans': 13,
  'Indianapolis Colts': 14,
  'Jacksonville Jaguars': 15,
  'Kansas City Chiefs': 16,
  'Las Vegas Raiders': 17,
  'Los Angeles Chargers': 18,
  'Los Angeles Rams': 19,
  'Miami Dolphins': 20,
  'Minnesota Vikings': 21,
  'New England Patriots': 22,
  'New Orleans Saints': 23,
  'New York Giants': 24,
  'New York Jets': 25,
  'Philadelphia Eagles': 26,
  'Pittsburgh Steelers': 27,
  'San Francisco 49ers': 28,
  'Seattle Seahawks': 29,
  'Tampa Bay Buccaneers': 30,
  'Tennessee Titans': 31,
  'Washington Commanders': 32
};

async function fixTeamsMetadata() {
  console.log('\n🔧 Fixing teams table metadata...\n');

  // Get all teams
  const { data: teams, error } = await supabase
    .from('teams')
    .select('*');

  if (error) {
    console.error('❌ Error fetching teams:', error.message);
    return;
  }

  if (!teams || teams.length === 0) {
    console.log('⚠️  No teams found');
    return;
  }

  console.log(`✓ Found ${teams.length} teams to update\n`);

  let updated = 0;
  let notFound = 0;

  for (const team of teams) {
    const apiSportsId = NFL_TEAM_IDS[team.name];

    if (!apiSportsId) {
      console.log(`  ⚠️  No API-Sports ID found for: ${team.name}`);
      notFound++;
      continue;
    }

    // Update team with league and api_sports_id
    const { error: updateError } = await supabase
      .from('teams')
      .update({
        league: 'nfl',
        api_sports_id: apiSportsId
      })
      .eq('id', team.id);

    if (updateError) {
      console.error(`  ❌ Error updating ${team.name}:`, updateError.message);
    } else {
      console.log(`  ✅ ${team.name} → league='nfl', api_sports_id=${apiSportsId}`);
      updated++;
    }
  }

  console.log(`\n📊 Update complete:`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Not found: ${notFound}`);
  console.log(`\n✅ Teams table is now ready for roster sync!`);
}

fixTeamsMetadata().catch(console.error);
