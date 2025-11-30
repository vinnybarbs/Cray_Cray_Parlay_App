/**
 * Test API-Sports API directly to verify endpoints
 */

require('dotenv').config();

async function testAPI() {
  const API_KEY = process.env.APISPORTS_API_KEY;
  const baseUrl = 'https://v1.american-football.api-sports.io';

  console.log('🧪 Testing API-Sports NFL endpoints\n');
  console.log(`API Key: ${API_KEY?.substring(0, 10)}...`);

  // Test 1: Teams with 2024 season
  console.log('\n1. Testing teams endpoint (season 2024)...');
  try {
    const res = await fetch(`${baseUrl}/teams?league=1&season=2024`, {
      headers: { 'x-apisports-key': API_KEY }
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Results: ${data.results}`);
    console.log(`   Errors: ${JSON.stringify(data.errors)}`);
    if (data.response && data.response[0]) {
      console.log(`   Sample team: ${data.response[0].name} (ID: ${data.response[0].id})`);
    }
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }

  // Test 2: Teams with 2025 season
  console.log('\n2. Testing teams endpoint (season 2025)...');
  try {
    const res = await fetch(`${baseUrl}/teams?league=1&season=2025`, {
      headers: { 'x-apisports-key': API_KEY }
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Results: ${data.results}`);
    console.log(`   Errors: ${JSON.stringify(data.errors)}`);
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }

  // Test 3: Standings with 2024
  console.log('\n3. Testing standings endpoint (season 2024)...');
  try {
    const res = await fetch(`${baseUrl}/standings?league=1&season=2024`, {
      headers: { 'x-apisports-key': API_KEY }
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Results: ${data.results}`);
    if (data.response && data.response[0]) {
      console.log(`   Sample: ${data.response[0].team.name} - ${data.response[0].won}W ${data.response[0].lost}L`);
    }
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }

  // Test 4: Injuries with team parameter
  console.log('\n4. Testing injuries endpoint (with team=1)...');
  try {
    const res = await fetch(`${baseUrl}/injuries?team=1`, {
      headers: { 'x-apisports-key': API_KEY }
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Results: ${data.results}`);
    console.log(`   Errors: ${JSON.stringify(data.errors)}`);
    if (data.response && data.response[0]) {
      console.log(`   Sample injury: ${data.response[0].player.name} - ${data.response[0].status}`);
    }
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }

  // Test 5: Check available seasons
  console.log('\n5. Testing what seasons are available...');
  for (const season of [2023, 2024, 2025]) {
    try {
      const res = await fetch(`${baseUrl}/teams?league=1&season=${season}`, {
        headers: { 'x-apisports-key': API_KEY }
      });
      const data = await res.json();
      console.log(`   Season ${season}: ${data.results} teams`);
    } catch (error) {
      console.log(`   Season ${season}: Error`);
    }
  }

  console.log('\n✅ API test complete');
}

testAPI();
