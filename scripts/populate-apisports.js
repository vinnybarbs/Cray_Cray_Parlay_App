/**
 * Initial API-Sports Data Population Script
 * Run this once to populate your database with current NFL data
 * 
 * Usage: node scripts/populate-apisports.js
 */

require('dotenv').config();
const ApiSportsSync = require('../lib/services/apisports-sync');

async function populate() {
  console.log('🏈 API-Sports Initial Data Population');
  console.log('=====================================\n');

  const sync = new ApiSportsSync();
  const season = 2025; // Use 2025 season (current season)

  try {
    // Step 1: Sync Teams
    console.log('Step 1: Syncing NFL Teams...');
    const teams = await sync.syncTeams(season, 1); // season, league (1 = NFL)
    console.log(`✅ Synced ${teams.synced} teams\n`);

    // Step 2: Sync Standings  
    console.log('Step 2: Syncing Current Standings...');
    const standings = await sync.syncStandings(season);
    console.log(`✅ Synced ${standings.synced} team standings\n`);

    // Step 3: Sync Injuries (CRITICAL) - uses current data, no season needed
    console.log('Step 3: Syncing Current Injuries...');
    const injuries = await sync.syncInjuries();
    console.log(`✅ Synced ${injuries.synced} injury reports\n`);

    // Summary
    console.log('\n🎉 Initial Population Complete!');
    console.log('================================');
    console.log(`Teams: ${teams.synced}`);
    console.log(`Standings: ${standings.synced}`);
    console.log(`Injuries: ${injuries.synced}`);
    console.log(`API Calls Used: ${sync.apiClient.callCount}/100`);
    console.log(`Remaining Today: ${sync.apiClient.getRemainingCalls()}`);
    
    console.log('\n📊 Your database is now populated!');
    console.log('\nNext steps:');
    console.log('1. Set up daily sync: POST /api/sync-apisports');
    console.log('2. Generate picks: AI will now use real stats!');
    console.log('3. View data: SELECT * FROM current_injuries_by_team;');

  } catch (error) {
    console.error('\n❌ Population failed:', error);
    console.error('Make sure:');
    console.error('1. APISPORTS_API_KEY is set in .env');
    console.error('2. Database schema has been created');
    console.error('3. Supabase credentials are correct');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  populate();
}

module.exports = populate;
