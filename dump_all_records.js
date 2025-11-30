require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function dump() {
  const { data } = await supabase
    .from('team_stats_season')
    .select('*')
    .eq('season', 2025);
    
  console.log('\n📋 ALL TEAM RECORDS IN DB:\n');
  data.forEach(stat => {
    const m = stat.metrics;
    console.log(`${m.wins}-${m.losses} (${m.win_pct.toFixed(2)})`);
  });
}

dump().then(() => process.exit(0));
