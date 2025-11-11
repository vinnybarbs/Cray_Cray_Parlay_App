const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Major FBS conferences and their teams
const FBS_TEAMS_BY_CONFERENCE = {
  'SEC': [
    'Alabama', 'Arkansas', 'Auburn', 'Florida', 'Georgia', 'Kentucky', 'LSU', 
    'Mississippi State', 'Missouri', 'Ole Miss', 'South Carolina', 'Tennessee', 
    'Texas A&M', 'Vanderbilt', 'Texas', 'Oklahoma'
  ],
  'Big Ten': [
    'Illinois', 'Indiana', 'Iowa', 'Maryland', 'Michigan', 'Michigan State', 
    'Minnesota', 'Nebraska', 'Northwestern', 'Ohio State', 'Penn State', 
    'Purdue', 'Rutgers', 'Wisconsin', 'Oregon', 'Washington', 'UCLA', 'USC'
  ],
  'Big 12': [
    'Baylor', 'Cincinnati', 'Houston', 'Iowa State', 'Kansas', 'Kansas State', 
    'Oklahoma State', 'TCU', 'Texas Tech', 'West Virginia', 'UCF', 'BYU'
  ],
  'ACC': [
    'Boston College', 'Clemson', 'Duke', 'Florida State', 'Georgia Tech', 
    'Louisville', 'Miami', 'NC State', 'North Carolina', 'Notre Dame', 
    'Pittsburgh', 'Syracuse', 'Virginia', 'Virginia Tech', 'Wake Forest',
    'California', 'Stanford', 'SMU'
  ],
  'Pac-12': [
    'Arizona', 'Arizona State', 'Colorado', 'Utah', 'Oregon State', 'Washington State'
  ],
  'Group of 5': [
    // AAC
    'East Carolina', 'Memphis', 'Navy', 'South Florida', 'Temple', 'Tulane', 'Tulsa', 'Army', 'Air Force',
    // Mountain West
    'Boise State', 'Colorado State', 'Fresno State', 'Hawaii', 'Nevada', 'New Mexico', 
    'San Diego State', 'San Jose State', 'UNLV', 'Utah State', 'Wyoming',
    // Sun Belt
    'Appalachian State', 'Arkansas State', 'Coastal Carolina', 'Georgia Southern', 
    'Georgia State', 'Louisiana', 'Louisiana Monroe', 'South Alabama', 'Texas State', 'Troy',
    // MAC
    'Akron', 'Ball State', 'Bowling Green', 'Buffalo', 'Central Michigan', 
    'Eastern Michigan', 'Kent State', 'Miami (OH)', 'Northern Illinois', 
    'Ohio', 'Toledo', 'Western Michigan',
    // Conference USA
    'Charlotte', 'FAU', 'FIU', 'Louisiana Tech', 'Middle Tennessee', 'North Texas', 
    'Old Dominion', 'Rice', 'UAB', 'UTEP', 'UTSA', 'Western Kentucky'
  ],
  'Independent': [
    'Liberty', 'New Mexico State', 'UConn', 'James Madison', 'Jacksonville State', 
    'Sam Houston State', 'Kennesaw State'
  ]
};

async function repopulateNCAAFWithFBS() {
  console.log('🏈 Re-populating NCAAF with FBS teams from API...');
  
  try {
    // First, let's get fresh data from API-Sports for NCAAF
    const API_KEY = process.env.API_SPORTS_KEY || process.env.APISPORTS_API_KEY || process.env.VITE_APISPORTS_API_KEY;
    if (!API_KEY) {
      console.error('❌ API-Sports key not found in environment');
      console.log('Available env vars:', Object.keys(process.env).filter(k => k.includes('API')));
      return;
    }
    
    console.log('🔑 Found API key:', API_KEY.substring(0, 8) + '...');
    
    console.log('📡 Fetching NCAAF teams from API-Sports...');
    
    const response = await fetch('https://v1.american-football.api-sports.io/teams?league=2&season=2023', {
      headers: {
        'X-RapidAPI-Key': API_KEY,
        'X-RapidAPI-Host': 'v1.american-football.api-sports.io'
      }
    });
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`📊 Received ${data.response?.length || 0} teams from API`);
    
    // Flatten FBS teams list for easier matching
    const allFBSTeams = Object.values(FBS_TEAMS_BY_CONFERENCE).flat();
    
    // Filter API teams to FBS only
    const fbsTeams = data.response.filter(apiTeam => {
      if (!apiTeam.name) return false;
      
      return allFBSTeams.some(fbsName => {
        const apiName = apiTeam.name.toLowerCase();
        const fbsNameLower = fbsName.toLowerCase();
        
        // Direct match
        if (apiName === fbsNameLower) return true;
        
        // Handle common variations
        if (apiName.includes(fbsNameLower) || fbsNameLower.includes(apiName)) return true;
        
        // Specific team name mappings
        const mappings = {
          'ole miss': ['mississippi'],
          'miami': ['miami hurricanes', 'university of miami'],
          'miami (oh)': ['miami redhawks', 'miami university'],
          'nc state': ['north carolina state'],
          'usc': ['southern california'],
          'ucf': ['central florida'],
          'smu': ['southern methodist'],
          'tcu': ['texas christian'],
          'byu': ['brigham young'],
          'uab': ['alabama birmingham'],
          'utep': ['texas el paso'],
          'utsa': ['texas san antonio'],
          'fau': ['florida atlantic'],
          'fiu': ['florida international']
        };
        
        for (const [key, variations] of Object.entries(mappings)) {
          if (fbsNameLower === key && variations.some(v => apiName.includes(v))) return true;
          if (variations.includes(fbsNameLower) && apiName.includes(key)) return true;
        }
        
        return false;
      });
    });
    
    console.log(`🎯 Filtered to ${fbsTeams.length} FBS teams`);
    
    // Format for database insertion
    const teamsForDB = fbsTeams.map(team => ({
      team_id: team.id,
      team_name: team.name,
      sport: 'NCAAF',
      season: 2025,
      stats: {
        games: { wins: 0, losses: 0, played: 0 },
        points: { for: 0, against: 0 },
        last_updated: new Date().toISOString(),
        api_source: 'api-sports-ncaaf',
        conference: 'FBS'
      },
      last_updated: new Date().toISOString()
    }));
    
    // Insert in batches to avoid timeout
    const batchSize = 20;
    let inserted = 0;
    
    for (let i = 0; i < teamsForDB.length; i += batchSize) {
      const batch = teamsForDB.slice(i, i + batchSize);
      
      const { error } = await supabase
        .from('team_stats_cache')
        .insert(batch);
        
      if (error) {
        console.error(`Error inserting batch ${i}: ${error.message}`);
        continue;
      }
      
      inserted += batch.length;
      console.log(`✅ Inserted batch ${Math.floor(i/batchSize) + 1}: ${batch.length} teams`);
    }
    
    console.log(`\n🎉 Successfully inserted ${inserted} FBS teams!`);
    
    // Show some examples
    console.log('\nSample FBS teams added:');
    teamsForDB.slice(0, 10).forEach(team => {
      console.log(`- ${team.team_name} (ID: ${team.team_id})`);
    });
    
    // Final verification
    const { count } = await supabase
      .from('team_stats_cache')
      .select('*', { count: 'exact', head: true })
      .eq('sport', 'NCAAF');
      
    console.log(`\n✅ Final NCAAF team count: ${count}`);
    
    return count;
    
  } catch (error) {
    console.error('❌ Error re-populating NCAAF teams:', error);
  }
}

repopulateNCAAFWithFBS().then(count => {
  console.log(`\n🏈 NCAAF re-population complete! Now have ${count} FBS teams (should be ~130)`);
}).catch(console.error);