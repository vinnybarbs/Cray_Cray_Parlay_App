#!/usr/bin/env node

// Search ESPN API for team names containing "Miami" or "Pittsburgh"
const fetch = require('node-fetch');

async function findTeamNames() {
  const gameDate = '20251129';
  const endpoint = 'http://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';
  const url = `${endpoint}?dates=${gameDate}`;
  
  console.log('🔍 Searching for Miami and Pittsburgh in ESPN data...\n');

  const response = await fetch(url);
  const data = await response.json();
  
  const searchTerms = ['Miami', 'Pittsburgh', 'Pitt'];
  
  data.events.forEach(event => {
    const comp = event.competitions[0];
    const home = comp.competitors.find(c => c.homeAway === 'home');
    const away = comp.competitors.find(c => c.homeAway === 'away');
    
    const homeTeam = home.team.displayName;
    const awayTeam = away.team.displayName;
    
    searchTerms.forEach(term => {
      if (homeTeam.includes(term) || awayTeam.includes(term)) {
        console.log(`✅ Found: ${awayTeam} @ ${homeTeam}`);
        console.log(`   Score: ${away.score}-${home.score}`);
        console.log(`   Status: ${comp.status.type.description}`);
        console.log('');
      }
    });
  });
}

findTeamNames().catch(console.error);
