#!/usr/bin/env node

// Quick test to see if ESPN API returns results for one of your games
const fetch = require('node-fetch');

async function testESPN() {
  // Test one of your NCAA games from 11/29
  const gameDate = '20251129'; // Format: YYYYMMDD
  const sport = 'NCAA';
  const homeTeam = 'Miami Hurricanes';
  const awayTeam = 'Pittsburgh Panthers';
  
  console.log(`🔍 Testing ESPN API for:`);
  console.log(`   ${awayTeam} @ ${homeTeam}`);
  console.log(`   Date: ${gameDate}`);
  console.log('');

  const endpoint = 'http://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';
  const url = `${endpoint}?dates=${gameDate}`;
  
  console.log(`📡 Fetching: ${url}`);
  console.log('');

  try {
    const response = await fetch(url);
    const data = await response.json();
    
    console.log(`✅ API Response received`);
    console.log(`   Events found: ${data.events?.length || 0}`);
    console.log('');

    if (!data.events || data.events.length === 0) {
      console.log('❌ No events found for this date');
      console.log('   This might mean:');
      console.log('   - Date format is wrong');
      console.log('   - ESPN doesn\'t have data for this date');
      console.log('   - Data has been purged (too old)');
      return;
    }

    // Show first few games
    console.log('📋 First 5 games found:');
    data.events.slice(0, 5).forEach((event, i) => {
      const comp = event.competitions[0];
      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      const status = comp.status.type.completed ? '✅ Final' : '🏈 Live/Scheduled';
      
      console.log(`   ${i+1}. ${away.team.displayName} @ ${home.team.displayName}`);
      console.log(`      Score: ${away.score}-${home.score} ${status}`);
    });

    // Try to find our specific game
    console.log('');
    console.log(`🔎 Looking for: ${awayTeam} @ ${homeTeam}`);
    
    const ourGame = data.events.find(event => {
      const comp = event.competitions[0];
      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      
      const homeMatch = home.team.displayName.toLowerCase().includes(homeTeam.toLowerCase()) ||
                       homeTeam.toLowerCase().includes(home.team.displayName.toLowerCase());
      const awayMatch = away.team.displayName.toLowerCase().includes(awayTeam.toLowerCase()) ||
                       awayTeam.toLowerCase().includes(away.team.displayName.toLowerCase());
      
      return homeMatch && awayMatch;
    });

    if (ourGame) {
      const comp = ourGame.competitions[0];
      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      
      console.log('✅ FOUND OUR GAME!');
      console.log(`   ESPN Teams: ${away.team.displayName} @ ${home.team.displayName}`);
      console.log(`   Score: ${away.score}-${home.score}`);
      console.log(`   Status: ${comp.status.type.completed ? 'FINAL' : comp.status.type.description}`);
    } else {
      console.log('❌ GAME NOT FOUND');
      console.log('   This means team names don\'t match ESPN\'s format');
      console.log('');
      console.log('💡 Try searching manually:');
      console.log(`   Search for: "${homeTeam.split(' ')[0]}" or "${awayTeam.split(' ')[0]}"`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testESPN();
