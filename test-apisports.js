const axios = require('axios');

// Load environment variables
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

async function testAPISports() {
  const apiKey = process.env.APISPORTS_API_KEY;
  
  console.log('Testing API-Sports connection...');
  console.log('API Key:', apiKey ? 'SET' : 'NOT SET');
  
  if (!apiKey) {
    console.log('❌ No API key found');
    return;
  }

  try {
    // Simple test: get NFL leagues
    const response = await axios.get('https://v1.american-football.api-sports.io/leagues', {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'v1.american-football.api-sports.io'
      },
      timeout: 10000
    });

    console.log('✅ API-Sports connection successful');
    console.log('Status:', response.status);
    console.log('Data:', JSON.stringify(response.data, null, 2));

    // Test getting NFL standings
    const standingsResponse = await axios.get('https://v1.american-football.api-sports.io/standings?league=1&season=2024', {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'v1.american-football.api-sports.io'
      },
      timeout: 10000
    });

    console.log('✅ NFL standings fetch successful');
    console.log('Teams found:', standingsResponse.data.response?.length || 0);

  } catch (error) {
    console.log('❌ API-Sports test failed');
    console.log('Error:', error.response?.data || error.message);
  }
}

testAPISports();