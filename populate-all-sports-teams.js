require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Sports configuration mapping
const SPORTS_CONFIG = {
  // American Football
  NFL: {
    apiLeague: 1,
    season: 2023,
    sport: 'NFL',
    description: 'National Football League'
  },
  NCAAF: {
    apiLeague: 2,
    season: 2023,
    sport: 'NCAAF',
    description: 'NCAA Division I Football'
  },
  
  // Basketball
  NBA: {
    apiLeague: 12, // Common NBA league ID
    season: 2023,
    sport: 'NBA',
    description: 'National Basketball Association'
  },
  NCAAB: {
    apiLeague: 2, // Same as NCAAF (same universities)
    season: 2023,
    sport: 'NCAAB',
    description: 'NCAA Division I Basketball'
  },
  
  // Hockey - NHL
  NHL: {
    apiLeague: null, // Need to discover NHL league ID
    season: 2023,
    sport: 'NHL',
    description: 'National Hockey League'
  },
  
  // Soccer - EPL
  EPL: {
    apiLeague: null, // Need to discover EPL league ID
    season: 2023,
    sport: 'EPL',
    description: 'English Premier League'
  }
};

async function discoverLeagues() {
  console.log('🔍 Discovering available leagues in API-Sports...');
  
  try {
    // Try different API endpoints to find leagues
    const endpoints = [
      'https://v1.american-football.api-sports.io/leagues',
      'https://v1.basketball.api-sports.io/leagues',
      'https://v1.hockey.api-sports.io/leagues',
      'https://v1.football.api-sports.io/leagues' // Soccer
    ];
    
    for (const endpoint of endpoints) {
      console.log(`\n📡 Testing endpoint: ${endpoint}`);
      
      try {
        const response = await axios.get(endpoint, {
          headers: {
            'X-RapidAPI-Key': process.env.APISPORTS_API_KEY,
            'X-RapidAPI-Host': endpoint.split('/')[2]
          },
          timeout: 10000
        });
        
        if (response.data.response && response.data.response.length > 0) {
          console.log(`✅ Found ${response.data.response.length} leagues`);
          response.data.response.slice(0, 10).forEach(league => {
            console.log(`   ID ${league.id}: ${league.name} (${league.country?.name || 'Unknown'})`);
          });
        } else {
          console.log('❌ No leagues found');
        }
      } catch (error) {
        console.log(`❌ Error: ${error.message}`);
      }
    }
  } catch (error) {
    console.log('❌ Discovery failed:', error.message);
  }
}

async function populateTeamsForSport(sportConfig, sportName) {
  console.log(`\n🏆 Populating teams for ${sportName} (${sportConfig.description})...`);
  
  try {
    // Determine API endpoint based on sport
    let baseUrl;
    if (sportName === 'NFL' || sportName === 'NCAAF') {
      baseUrl = 'https://v1.american-football.api-sports.io';
    } else if (sportName === 'NBA' || sportName === 'NCAAB') {
      baseUrl = 'https://v1.basketball.api-sports.io';
    } else if (sportName === 'NHL') {
      baseUrl = 'https://v1.hockey.api-sports.io';
    } else if (sportName === 'EPL') {
      baseUrl = 'https://v1.football.api-sports.io';
    } else {
      console.log(`❌ Unknown sport: ${sportName}`);
      return [];
    }
    
    if (!sportConfig.apiLeague) {
      console.log(`⚠️ League ID not known for ${sportName}, skipping for now`);
      return [];
    }
    
    const response = await axios.get(`${baseUrl}/teams`, {
      headers: {
        'X-RapidAPI-Key': process.env.APISPORTS_API_KEY,
        'X-RapidAPI-Host': baseUrl.split('/')[2]
      },
      params: {
        league: sportConfig.apiLeague,
        season: sportConfig.season
      },
      timeout: 15000
    });
    
    if (!response.data.response) {
      console.log(`❌ No teams found for ${sportName}`);
      return [];
    }
    
    const teams = response.data.response;
    console.log(`📋 Found ${teams.length} teams for ${sportName}`);
    
    // Process and cache teams
    const cachedTeams = [];
    for (const team of teams) {
      // Skip conferences for football
      if ((sportName === 'NFL' || sportName === 'NCAAF') && 
          ['AFC', 'NFC'].includes(team.name)) {
        continue;
      }
      
      const teamData = {
        team_id: team.id,
        team_name: team.name,
        sport: sportConfig.sport,
        season: sportConfig.season,
        stats: {
          team_info: {
            id: team.id,
            name: team.name,
            logo: team.logo,
            code: team.code
          },
          games: { played: 0, wins: 0, losses: 0 },
          points: { for: 0, against: 0 }
        },
        last_updated: new Date().toISOString()
      };
      
      cachedTeams.push(teamData);
    }
    
    if (cachedTeams.length > 0) {
      const { error } = await supabase
        .from('team_stats_cache')
        .upsert(cachedTeams, { onConflict: 'team_id,sport,season' });
      
      if (error) {
        console.log(`❌ Error caching ${sportName} teams:`, error.message);
      } else {
        console.log(`✅ Successfully cached ${cachedTeams.length} ${sportName} teams`);
      }
    }
    
    return cachedTeams;
    
  } catch (error) {
    console.log(`❌ Error fetching ${sportName} teams:`, error.response?.data || error.message);
    return [];
  }
}

async function populateAllSportsTeams() {
  console.log('🏆 Starting comprehensive team population for all sports...');
  
  // First discover available leagues
  await discoverLeagues();
  
  let totalTeams = 0;
  
  // Populate teams for each sport
  for (const [sportName, config] of Object.entries(SPORTS_CONFIG)) {
    const teams = await populateTeamsForSport(config, sportName);
    totalTeams += teams.length;
    
    // Small delay between sports to respect rate limits
    if (teams.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Final summary
  const { data: allTeams } = await supabase
    .from('team_stats_cache')
    .select('sport')
    .order('team_id');
  
  if (allTeams) {
    const sportCounts = allTeams.reduce((acc, team) => {
      acc[team.sport] = (acc[team.sport] || 0) + 1;
      return acc;
    }, {});
    
    console.log('\n📊 Final team cache by sport:');
    Object.entries(sportCounts).forEach(([sport, count]) => {
      console.log(`   ${sport}: ${count} teams`);
    });
    console.log(`   Total: ${allTeams.length} teams across all sports`);
  }
}

populateAllSportsTeams().then(() => {
  console.log('\n✅ All sports team population complete!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Population failed:', error);
  process.exit(1);
});