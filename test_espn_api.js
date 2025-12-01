async function testESPN() {
  const date = '2025-11-30';
  const dateStr = date.replace(/-/g, '');
  
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateStr}`;
  console.log(`📡 Fetching: ${url}\n`);
  
  const response = await fetch(url);
  const data = await response.json();
  
  console.log(`✅ Found ${data.events?.length || 0} NFL games on ${date}\n`);
  
  if (data.events && data.events.length > 0) {
    data.events.slice(0, 5).forEach(event => {
      const home = event.competitions[0].competitors.find(c => c.homeAway === 'home');
      const away = event.competitions[0].competitors.find(c => c.homeAway === 'away');
      const status = event.status.type.description;
      const state = event.status.type.state;
      
      console.log(`${away.team.displayName} @ ${home.team.displayName}`);
      console.log(`  Status: ${status} (${state})`);
      console.log(`  Score: ${away.score}-${home.score}`);
      console.log('');
    });
  } else {
    console.log('❌ No games found!');
    console.log('\nFull response:', JSON.stringify(data, null, 2).substring(0, 500));
  }
}

testESPN().then(() => process.exit(0));
