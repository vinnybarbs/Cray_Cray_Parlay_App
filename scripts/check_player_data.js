#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('\n📊 CHECKING PLAYER DATA TABLES\n');

  // Check player_game_stats
  const { data: gameStats, error: gameError } = await supabase
    .from('player_game_stats')
    .select('*')
    .limit(5);

  console.log('1️⃣ player_game_stats table:');
  if (gameError) {
    console.error('  ❌ Error:', gameError.message);
  } else if (!gameStats || gameStats.length === 0) {
    console.log('  ⚠️  EMPTY - No game stats for any player');
  } else {
    console.log(`  ✅ Has ${gameStats.length} records (sample):`);
    gameStats.forEach(g => {
      console.log(`    - ${g.player_name || 'N/A'}: ${g.game_date}, ${g.receptions || 0} rec, ${g.receiving_yards || 0} yds`);
    });
  }

  // Check if Tyrone Tracy Jr specifically exists
  console.log('\n2️⃣ Searching for Tyrone Tracy Jr:');
  const { data: tracy, error: tracyError } = await supabase
    .from('player_game_stats')
    .select('*')
    .ilike('player_name', '%Tracy%')
    .limit(3);

  if (!tracy || tracy.length === 0) {
    console.log('  ❌ Tyrone Tracy Jr NOT FOUND in player_game_stats');
  } else {
    console.log(`  ✅ Found ${tracy.length} records for Tracy:`);
    tracy.forEach(g => {
      console.log(`    - ${g.player_name}: ${g.game_date}, ${g.receptions} rec, ${g.receiving_yards} yds`);
    });
  }

  // Check players table
  console.log('\n3️⃣ Checking players table:');
  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('*')
    .limit(5);

  if (playersError) {
    console.error('  ❌ Error:', playersError.message);
  } else if (!players || players.length === 0) {
    console.log('  ⚠️  EMPTY - No players in database');
  } else {
    console.log(`  ✅ Has ${players.length} records (sample):`);
    players.forEach(p => {
      console.log(`    - ${p.name} (${p.position || 'N/A'})`);
    });
  }

  console.log('\n✅ DONE\n');
}

check().catch(console.error);
