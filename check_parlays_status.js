require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('📊 Checking parlays table for final_outcome & status...\n');

  const { data, error } = await supabase
    .from('parlays')
    .select('id, created_at, status, final_outcome, hit_percentage, profit_loss')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  data.forEach(p => {
    console.log(`Parlay ${p.id}`);
    console.log(`  created_at:   ${p.created_at}`);
    console.log(`  status:       ${p.status}`);
    console.log(`  final_outcome:${p.final_outcome}`);
    console.log(`  hit%:         ${p.hit_percentage}`);
    console.log(`  profit_loss:  ${p.profit_loss}`);
    console.log('');
  });
}

check().then(() => process.exit(0));
