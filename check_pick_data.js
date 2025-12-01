require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data } = await supabase
    .from('parlay_legs')
    .select('pick, point, bet_details')
    .eq('outcome', 'pending')
    .limit(1)
    .single();
    
  console.log('Pick:', data.pick);
  console.log('point field:', data.point);
  console.log('bet_details:', JSON.stringify(data.bet_details, null, 2));
}

check().then(() => process.exit(0));
