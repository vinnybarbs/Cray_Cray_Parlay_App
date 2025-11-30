#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ quiet: true });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkParlayPicks() {
  console.log('🔍 Checking how picks are linked to parlays...\n');

  // Get one pending parlay
  const { data: parlays } = await supabase
    .from('parlays')
    .select('id, created_at, total_legs, status')
    .eq('status', 'pending')
    .limit(1);

  if (!parlays || parlays.length === 0) {
    console.log('No pending parlays found');
    return;
  }

  const parlay = parlays[0];
  console.log('📦 Sample Parlay:', parlay);

  // Check if ai_suggestions has picks for this parlay
  const { data: picks, error } = await supabase
    .from('ai_suggestions')
    .select('*')
    .eq('parlay_id', parlay.id);

  console.log(`\n🎯 Picks for this parlay:`);
  if (error) {
    console.log('❌ Error:', error.message);
  } else if (!picks || picks.length === 0) {
    console.log('❌ NO PICKS FOUND! parlay_id is not set in ai_suggestions');
    console.log('   This parlay has no linked picks in the database!');
  } else {
    console.log(`✅ Found ${picks.length} picks (expected ${parlay.total_legs}):`);
    picks.forEach((pick, i) => {
      console.log(`\n   Pick ${i + 1}:`);
      console.log(`   - Game: ${pick.away_team} @ ${pick.home_team}`);
      console.log(`   - Pick: ${pick.pick} (${pick.bet_type})`);
      console.log(`   - Odds: ${pick.odds}`);
      console.log(`   - Game Date: ${pick.game_date}`);
      console.log(`   - Status: ${pick.actual_outcome}`);
      console.log(`   - Resolved: ${pick.resolved_at || 'No'}`);
    });
  }

  // Check how many pending parlays have NO picks
  const { data: allPending } = await supabase
    .from('parlays')
    .select('id, total_legs')
    .eq('status', 'pending');

  let parlaysWithPicks = 0;
  let parlaysWithoutPicks = 0;

  for (const p of allPending) {
    const { data: picks } = await supabase
      .from('ai_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('parlay_id', p.id);

    if (picks && picks.length > 0) {
      parlaysWithPicks++;
    } else {
      parlaysWithoutPicks++;
    }
  }

  console.log(`\n📊 Summary of ${allPending.length} pending parlays:`);
  console.log(`   ✅ With picks in ai_suggestions: ${parlaysWithPicks}`);
  console.log(`   ❌ Without picks: ${parlaysWithoutPicks}`);

  if (parlaysWithoutPicks > 0) {
    console.log('\n⚠️  PROBLEM: Parlays have no picks stored in database!');
    console.log('   This means they cannot be settled automatically.');
  }
}

checkParlayPicks();
