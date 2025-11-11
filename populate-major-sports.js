require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Manual NBA teams as fallback (since API might not be working for NBA)
const NBA_TEAMS_FALLBACK = [
  { id: 1001, name: 'Atlanta Hawks', code: 'ATL' },
  { id: 1002, name: 'Boston Celtics', code: 'BOS' },
  { id: 1003, name: 'Brooklyn Nets', code: 'BKN' },
  { id: 1004, name: 'Charlotte Hornets', code: 'CHA' },
  { id: 1005, name: 'Chicago Bulls', code: 'CHI' },
  { id: 1006, name: 'Cleveland Cavaliers', code: 'CLE' },
  { id: 1007, name: 'Dallas Mavericks', code: 'DAL' },
  { id: 1008, name: 'Denver Nuggets', code: 'DEN' },
  { id: 1009, name: 'Detroit Pistons', code: 'DET' },
  { id: 1010, name: 'Golden State Warriors', code: 'GSW' },
  { id: 1011, name: 'Houston Rockets', code: 'HOU' },
  { id: 1012, name: 'Indiana Pacers', code: 'IND' },
  { id: 1013, name: 'LA Clippers', code: 'LAC' },
  { id: 1014, name: 'Los Angeles Lakers', code: 'LAL' },
  { id: 1015, name: 'Memphis Grizzlies', code: 'MEM' },
  { id: 1016, name: 'Miami Heat', code: 'MIA' },
  { id: 1017, name: 'Milwaukee Bucks', code: 'MIL' },
  { id: 1018, name: 'Minnesota Timberwolves', code: 'MIN' },
  { id: 1019, name: 'New Orleans Pelicans', code: 'NOP' },
  { id: 1020, name: 'New York Knicks', code: 'NYK' },
  { id: 1021, name: 'Oklahoma City Thunder', code: 'OKC' },
  { id: 1022, name: 'Orlando Magic', code: 'ORL' },
  { id: 1023, name: 'Philadelphia 76ers', code: 'PHI' },
  { id: 1024, name: 'Phoenix Suns', code: 'PHX' },
  { id: 1025, name: 'Portland Trail Blazers', code: 'POR' },
  { id: 1026, name: 'Sacramento Kings', code: 'SAC' },
  { id: 1027, name: 'San Antonio Spurs', code: 'SAS' },
  { id: 1028, name: 'Toronto Raptors', code: 'TOR' },
  { id: 1029, name: 'Utah Jazz', code: 'UTA' },
  { id: 1030, name: 'Washington Wizards', code: 'WAS' }
];

async function populateMLB() {
  console.log('⚾ Populating MLB teams from API-Sports...');
  
  try {
    const response = await axios.get('https://v1.baseball.api-sports.io/teams', {
      headers: {
        'X-RapidAPI-Key': process.env.APISPORTS_API_KEY,
        'X-RapidAPI-Host': 'v1.baseball.api-sports.io'
      },
      params: {
        league: 1, // MLB league ID
        season: 2023
      }
    });
    
    const teams = response.data.response || [];
    console.log(`📋 Found ${teams.length} teams from MLB API`);
    
    // Filter out leagues (like NFL filters AFC/NFC)
    const mlbTeams = teams.filter(team => 
      !['American League', 'National League', 'AL', 'NL'].includes(team.name)
    );
    
    console.log(`📋 Filtered to ${mlbTeams.length} actual MLB teams`);
    
    const cachedTeams = mlbTeams.map(team => ({
      team_id: team.id,
      team_name: team.name,
      sport: 'MLB',
      season: 2023,
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
    }));
    
    if (cachedTeams.length > 0) {
      const { error } = await supabase
        .from('team_stats_cache')
        .upsert(cachedTeams, { onConflict: 'team_id,sport,season' });
      
      if (error) {
        console.log('❌ Error caching MLB teams:', error.message);
        return 0;
      } else {
        console.log(`✅ Successfully cached ${cachedTeams.length} MLB teams`);
        
        // Show sample teams
        console.log('Sample MLB teams cached:');
        cachedTeams.slice(0, 5).forEach(team => {
          console.log(`  ${team.team_name}`);
        });
      }
    }
    
    return cachedTeams.length;
  } catch (error) {
    console.log('❌ Error fetching MLB teams:', error.message);
    return 0;
  }
}

async function populateNHL() {
  console.log('🏒 Populating NHL teams from API-Sports...');
  
  try {
    const response = await axios.get('https://v1.hockey.api-sports.io/teams', {
      headers: {
        'X-RapidAPI-Key': process.env.APISPORTS_API_KEY,
        'X-RapidAPI-Host': 'v1.hockey.api-sports.io'
      },
      params: {
        league: 57, // NHL league ID
        season: 2023
      }
    });
    
    const teams = response.data.response || [];
    console.log(`📋 Found ${teams.length} NHL teams from API`);
    
    const cachedTeams = teams.map(team => ({
      team_id: team.id,
      team_name: team.name,
      sport: 'NHL',
      season: 2023,
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
    }));
    
    if (cachedTeams.length > 0) {
      const { error } = await supabase
        .from('team_stats_cache')
        .upsert(cachedTeams, { onConflict: 'team_id,sport,season' });
      
      if (error) {
        console.log('❌ Error caching NHL teams:', error.message);
        return 0;
      } else {
        console.log(`✅ Successfully cached ${cachedTeams.length} NHL teams`);
      }
    }
    
    return cachedTeams.length;
  } catch (error) {
    console.log('❌ Error fetching NHL teams:', error.message);
    return 0;
  }
}

async function populateNBAFallback() {
  console.log('🏀 Populating NBA teams using fallback list...');
  
  const cachedTeams = NBA_TEAMS_FALLBACK.map(team => ({
    team_id: team.id,
    team_name: team.name,
    sport: 'NBA',
    season: 2023,
    stats: {
      team_info: {
        id: team.id,
        name: team.name,
        logo: null,
        code: team.code
      },
      games: { played: 0, wins: 0, losses: 0 },
      points: { for: 0, against: 0 }
    },
    last_updated: new Date().toISOString()
  }));
  
  const { error } = await supabase
    .from('team_stats_cache')
    .upsert(cachedTeams, { onConflict: 'team_id,sport,season' });
  
  if (error) {
    console.log('❌ Error caching NBA teams:', error.message);
    return 0;
  } else {
    console.log(`✅ Successfully cached ${cachedTeams.length} NBA teams`);
    return cachedTeams.length;
  }
}

async function populateAllMajorSports() {
  console.log('🏆 Populating teams for all major sports (NBA, MLB, NHL)...');
  
  let totalAdded = 0;
  
  // MLB from API
  totalAdded += await populateMLB();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // NHL from API
  totalAdded += await populateNHL();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // NBA fallback (since API isn't working)
  totalAdded += await populateNBAFallback();
  
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
    
    console.log('\n📊 Complete team cache by sport:');
    const sortedSports = Object.entries(sportCounts).sort(([a], [b]) => a.localeCompare(b));
    sortedSports.forEach(([sport, count]) => {
      console.log(`   ${sport}: ${count} teams`);
    });
    console.log(`   Total: ${allTeams.length} teams across all sports`);
    console.log(`   Added this run: ${totalAdded} teams`);
  }
}

populateAllMajorSports().then(() => {
  console.log('\n✅ Major sports team population complete!');
  console.log('\nℹ️  Note: EPL can be added manually if needed for soccer betting');
  process.exit(0);
}).catch(error => {
  console.error('❌ Population failed:', error);
  process.exit(1);
});