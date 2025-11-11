// Essential API-Sports cache population 
// Focus on current rosters, team mappings, and active player data

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const apiKey = process.env.APISPORTS_API_KEY;

async function populateEssentialCache() {
  console.log('🚀 Starting essential cache population...');
  
  if (!apiKey) {
    console.error('❌ API-Sports key not found in environment');
    return;
  }

  let totalTeams = 0;
  let totalPlayers = 0;

  try {
    // Step 1: Get current NFL teams (try without season first)
    console.log('\n📊 Fetching NFL teams...');
    const teamsRes = await fetch('https://v1.american-football.api-sports.io/teams?league=1&season=2024', {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'v1.american-football.api-sports.io'
      }
    });

    if (!teamsRes.ok) {
      throw new Error(`Teams API failed: ${teamsRes.status}`);
    }

    const teamsData = await teamsRes.json();
    const teams = teamsData.response || [];
    
    console.log(`✅ Found ${teams.length} NFL teams`);

    // Step 2: Cache team data
    for (const teamData of teams) {
      const team = teamData.team;
      
      try {
        // Insert/update team cache
        const { error: teamError } = await supabase
          .from('team_stats_cache')
          .upsert({
            sport: 'NFL',
            team_id: team.id,
            team_name: team.name,
            team_code: team.code,
            city: team.name.split(' ').slice(0, -1).join(' '), // Extract city
            logo: team.logo,
            season: 2025,
            conference: null, // Will be populated later if available
            division: null,
            last_updated: new Date().toISOString()
          }, {
            onConflict: 'sport,team_id,season'
          });

        if (teamError) {
          console.error(`❌ Error caching team ${team.name}:`, teamError.message);
        } else {
          totalTeams++;
          console.log(`✅ Cached team: ${team.name}`);
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.error(`❌ Error processing team ${team.name}:`, error.message);
      }
    }

    console.log(`\n🏈 Teams cached: ${totalTeams}`);

    // Step 3: Get current player rosters for key teams (limit to avoid quota)
    const keyTeams = teams.slice(0, 8); // Cache rosters for first 8 teams
    
    console.log(`\n👥 Fetching player rosters for ${keyTeams.length} teams...`);

    for (const teamData of keyTeams) {
      const team = teamData.team;
      
      try {
        console.log(`  📋 Fetching roster for ${team.name}...`);
        
        const playersRes = await fetch(`https://v1.american-football.api-sports.io/players?team=${team.id}&season=2025`, {
          headers: {
            'x-rapidapi-key': apiKey,
            'x-rapidapi-host': 'v1.american-football.api-sports.io'
          }
        });

        if (!playersRes.ok) {
          console.warn(`⚠️ Players API failed for ${team.name}: ${playersRes.status}`);
          continue;
        }

        const playersData = await playersRes.json();
        const players = playersData.response || [];

        console.log(`    Found ${players.length} players for ${team.name}`);

        // Cache player data
        for (const playerData of players) {
          const player = playerData;
          
          try {
            const { error: playerError } = await supabase
              .from('player_stats_cache')
              .upsert({
                sport: 'NFL',
                player_id: player.id,
                player_name: player.name,
                team_id: team.id,
                team_name: team.name,
                position: player.position || 'Unknown',
                jersey_number: player.number,
                season: 2025,
                age: player.age,
                height: player.height,
                weight: player.weight,
                last_updated: new Date().toISOString()
              }, {
                onConflict: 'sport,player_id,season'
              });

            if (!playerError) {
              totalPlayers++;
            }

          } catch (playerCacheError) {
            console.error(`❌ Error caching player ${player.name}:`, playerCacheError.message);
          }
        }

        console.log(`    ✅ Cached ${players.length} players for ${team.name}`);

        // Rate limiting between teams
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`❌ Error fetching players for ${team.name}:`, error.message);
      }
    }

    // Step 4: Verify cache population
    console.log('\n📊 Verifying cache population...');
    
    const { data: teamCount } = await supabase
      .from('team_stats_cache')
      .select('team_name', { count: 'exact' })
      .eq('sport', 'NFL')
      .eq('season', 2025);

    const { data: playerCount } = await supabase
      .from('player_stats_cache')
      .select('player_name', { count: 'exact' })
      .eq('sport', 'NFL')
      .eq('season', 2025);

    console.log(`\n✅ Cache Population Complete!`);
    console.log(`📊 Teams cached: ${teamCount?.length || 0}`);
    console.log(`👥 Players cached: ${playerCount?.length || 0}`);
    console.log(`🎯 Total API calls made: ~${totalTeams + keyTeams.length}`);

    // Step 5: Test a few team name lookups
    console.log('\n🔍 Testing team name lookups...');
    const testTeams = ['Kansas City Chiefs', 'Buffalo Bills', 'Tampa Bay Buccaneers'];
    
    for (const teamName of testTeams) {
      const { data: team } = await supabase
        .from('team_stats_cache')
        .select('team_name, team_id')
        .eq('sport', 'NFL')
        .ilike('team_name', `%${teamName}%`)
        .limit(1);

      if (team && team.length > 0) {
        console.log(`✅ Found: ${team[0].team_name} (ID: ${team[0].team_id})`);
      } else {
        console.log(`❌ Not found: ${teamName}`);
      }
    }

  } catch (error) {
    console.error('💥 Cache population failed:', error);
  }
}

// Run the population
populateEssentialCache().then(() => {
  console.log('\n🎉 Essential cache population completed!');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Population failed:', error);
  process.exit(1);
});