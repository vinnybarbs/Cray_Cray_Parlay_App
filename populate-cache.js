const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

async function populateAPIStatsCache() {
  const apiKey = process.env.APISPORTS_API_KEY;
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  console.log('🏈 Populating API-Sports cache with 2024 NFL data...');
  
  if (!apiKey) {
    console.log('❌ No API key found');
    return;
  }

  try {
    // Get 2024 NFL standings (completed season)
    const standingsResponse = await axios.get('https://v1.american-football.api-sports.io/standings?league=1&season=2024', {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'v1.american-football.api-sports.io'
      },
      timeout: 15000
    });

    const standings = standingsResponse.data.response || [];
    console.log('✅ Found', standings.length, 'NFL teams for 2024 season');

    if (standings.length > 0) {
      // Store team stats for the first few teams
      let stored = 0;
      for (const team of standings.slice(0, 8)) { // Just first 8 teams to test
        if (team.team?.id) {
          console.log(`📊 Storing stats for ${team.team.name}...`);
          
          const { error } = await supabase
            .from('team_stats_cache')
            .upsert({
              sport: 'NFL',
              season: '2024',
              team_id: team.team.id.toString(),
              team_name: team.team.name,
              stats: {
                wins: team.won || 0,
                losses: team.lost || 0,
                ties: team.ties || 0,
                points_for: team.points?.for || 0,
                points_against: team.points?.against || 0,
                conference: team.group?.name || '',
                position: team.position || 0
              },
              last_updated: new Date().toISOString()
            }, {
              onConflict: 'sport,season,team_id'
            });

          if (!error) {
            stored++;
            console.log(`  ✅ Stored ${team.team.name}`);
          } else {
            console.log(`  ❌ Error storing ${team.team.name}:`, error.message);
          }
        }
        
        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      console.log(`🎉 Successfully stored ${stored} team records in team_stats_cache`);
      
      // Test reading back the data
      const { data: teamStats } = await supabase
        .from('team_stats_cache')
        .select('*')
        .eq('sport', 'NFL')
        .eq('season', '2024')
        .limit(5);
        
      console.log('\\n📋 Sample cached team data:');
      teamStats?.forEach(team => {
        console.log(`  ${team.team_name}: ${team.stats.wins}-${team.stats.losses} (${team.stats.points_for} PF, ${team.stats.points_against} PA)`);
      });
      
    } else {
      console.log('❌ No teams found in 2024 standings');
    }

  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
}

populateAPIStatsCache();