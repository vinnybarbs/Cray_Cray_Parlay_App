require('dotenv').config({ path: '.env.local' });
const { AIFunctions } = require('./lib/services/ai-functions');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  const aiFunctions = new AIFunctions(supabase);
  
  console.log('\n🧪 Testing new team lookup...\n');
  
  const teams = ['Denver Broncos', 'Washington Commanders', 'Kansas City Chiefs'];
  
  for (const team of teams) {
    const result = await aiFunctions.getTeamStats(team, 3);
    console.log(`\n${team}:`);
    console.log(JSON.stringify(result, null, 2).substring(0, 300));
  }
}

test().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
