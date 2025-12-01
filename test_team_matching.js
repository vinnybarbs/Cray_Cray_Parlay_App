require('dotenv').config({ path: '.env.local' });
const ApiSportsClient = require('./lib/services/apisports-client');

async function test() {
  const client = new ApiSportsClient();
  
  console.log('🏈 Checking team names in API-Sports...\n');
  
  const games = await client.getGamesByDate('2025-11-30', 1);
  
  console.log('API-Sports team names:');
  games.response.slice(0, 5).forEach(g => {
    console.log(`  Away: "${g.teams.away.name}"`);
    console.log(`  Home: "${g.teams.home.name}"`);
    console.log('');
  });
  
  console.log('\nYour leg team names:');
  console.log('  Away: "Arizona Cardinals"');
  console.log('  Home: "Tampa Bay Buccaneers"');
  console.log('');
  console.log('  Away: "Atlanta Falcons"');
  console.log('  Home: "New York Jets"');
  console.log('');
  console.log('  Away: "Los Angeles Rams"');
  console.log('  Home: "Carolina Panthers"');
}

test().then(() => process.exit(0));
