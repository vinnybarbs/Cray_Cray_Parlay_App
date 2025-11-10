const { SportsStatsService } = require('./lib/services/sports-stats');

async function testStatsService() {
  console.log('🧪 Testing Sports Stats Service Integration');
  
  const statsService = new SportsStatsService();
  
  try {
    // Test 1: Check NBA teams
    console.log('\n1. Testing NBA team stats...');
    const nbaTeams = await statsService.getTeamStats('NBA');
    console.log(`   Found ${nbaTeams.length} NBA teams`);
    
    if (nbaTeams.length > 0) {
      const team = nbaTeams[0];
      console.log(`   Sample team: ${team.team_name} (${team.stats_json?.wins || 'N/A'}-${team.stats_json?.losses || 'N/A'})`);
    }
    
    // Test 2: Check NFL teams
    console.log('\n2. Testing NFL team stats...');
    const nflTeams = await statsService.getTeamStats('NFL');
    console.log(`   Found ${nflTeams.length} NFL teams`);
    
    if (nflTeams.length > 0) {
      const team = nflTeams[0];
      console.log(`   Sample team: ${team.team_name} (${team.stats_json?.wins || 'N/A'}-${team.stats_json?.losses || 'N/A'})`);
    }
    
    // Test 3: Test matchup context (using teams that should exist)
    if (nbaTeams.length >= 2) {
      console.log('\n3. Testing matchup context...');
      const team1 = nbaTeams[0].team_name;
      const team2 = nbaTeams[1].team_name;
      
      console.log(`   Testing matchup: ${team1} vs ${team2}`);
      const matchup = await statsService.getMatchupContext('NBA', team1, team2);
      
      if (matchup) {
        console.log(`   ✅ Matchup context generated successfully`);
        console.log(`   Home: ${matchup.homeTeam.team_name}`);
        console.log(`   Away: ${matchup.awayTeam.team_name}`);
        console.log(`   Insights: ${matchup.matchupInsights.length} generated`);
      } else {
        console.log(`   ⚠️ No matchup context generated`);
      }
    }
    
    // Test 4: Service stats
    console.log('\n4. Service stats...');
    const serviceStats = statsService.getStats();
    console.log(`   Cache size: ${serviceStats.cacheSize}`);
    console.log(`   Available methods: ${serviceStats.availableMethods.length}`);
    
    console.log('\n✅ Sports Stats Service test complete');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testStatsService().then(() => {
  console.log('\n🏁 Test finished');
  process.exit(0);
}).catch(error => {
  console.error('❌ Test crashed:', error);
  process.exit(1);
});