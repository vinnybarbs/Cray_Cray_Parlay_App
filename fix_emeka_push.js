require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fix() {
  console.log('🔧 Fixing Emeka Egbuka Under 4.5 Receptions marked as PUSH...\n');

  // 1) Show affected parlay_legs
  const { data: legsBefore, error: legsErr } = await supabase
    .from('parlay_legs')
    .select('id, parlay_id, pick, outcome')
    .ilike('pick', '%Emeka Egbuka%')
    .eq('outcome', 'push');

  if (legsErr) {
    console.error('❌ Error loading legs:', legsErr.message);
  } else {
    console.log(`parlay_legs PUSH rows before: ${legsBefore?.length || 0}`);
    legsBefore?.forEach(l => {
      console.log(`  leg ${l.id} (parlay ${l.parlay_id}): ${l.pick} → outcome=${l.outcome}`);
    });
  }

  // 2) Update parlay_legs PUSH → WON
  const { error: legsUpdateErr } = await supabase
    .from('parlay_legs')
    .update({ outcome: 'won' })
    .ilike('pick', '%Emeka Egbuka%')
    .eq('outcome', 'push');

  if (legsUpdateErr) {
    console.error('❌ Error updating legs:', legsUpdateErr.message);
  } else {
    console.log('\n✅ Updated parlay_legs: push → won for Emeka rows');
  }

  // 3) Fix ai_suggestions actual_outcome as well (for model success rate)
  const { data: suggBefore, error: suggErr } = await supabase
    .from('ai_suggestions')
    .select('id, pick, actual_outcome')
    .ilike('pick', '%Emeka Egbuka%')
    .eq('actual_outcome', 'push');

  if (suggErr) {
    console.error('❌ Error loading ai_suggestions:', suggErr.message);
  } else {
    console.log(`\nai_suggestions PUSH rows before: ${suggBefore?.length || 0}`);
    suggBefore?.forEach(s => {
      console.log(`  suggestion ${s.id}: ${s.pick} → actual_outcome=${s.actual_outcome}`);
    });
  }

  const { error: suggUpdateErr } = await supabase
    .from('ai_suggestions')
    .update({ actual_outcome: 'won' })
    .ilike('pick', '%Emeka Egbuka%')
    .eq('actual_outcome', 'push');

  if (suggUpdateErr) {
    console.error('❌ Error updating ai_suggestions:', suggUpdateErr.message);
  } else {
    console.log('\n✅ Updated ai_suggestions: push → won for Emeka rows');
  }

  // 4) Show final state summary
  const { data: legsAfter } = await supabase
    .from('parlay_legs')
    .select('id, parlay_id, pick, outcome')
    .ilike('pick', '%Emeka Egbuka%');

  console.log('\n📊 Final parlay_legs for Emeka:');
  legsAfter?.forEach(l => {
    console.log(`  leg ${l.id}: outcome=${l.outcome}`);
  });

  const { data: suggAfter } = await supabase
    .from('ai_suggestions')
    .select('id, pick, actual_outcome')
    .ilike('pick', '%Emeka Egbuka%');

  console.log('\n📊 Final ai_suggestions for Emeka:');
  suggAfter?.forEach(s => {
    console.log(`  suggestion ${s.id}: actual_outcome=${s.actual_outcome}`);
  });
}

fix().then(() => process.exit(0));
