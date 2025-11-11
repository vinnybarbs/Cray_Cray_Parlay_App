require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function populateAllTeams() {
  console.log('🏈 Fetching complete team list from API-Sports...');
  
  let allTeams = [];
  
  try {
    // Fetch NFL teams (League 1)
    console.log('📡 Fetching NFL teams (League 1)...');
    const nflResponse = await axios.get('https://v1.american-football.api-sports.io/teams', {
      headers: {
        'X-RapidAPI-Key': process.env.APISPORTS_API_KEY,
        'X-RapidAPI-Host': 'v1.american-football.api-sports.io'
      },
      params: {
        league: 1, // NFL
        season: 2023 // Use 2023 since 2025 data not available on free tier
      }
    });
    
    if (nflResponse.data.response) {
      // Filter out AFC/NFC conferences (IDs 33-34)
      const nflTeams = nflResponse.data.response.filter(team => 
        team.id <= 32 && !['AFC', 'NFC'].includes(team.name)
      );
      allTeams = allTeams.concat(nflTeams);
      console.log(`✅ Found ${nflTeams.length} NFL teams`);
    }
    
    // Fetch NCAAF teams (League 2) - get a subset to avoid overwhelming the database
    console.log('📡 Fetching NCAAF teams (League 2)...');
    const ncaafResponse = await axios.get('https://v1.american-football.api-sports.io/teams', {
      headers: {
        'X-RapidAPI-Key': process.env.APISPORTS_API_KEY,
        'X-RapidAPI-Host': 'v1.american-football.api-sports.io'
      },
      params: {
        league: 2, // NCAAF
        season: 2023
      }
    });
    
    if (ncaafResponse.data.response) {
      // Filter to major NCAAF programs to keep the dataset manageable
      const majorPrograms = ncaafResponse.data.response.filter(team => {
        if (!team.name) return false;
        const majorKeywords = [
          'Alabama', 'Georgia', 'Ohio State', 'Michigan', 'Texas', 'USC', 'Notre Dame', 
          'Clemson', 'Florida State', 'Penn State', 'Auburn', 'LSU', 'Oklahoma', 'Florida',
          'Miami', 'Wisconsin', 'Oregon', 'Washington', 'Tennessee', 'Arkansas', 'Kentucky',
          'Mississippi', 'South Carolina', 'Vanderbilt', 'Missouri', 'Texas A&M', 'Stanford',
          'UCLA', 'Arizona', 'Arizona State', 'Colorado', 'Utah', 'Iowa', 'Minnesota',
          'Northwestern', 'Illinois', 'Indiana', 'Purdue', 'Maryland', 'Rutgers', 'Nebraska'
        ];
        return majorKeywords.some(keyword => team.name.includes(keyword));
      });
      
      allTeams = allTeams.concat(majorPrograms);
      console.log(`✅ Found ${majorPrograms.length} major NCAAF programs (filtered from ${ncaafResponse.data.response.length} total)`);
    }
    
    console.log(`📋 Total teams to process: ${allTeams.length}`);

    // Process each team
    for (const team of allTeams) {
      // Determine sport based on team ID and league
      let sport;
      if (team.id <= 34) {
        sport = 'NFL';
      } else {
        sport = 'NCAAF';
      }
      
      console.log(`Processing ID ${team.id}: ${team.name} (${sport})`);
      
      // Create team stats cache entry with basic info
      const teamData = {
        team_id: team.id,
        team_name: team.name,
        sport: sport,
        season: 2023,
        stats: {
          team_info: {
            id: team.id,
            name: team.name,
            logo: team.logo,
            code: team.code
          },
          // Add placeholder stats structure
          games: {
            played: 0,
            wins: 0,
            losses: 0
          },
          points: {
            for: 0,
            against: 0
          }
        },
        last_updated: new Date().toISOString()
      };

      // Insert or update team
      const { error } = await supabase
        .from('team_stats_cache')
        .upsert(teamData, { 
          onConflict: 'team_id,sport,season' 
        });

      if (error) {
        console.log(`❌ Error inserting ${team.name}:`, error.message);
      } else {
        console.log(`✅ Cached ${team.name} (${sport})`);
      }
    }

    // Final count
    const { data: allCachedTeams, error: countError } = await supabase
      .from('team_stats_cache')
      .select('team_id, team_name, sport')
      .order('team_id');

    if (countError) {
      console.log('❌ Error counting teams:', countError.message);
    } else {
      const nflTeams = allCachedTeams.filter(t => t.sport === 'NFL').length;
      const ncaafTeams = allCachedTeams.filter(t => t.sport === 'NCAAF').length;
      
      console.log(`\n📊 Final team cache statistics:`);
      console.log(`   NFL teams: ${nflTeams}`);
      console.log(`   NCAAF teams: ${ncaafTeams}`);
      console.log(`   Total teams: ${allCachedTeams.length}`);
      
      console.log('\n🎯 Team ID ranges:');
      console.log('   NFL: IDs 1-32');
      console.log('   NCAAF: IDs 35+');
    }

  } catch (error) {
    console.error('❌ Error fetching teams:', error.response?.data || error.message);
  }
}

populateAllTeams().then(() => {
  console.log('\n✅ Team population complete!');
  process.exit(0);
}).catch(console.error);