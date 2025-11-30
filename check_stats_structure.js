require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data } = await supabase
    .from('team_stats_season')
    .select('*')
    .limit(1)
    .single();
    
  console.log('\n📊 team_stats_season structure:');
  console.log('Columns:', Object.keys(data || {}).join(', '));
  console.log('\nSample row:', JSON.stringify(data, null, 2).substring(0, 800));
  
  // Get a Denver Broncos stat
  const { data: broncos } = await supabase
    .from('team_stats_season')
    .select('*')
    .eq('team_id', 'd6d4a434-c58b-45e3-b097-eb7fa929db0a')
    .single();
    
  if (broncos && broncos.metrics) {
    console.log('\n🏈 Team with id d6d4a434...:', broncos.metrics.teamName || 'NO NAME IN METRICS');
  }
}

check().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
