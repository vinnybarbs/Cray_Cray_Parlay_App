/**
 * ONE-TIME backfill of all game/player stats for 2025 season
 * Run this once to populate all games up to current week
 * 
 * Usage: node scripts/backfill-season-stats.js
 * 
 * API Calls: ~13 weeks + (16 games/week × 2 stats) = ~429 calls
 * With 7500/day limit, this is no problem!
 */

require('dotenv').config();
const ApiSportsSync = require('../lib/services/apisports-sync');

async function backfill() {
  console.log('🏈 API-Sports Season Backfill (2025)');
  console.log('======================================\n');
  console.log('This will load ALL games from week 1 through current week');
  console.log('Including team stats + player stats for every game\n');

  const sync = new ApiSportsSync();
  const season = 2025;
  const currentWeek = 13; // Update this to current NFL week

  try {
    console.log(`📊 Backfilling weeks 1-${currentWeek}...`);
    console.log('This may take a few minutes...\n');

    // Sync ALL weeks from 1 to current
    const stats = await sync.syncRecentGameStats(currentWeek, season, 1);
    
    console.log('\n✅ Backfill complete!');
    console.log(`Team game stats: ${stats.teamGames}`);
    console.log(`Player game stats: ${stats.playerGames}`);
    console.log(`Total stat records: ${stats.teamGames + stats.playerGames}`);

    // Summary
    console.log('\n🎉 Season Backfill Complete!');
    console.log('================================');
    console.log(`API Calls Used: ${sync.apiClient.callCount}/7500`);
    console.log(`Remaining Today: ${sync.apiClient.getRemainingCalls()}`);
    
    console.log('\n📊 Your entire 2025 season is now in the database!');
    console.log('\nNext steps:');
    console.log('1. Set up weekly cron to keep data fresh');
    console.log('2. Query: SELECT * FROM team_stats_detailed WHERE season = 2025;');
    console.log('3. Query: SELECT * FROM player_game_stats LIMIT 100;');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Backfill failed:', error.message);
    console.error('\nNote:');
    console.error('- Check APISPORTS_API_KEY in .env');
    console.error('- Ensure database schema is created');
    console.error('- Teams must be synced first');
    console.error(`- API Calls Used: ${sync.apiClient.callCount}/7500`);
    process.exit(1);
  }
}

backfill();
