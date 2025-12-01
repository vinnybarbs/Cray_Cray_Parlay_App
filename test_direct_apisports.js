require('dotenv').config({ path: '.env.local' });
const ApiSportsClient = require('./lib/services/apisports-client');

async function test() {
  const client = new ApiSportsClient();
  
  console.log('🏈 Testing API-Sports for Nov 30, 2025...\n');
  
  // Test 1: Get games for today
  try {
    const games = await client.getGamesByDate('2025-11-30', 1);
    console.log(`✅ Found ${games.response?.length || 0} games\n`);
    
    if (games.response && games.response.length > 0) {
      const game = games.response[0];
      console.log(`Sample game: ${game.teams.away.name} @ ${game.teams.home.name}`);
      console.log(`  Score: ${game.scores.away.total}-${game.scores.home.total}`);
      console.log(`  Status: ${game.game.status.long}`);
      console.log(`  Game ID: ${game.game.id}\n`);
      
      // Test 2: Get player stats for that game
      const gameId = game.game.id;
      const playerStats = await client.getGamePlayerStats(gameId);
      
      console.log(`✅ Found ${playerStats.response?.length || 0} player stat records\n`);
      
      if (playerStats.response && playerStats.response.length > 0) {
        const sample = playerStats.response.slice(0, 3);
        console.log('Sample player stats:');
        sample.forEach(p => {
          console.log(`  ${p.player.name}:`);
          console.log(`    Pass: ${p.statistics.passing?.yards || 0} yds, ${p.statistics.passing?.touchdowns || 0} TDs`);
          console.log(`    Rush: ${p.statistics.rushing?.yards || 0} yds, ${p.statistics.rushing?.touchdowns || 0} TDs`);
          console.log(`    Rec: ${p.statistics.receiving?.receptions || 0} rec, ${p.statistics.receiving?.yards || 0} yds\n`);
        });
      }
    } else {
      console.log('❌ No games found for Nov 30, 2025');
      console.log('This could mean:');
      console.log('1. API-Sports API key not configured');
      console.log('2. No NFL games on that date');
      console.log('3. API quota exceeded');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

test().then(() => process.exit(0));
