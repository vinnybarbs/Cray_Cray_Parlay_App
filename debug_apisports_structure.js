require('dotenv').config({ path: '.env.local' });
const ApiSportsClient = require('./lib/services/apisports-client');

async function test() {
  const client = new ApiSportsClient();
  
  const games = await client.getGamesByDate('2025-11-30', 1);
  const game = games.response[0];
  const gameId = game.game.id;
  
  console.log(`Getting player stats for game ${gameId}...\n`);
  
  const playerStats = await client.getGamePlayerStats(gameId);
  
  console.log('Full response structure:');
  console.log(JSON.stringify(playerStats, null, 2));
}

test().then(() => process.exit(0));
