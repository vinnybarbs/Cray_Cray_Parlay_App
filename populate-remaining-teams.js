require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Manual NBA teams (since API-Sports free tier doesn't provide them)
const NBA_TEAMS_MANUAL = [
  { id: 1, name: 'Atlanta Hawks', code: 'ATL' },
  { id: 2, name: 'Boston Celtics', code: 'BOS' },
  { id: 3, name: 'Brooklyn Nets', code: 'BKN' },
  { id: 4, name: 'Charlotte Hornets', code: 'CHA' },
  { id: 5, name: 'Chicago Bulls', code: 'CHI' },
  { id: 6, name: 'Cleveland Cavaliers', code: 'CLE' },
  { id: 7, name: 'Dallas Mavericks', code: 'DAL' },
  { id: 8, name: 'Denver Nuggets', code: 'DEN' },
  { id: 9, name: 'Detroit Pistons', code: 'DET' },
  { id: 10, name: 'Golden State Warriors', code: 'GSW' },
  { id: 11, name: 'Houston Rockets', code: 'HOU' },
  { id: 12, name: 'Indiana Pacers', code: 'IND' },
  { id: 13, name: 'LA Clippers', code: 'LAC' },
  { id: 14, name: 'Los Angeles Lakers', code: 'LAL' },
  { id: 15, name: 'Memphis Grizzlies', code: 'MEM' },
  { id: 16, name: 'Miami Heat', code: 'MIA' },
  { id: 17, name: 'Milwaukee Bucks', code: 'MIL' },
  { id: 18, name: 'Minnesota Timberwolves', code: 'MIN' },
  { id: 19, name: 'New Orleans Pelicans', code: 'NOP' },
  { id: 20, name: 'New York Knicks', code: 'NYK' },
  { id: 21, name: 'Oklahoma City Thunder', code: 'OKC' },
  { id: 22, name: 'Orlando Magic', code: 'ORL' },
  { id: 23, name: 'Philadelphia 76ers', code: 'PHI' },
  { id: 24, name: 'Phoenix Suns', code: 'PHX' },
  { id: 25, name: 'Portland Trail Blazers', code: 'POR' },
  { id: 26, name: 'Sacramento Kings', code: 'SAC' },
  { id: 27, name: 'San Antonio Spurs', code: 'SAS' },
  { id: 28, name: 'Toronto Raptors', code: 'TOR' },
  { id: 29, name: 'Utah Jazz', code: 'UTA' },
  { id: 30, name: 'Washington Wizards', code: 'WAS' }
];

// Manual EPL teams (since soccer API had connection issues)
const EPL_TEAMS_MANUAL = [
  { id: 33, name: 'Arsenal', code: 'ARS' },
  { id: 34, name: 'Aston Villa', code: 'AVL' },
  { id: 35, name: 'Bournemouth', code: 'BOU' },
  { id: 36, name: 'Brentford', code: 'BRE' },
  { id: 37, name: 'Brighton & Hove Albion', code: 'BHA' },
  { id: 38, name: 'Chelsea', code: 'CHE' },
  { id: 39, name: 'Crystal Palace', code: 'CRY' },
  { id: 40, name: 'Everton', code: 'EVE' },
  { id: 41, name: 'Fulham', code: 'FUL' },
  { id: 42, name: 'Liverpool', code: 'LIV' },
  { id: 43, name: 'Luton Town', code: 'LUT' },
  { id: 44, name: 'Manchester City', code: 'MCI' },
  { id: 45, name: 'Manchester United', code: 'MUN' },
  { id: 46, name: 'Newcastle United', code: 'NEW' },
  { id: 47, name: 'Nottingham Forest', code: 'NFO' },
  { id: 48, name: 'Sheffield United', code: 'SHU' },
  { id: 49, name: 'Tottenham Hotspur', code: 'TOT' },
  { id: 50, name: 'West Ham United', code: 'WHU' },
  { id: 51, name: 'Wolverhampton Wanderers', code: 'WOL' },
  { id: 52, name: 'Burnley', code: 'BUR' }
];

async function populateNHL() {
  console.log('🏒 Populating NHL teams...');
  
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

async function populateManualTeams(teams, sport, description) {
  console.log(`🏀 Populating ${teams.length} ${sport} teams manually (${description})...`);
  
  const cachedTeams = teams.map(team => ({
    team_id: team.id,
    team_name: team.name,
    sport: sport,
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
    console.log(`❌ Error caching ${sport} teams:`, error.message);
    return 0;
  } else {
    console.log(`✅ Successfully cached ${cachedTeams.length} ${sport} teams`);
    return cachedTeams.length;
  }
}

async function populateRemainingTeams() {
  console.log('🏆 Populating remaining teams for all sports...');
  
  let totalAdded = 0;
  
  // Populate NHL from API
  totalAdded += await populateNHL();
  
  // Small delay
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Populate NBA manually
  totalAdded += await populateManualTeams(NBA_TEAMS_MANUAL, 'NBA', 'National Basketball Association');
  
  // Populate EPL manually  
  totalAdded += await populateManualTeams(EPL_TEAMS_MANUAL, 'EPL', 'English Premier League');
  
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
    Object.entries(sportCounts).forEach(([sport, count]) => {
      console.log(`   ${sport}: ${count} teams`);
    });
    console.log(`   Total: ${allTeams.length} teams across all sports`);
    console.log(`   Added this run: ${totalAdded} teams`);
  }
}

populateRemainingTeams().then(() => {
  console.log('\n✅ Remaining sports team population complete!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Population failed:', error);
  process.exit(1);
});