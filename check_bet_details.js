require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data: legs } = await supabase
    .from('parlay_legs')
    .select('*')
    .eq('outcome', 'pending')
    .limit(3);
    
  console.log('📊 Leg bet_details structure:\n');
  
  legs.forEach((leg, i) => {
    console.log(`Leg ${i+1}: ${leg.pick}`);
    console.log(`  leg.point: ${leg.point}`);
    console.log(`  leg.bet_details: ${JSON.stringify(leg.bet_details)}`);
    console.log(`  leg.bet_details?.point: ${leg.bet_details?.point}`);
    console.log('');
  });
}

check().then(() => process.exit(0));
