#!/usr/bin/env node

const PlayerRosterPopulator = require('./populate-rosters-from-api');

async function main() {
  const populator = new PlayerRosterPopulator();

  console.log('🚀 Real Player Roster Population Test\n');

  try {
    // Step 1: Test API connectivity
    console.log('Step 1: Testing API connectivity...');
    const connectivity = await populator.testApiConnectivity();
    console.log('\n');

    // Step 2: Check current roster status
    console.log('Step 2: Current roster summary...');
    const currentSummary = await populator.getRosterSummary();
    console.log('\n');

    // Step 3: Populate rosters (starting with a few teams)
    console.log('Step 3: Populating real player rosters...');
    const results = await populator.populateAllRosters();

    console.log('\n🎯 Final Results:');
    console.log('================');
    console.log(`Total Teams Processed: ${results.total_teams}`);
    console.log(`Total Players Added: ${results.total_players}`);
    console.log(`Sports Completed: ${results.sports_completed}`);
    
    if (results.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      results.errors.forEach(error => console.log(`  - ${error}`));
    }

    // Step 4: Updated roster summary
    console.log('\nStep 4: Updated roster summary...');
    const updatedSummary = await populator.getRosterSummary();

    console.log('\n✅ Player roster population completed!');
    console.log('🎯 Next: Update suggest-picks to use real cached player data');

  } catch (error) {
    console.error('❌ Error during roster population:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = main;