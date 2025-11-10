#!/usr/bin/env node

/**
 * Debug script to check ESPN College Football API for Nov 7, 2024 games
 * This helps us understand why the parlay checker isn't finding the games
 */

const fetch = require('node-fetch');

async function debugCollegeGames() {
  console.log('🔍 Debugging ESPN College Football API for Nov 7, 2025...\n');
  
  const gameDate = '20251107'; // Nov 7, 2025 in ESPN format
  const endpoint = `http://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${gameDate}`;
  
  console.log('📡 Fetching from:', endpoint);
  
  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    console.log(`\n📊 Found ${data.events?.length || 0} games on ${gameDate}`);
    
    if (!data.events?.length) {
      console.log('❌ No games found for this date');
      return;
    }
    
    // Look for our specific teams
    const targetTeams = [
      'Jacksonville State',
      'UTEP',
      'Bowling Green', 
      'Eastern Michigan',
      'Missouri State',
      'Liberty'
    ];
    
    console.log('\n🎯 Looking for these teams:', targetTeams.join(', '));
    console.log('\n📋 All games found:\n');
    
    data.events.forEach((event, index) => {
      const competition = event.competitions[0];
      const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
      const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
      const status = competition.status;
      
      const homeScore = parseInt(homeTeam.score) || 0;
      const awayScore = parseInt(awayTeam.score) || 0;
      
      console.log(`${index + 1}. ${awayTeam.team.displayName} @ ${homeTeam.team.displayName}`);
      console.log(`   Score: ${awayTeam.team.displayName} ${awayScore}, ${homeTeam.team.displayName} ${homeScore}`);
      console.log(`   Status: ${status.type.description} (Completed: ${status.type.completed})`);
      
      // Check if this matches our target teams
      const matchesTarget = targetTeams.some(target => 
        homeTeam.team.displayName.toLowerCase().includes(target.toLowerCase()) ||
        awayTeam.team.displayName.toLowerCase().includes(target.toLowerCase()) ||
        target.toLowerCase().includes(homeTeam.team.displayName.toLowerCase()) ||
        target.toLowerCase().includes(awayTeam.team.displayName.toLowerCase())
      );
      
      if (matchesTarget) {
        console.log(`   🎯 MATCH FOUND! This is one of our target games`);
      }
      
      console.log('');
    });
    
    // Now test our team matching function
    console.log('\n🔧 Testing team matching logic...\n');
    
    const ourGames = [
      { home: 'UTEP Miners', away: 'Jacksonville State Gamecocks' },
      { home: 'Eastern Michigan Eagles', away: 'Bowling Green Falcons' },
      { home: 'Liberty Flames', away: 'Missouri State Bears' }
    ];
    
    ourGames.forEach(ourGame => {
      console.log(`Looking for: ${ourGame.away} @ ${ourGame.home}`);
      
      const matchedGame = data.events.find(event => {
        const competition = event.competitions[0];
        const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
        const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
        
        const homeMatch = teamsMatch(homeTeam.team.displayName, ourGame.home);
        const awayMatch = teamsMatch(awayTeam.team.displayName, ourGame.away);
        
        return homeMatch && awayMatch;
      });
      
      if (matchedGame) {
        const competition = matchedGame.competitions[0];
        const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
        const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
        
        console.log(`✅ Found match: ${awayTeam.team.displayName} @ ${homeTeam.team.displayName}`);
        console.log(`   Final Score: ${awayTeam.team.displayName} ${awayTeam.score}, ${homeTeam.team.displayName} ${homeTeam.score}`);
        console.log(`   Status: ${competition.status.type.description}`);
      } else {
        console.log(`❌ No match found`);
        
        // Debug - show potential matches
        console.log('   Potential home team matches:');
        data.events.forEach(event => {
          const homeTeam = event.competitions[0].competitors.find(c => c.homeAway === 'home');
          if (teamsMatch(homeTeam.team.displayName, ourGame.home)) {
            console.log(`     - ${homeTeam.team.displayName}`);
          }
        });
        
        console.log('   Potential away team matches:');
        data.events.forEach(event => {
          const awayTeam = event.competitions[0].competitors.find(c => c.homeAway === 'away');
          if (teamsMatch(awayTeam.team.displayName, ourGame.away)) {
            console.log(`     - ${awayTeam.team.displayName}`);
          }
        });
      }
      
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error fetching games:', error.message);
  }
}

/**
 * Team matching function (same as in the Edge Function)
 */
function teamsMatch(apiTeamName, legTeamName) {
  if (!apiTeamName || !legTeamName) return false;
  
  const apiLower = apiTeamName.toLowerCase().trim();
  const legLower = legTeamName.toLowerCase().trim();
  
  // Direct match
  if (apiLower === legLower) {
    return true;
  }

  // Remove common suffixes and try again
  const cleanApi = apiLower.replace(/\s+(gamecocks|miners|falcons|eagles|flames|bears)$/, '');
  const cleanLeg = legLower.replace(/\s+(gamecocks|miners|falcons|eagles|flames|bears)$/, '');
  
  if (cleanApi === cleanLeg) {
    return true;
  }

  // Check if one contains the other (for partial matches)
  return apiLower.includes(legLower) || legLower.includes(apiLower);
}

// Run the debug
debugCollegeGames().catch(console.error);