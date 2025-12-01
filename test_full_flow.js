require('dotenv').config({ path: '.env.local' });
const ParlayOutcomeChecker = require('./lib/services/parlay-outcome-checker');

async function test() {
  console.log('🧪 Testing full outcome checker flow...\n');
  
  const checker = new ParlayOutcomeChecker();
  
  // Test the full flow
  const result = await checker.checkAllPendingParlays();
  
  console.log('\n📊 Result:');
  console.log(`  Checked: ${result.checked}`);
  console.log(`  Updated: ${result.updated}`);
  
  if (result.updated === 0) {
    console.log('\n❌ Still 0 updates. Checking logs above for errors...');
  } else {
    console.log('\n✅ SUCCESS! Legs were updated!');
  }
}

test().then(() => process.exit(0)).catch(err => {
  console.error('\n💥 Error:', err);
  process.exit(1);
});
