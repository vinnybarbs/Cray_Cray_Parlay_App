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
    .eq('season', 2025)
    .limit(1)
    .single();
    
  console.log('\n📋 Sample raw_stats array:\n');
  const raw = data.metrics.raw_stats || [];
  raw.slice(0, 20).forEach(s => {
    console.log(`  ${s.name} (${s.type}): ${s.value}`);
  });
  
  // Check if teamName exists
  const teamName = raw.find(s => s.name.toLowerCase().includes('team'));
  console.log('\n🔍 Team name stat:', teamName);
}

dump().then(() => process.exit(0));
