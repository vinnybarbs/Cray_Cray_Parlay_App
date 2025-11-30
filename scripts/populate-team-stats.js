/**
 * Initial population of API-Sports team statistics
 * Run this once to get baseline team stats for the season
 * 
 * Usage: node scripts/populate-team-stats.js
 * 
 * API Calls: ~34 (one per team)
 */

require('dotenv').config();
const ApiSportsSync = require('../lib/services/apisports-sync');

async function populate() {
  console.log('📊 API-Sports Team Stats Population');
  console.log('=====================================\n');

  const sync = new ApiSportsSync();
  const season = 2025; // Current season

  try {
    // Sync recent game stats (last 2 weeks - team + player stats)
    console.log('Step 1: Syncing recent game stats (last 2 weeks - team + player)...');
    const stats = await sync.syncRecentGameStats(2, season, 1); // 2 weeks, season, league
    console.log(`✅ Team game stats: ${stats.teamGames}`);
    console.log(`✅ Player game stats: ${stats.playerGames}\n`);

    // Summary
    console.log('\n🎉 Game Stats Population Complete!');
    console.log('================================');
    console.log(`Team game stats: ${stats.teamGames}`);
    console.log(`Player game stats: ${stats.playerGames}`);
    console.log(`Total: ${stats.teamGames + stats.playerGames} stat records`);
    console.log(`API Calls Used: ${sync.apiClient.callCount}/100`);
    console.log(`Remaining Today: ${sync.apiClient.getRemainingCalls()}`);
    
    console.log('\n📊 Your team stats are now populated!');
    console.log('\nNext steps:');
    console.log('1. Run weekly: POST /api/sync-apisports?type=weekly');
    console.log('2. View stats: SELECT * FROM team_stats_detailed WHERE season = 2025;');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Population failed:', error.message);
    console.error('\nMake sure:');
    console.error('1. APISPORTS_API_KEY is set in .env');
    console.error('2. Database schema has been created');
    console.error('3. Teams have been synced first');
    process.exit(1);
  }
}

populate();
