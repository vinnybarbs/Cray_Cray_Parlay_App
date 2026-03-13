require('dotenv').config({ path: '.env.local' });
const ApiSportsClient = require('./lib/services/apisports-client');

async function test() {
  const client = new ApiSportsClient();

  const gameId = 17377;

  console.log(`Getting player stats for game ${gameId}...\n`);

  const playerStats = await client.getGamePlayerStats(gameId);

  console.log('Full response structure:');
  console.log(JSON.stringify(playerStats, null, 2));
}

test().then(() => process.exit(0));
