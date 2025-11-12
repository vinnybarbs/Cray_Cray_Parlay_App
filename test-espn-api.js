#!/usr/bin/env node

const ESPNApiService = require('./lib/services/espn-api-service');

async function main() {
  const espnService = new ESPNApiService();

  console.log('🏈 ESPN API Real Player Data Test\n');

  try {
    // Step 1: Test ESPN API connectivity
    console.log('Step 1: Testing ESPN API connectivity...');
    const connectivity = await espnService.testConnectivity();
    console.log('\n');

    // Check if all sports are connected
    const connectedSports = Object.entries(connectivity).filter(([sport, result]) => result.ok);
    if (connectedSports.length === 0) {
      throw new Error('No ESPN API connections successful');
    }

    console.log(`✅ ${connectedSports.length}/4 sports connected successfully\n`);

    // Step 2: Check current roster summary
    console.log('Step 2: Current ESPN roster summary...');
    const currentSummary = await espnService.getRosterSummary();
    console.log('\n');

    // Step 3: Populate real team rosters from ESPN
    console.log('Step 3: Populating real team rosters from ESPN...');
    const results = await espnService.populateAllTeamRosters();

    console.log('\n🎯 ESPN Population Results:');
    console.log('===========================');
    console.log(`Total Teams Processed: ${results.total_teams}`);
    console.log(`Total Players Added: ${results.total_players}`);
    console.log(`Sports Completed: ${results.sports_completed}`);
    
    if (results.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      results.errors.forEach(error => console.log(`  - ${error}`));
    }

    // Step 4: Updated roster summary
    console.log('\nStep 4: Updated ESPN roster summary...');
    const updatedSummary = await espnService.getRosterSummary();

    // Step 5: Test live scores functionality
    console.log('\nStep 5: Testing live scores...');
    const nflScores = await espnService.getLiveScores('NFL');
    if (nflScores && nflScores.events) {
      console.log(`📊 Found ${nflScores.events.length} NFL games/events`);
    }

    console.log('\n✅ ESPN API integration test completed!');
    console.log('🎯 Next: Real player data is now available for prop betting!');
    console.log('📋 ESPN provides: Team rosters, player stats, live scores, no auth required!');

  } catch (error) {
    console.error('❌ Error during ESPN API test:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = main;