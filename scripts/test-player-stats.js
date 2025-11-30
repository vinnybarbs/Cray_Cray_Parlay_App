/**
 * Quick test to see what player stats API returns
 */

require('dotenv').config();
const ApiSportsClient = require('../lib/services/apisports-client');

async function test() {
  const client = new ApiSportsClient();
  
  // Use a known game ID from the 2025 season
  const gameId = 1985; // Example game ID
  
  console.log(`Testing player stats for game ${gameId}...\n`);
  
  try {
    const result = await client.getGamePlayerStats(gameId);
    
    console.log('Response structure:');
    console.log('- response exists:', !!result.response);
    console.log('- response length:', result.response?.length || 0);
    console.log('- errors:', result.errors);
    
    if (result.response && result.response.length > 0) {
      console.log('\nFirst player:');
      console.log(JSON.stringify(result.response[0], null, 2));
    } else {
      console.log('\nFull response:');
      console.log(JSON.stringify(result, null, 2));
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

test();
