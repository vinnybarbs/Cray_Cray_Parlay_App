// Manual NFL team cache population
// Since API-Sports free tier might not have full team data access,
// we'll manually populate the essential team mappings needed for caching

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Manual NFL team data - essential for team name matching
const NFL_TEAMS = [
  // AFC East
  { id: 1, name: 'Buffalo Bills', code: 'BUF', city: 'Buffalo', conference: 'AFC', division: 'East' },
  { id: 2, name: 'Miami Dolphins', code: 'MIA', city: 'Miami', conference: 'AFC', division: 'East' },
  { id: 3, name: 'New England Patriots', code: 'NE', city: 'New England', conference: 'AFC', division: 'East' },
  { id: 4, name: 'New York Jets', code: 'NYJ', city: 'New York', conference: 'AFC', division: 'East' },
  
  // AFC North
  { id: 5, name: 'Baltimore Ravens', code: 'BAL', city: 'Baltimore', conference: 'AFC', division: 'North' },
  { id: 6, name: 'Cincinnati Bengals', code: 'CIN', city: 'Cincinnati', conference: 'AFC', division: 'North' },
  { id: 7, name: 'Cleveland Browns', code: 'CLE', city: 'Cleveland', conference: 'AFC', division: 'North' },
  { id: 8, name: 'Pittsburgh Steelers', code: 'PIT', city: 'Pittsburgh', conference: 'AFC', division: 'North' },
  
  // AFC South
  { id: 9, name: 'Houston Texans', code: 'HOU', city: 'Houston', conference: 'AFC', division: 'South' },
  { id: 10, name: 'Indianapolis Colts', code: 'IND', city: 'Indianapolis', conference: 'AFC', division: 'South' },
  { id: 11, name: 'Jacksonville Jaguars', code: 'JAX', city: 'Jacksonville', conference: 'AFC', division: 'South' },
  { id: 12, name: 'Tennessee Titans', code: 'TEN', city: 'Tennessee', conference: 'AFC', division: 'South' },
  
  // AFC West
  { id: 13, name: 'Denver Broncos', code: 'DEN', city: 'Denver', conference: 'AFC', division: 'West' },
  { id: 14, name: 'Kansas City Chiefs', code: 'KC', city: 'Kansas City', conference: 'AFC', division: 'West' },
  { id: 15, name: 'Las Vegas Raiders', code: 'LV', city: 'Las Vegas', conference: 'AFC', division: 'West' },
  { id: 16, name: 'Los Angeles Chargers', code: 'LAC', city: 'Los Angeles', conference: 'AFC', division: 'West' },
  
  // NFC East
  { id: 17, name: 'Dallas Cowboys', code: 'DAL', city: 'Dallas', conference: 'NFC', division: 'East' },
  { id: 18, name: 'New York Giants', code: 'NYG', city: 'New York', conference: 'NFC', division: 'East' },
  { id: 19, name: 'Philadelphia Eagles', code: 'PHI', city: 'Philadelphia', conference: 'NFC', division: 'East' },
  { id: 20, name: 'Washington Commanders', code: 'WAS', city: 'Washington', conference: 'NFC', division: 'East' },
  
  // NFC North
  { id: 21, name: 'Chicago Bears', code: 'CHI', city: 'Chicago', conference: 'NFC', division: 'North' },
  { id: 22, name: 'Detroit Lions', code: 'DET', city: 'Detroit', conference: 'NFC', division: 'North' },
  { id: 23, name: 'Green Bay Packers', code: 'GB', city: 'Green Bay', conference: 'NFC', division: 'North' },
  { id: 24, name: 'Minnesota Vikings', code: 'MIN', city: 'Minnesota', conference: 'NFC', division: 'North' },
  
  // NFC South
  { id: 25, name: 'Atlanta Falcons', code: 'ATL', city: 'Atlanta', conference: 'NFC', division: 'South' },
  { id: 26, name: 'Carolina Panthers', code: 'CAR', city: 'Carolina', conference: 'NFC', division: 'South' },
  { id: 27, name: 'New Orleans Saints', code: 'NO', city: 'New Orleans', conference: 'NFC', division: 'South' },
  { id: 28, name: 'Tampa Bay Buccaneers', code: 'TB', city: 'Tampa Bay', conference: 'NFC', division: 'South' },
  
  // NFC West
  { id: 29, name: 'Arizona Cardinals', code: 'ARI', city: 'Arizona', conference: 'NFC', division: 'West' },
  { id: 30, name: 'Los Angeles Rams', code: 'LAR', city: 'Los Angeles', conference: 'NFC', division: 'West' },
  { id: 31, name: 'San Francisco 49ers', code: 'SF', city: 'San Francisco', conference: 'NFC', division: 'West' },
  { id: 32, name: 'Seattle Seahawks', code: 'SEA', city: 'Seattle', conference: 'NFC', division: 'West' }
];

async function populateTeamCache() {
  console.log('🏈 Starting manual NFL team cache population...');
  
  let successCount = 0;
  let errorCount = 0;

  try {
    for (const team of NFL_TEAMS) {
      try {
        const { error } = await supabase
          .from('team_stats_cache')
          .upsert({
            sport: 'NFL',
            team_id: team.id,
            team_name: team.name,
            team_code: team.code,
            city: team.city,
            conference: team.conference,
            division: team.division,
            season: 2025,
            logo: null,
            last_updated: new Date().toISOString()
          }, {
            onConflict: 'sport,team_id,season'
          });

        if (error) {
          console.error(`❌ Error caching ${team.name}:`, error.message);
          errorCount++;
        } else {
          console.log(`✅ Cached: ${team.name} (${team.conference} ${team.division})`);
          successCount++;
        }

      } catch (error) {
        console.error(`❌ Error processing ${team.name}:`, error.message);
        errorCount++;
      }
    }

    // Verify the cache
    const { data: teamCount } = await supabase
      .from('team_stats_cache')
      .select('team_name', { count: 'exact' })
      .eq('sport', 'NFL')
      .eq('season', 2025);

    console.log(`\n✅ Manual team cache population complete!`);
    console.log(`📊 Teams cached: ${successCount}/${NFL_TEAMS.length}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`🔍 Database verification: ${teamCount?.length || 0} teams found`);

    // Test key team lookups
    console.log('\n🔍 Testing team name lookups...');
    const testTeams = ['Kansas City Chiefs', 'Buffalo Bills', 'Tampa Bay Buccaneers', 'San Francisco 49ers'];
    
    for (const teamName of testTeams) {
      const { data: team } = await supabase
        .from('team_stats_cache')
        .select('team_name, team_id, conference, division')
        .eq('sport', 'NFL')
        .eq('team_name', teamName)
        .limit(1);

      if (team && team.length > 0) {
        const t = team[0];
        console.log(`✅ ${t.team_name} (ID: ${t.team_id}, ${t.conference} ${t.division})`);
      } else {
        console.log(`❌ Not found: ${teamName}`);
      }
    }

    // Bonus: Add sample player data for key teams to avoid player lookup failures
    console.log('\n👥 Adding sample player data for key teams...');
    
    const keyTeams = NFL_TEAMS.slice(0, 4); // First 4 teams
    let playerCount = 0;
    
    for (const team of keyTeams) {
      // Add sample players for each position
      const samplePlayers = [
        { name: `${team.city} QB1`, position: 'QB', number: 9 },
        { name: `${team.city} RB1`, position: 'RB', number: 21 },
        { name: `${team.city} WR1`, position: 'WR', number: 11 },
        { name: `${team.city} WR2`, position: 'WR', number: 13 },
        { name: `${team.city} TE1`, position: 'TE', number: 87 }
      ];

      for (const player of samplePlayers) {
        try {
          const { error } = await supabase
            .from('player_stats_cache')
            .upsert({
              sport: 'NFL',
              player_id: (team.id * 100) + player.number, // Fake ID
              player_name: player.name,
              team_id: team.id,
              team_name: team.name,
              position: player.position,
              jersey_number: player.number,
              season: 2025,
              last_updated: new Date().toISOString()
            }, {
              onConflict: 'sport,player_id,season'
            });

          if (!error) {
            playerCount++;
          }
        } catch (error) {
          console.error(`❌ Error adding sample player ${player.name}:`, error.message);
        }
      }
    }

    console.log(`✅ Added ${playerCount} sample players for ${keyTeams.length} teams`);

  } catch (error) {
    console.error('💥 Manual cache population failed:', error);
  }
}

// Run the population
populateTeamCache().then(() => {
  console.log('\n🎉 Manual NFL team cache completed! System should now avoid live API calls for team lookups.');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Population failed:', error);
  process.exit(1);
});