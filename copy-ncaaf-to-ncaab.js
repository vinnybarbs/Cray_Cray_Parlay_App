require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function copyNcaafToNcaab() {
  console.log('🏀 Copying NCAAF teams to NCAAB...');
  
  try {
    // Get all NCAAF teams from the cache
    const { data: ncaafTeams, error: fetchError } = await supabase
      .from('team_stats_cache')
      .select('*')
      .eq('sport', 'NCAAF')
      .order('team_id');

    if (fetchError) {
      console.log('❌ Error fetching NCAAF teams:', fetchError.message);
      return;
    }

    if (!ncaafTeams || ncaafTeams.length === 0) {
      console.log('❌ No NCAAF teams found to copy');
      return;
    }

    console.log(`📋 Found ${ncaafTeams.length} NCAAF teams to copy to NCAAB`);

    // Transform NCAAF teams to NCAAB teams
    const ncaabTeams = ncaafTeams.map(team => ({
      ...team,
      sport: 'NCAAB', // Change sport to basketball
      stats: {
        ...team.stats,
        team_info: {
          ...team.stats.team_info,
          // Keep same team ID and name since it's the same university
        },
        // Reset stats for basketball (different sport)
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
    }));

    console.log('📝 Sample NCAAB teams to be created:');
    ncaabTeams.slice(0, 5).forEach(team => {
      console.log(`   ID ${team.team_id}: ${team.team_name} (${team.sport})`);
    });

    // Insert NCAAB teams
    console.log('\n💾 Inserting NCAAB teams...');
    const { error: insertError } = await supabase
      .from('team_stats_cache')
      .upsert(ncaabTeams, { 
        onConflict: 'team_id,sport,season' 
      });

    if (insertError) {
      console.log('❌ Error inserting NCAAB teams:', insertError.message);
      return;
    }

    console.log('✅ Successfully copied all NCAAF teams to NCAAB');

    // Verify the results
    const { data: allTeams, error: countError } = await supabase
      .from('team_stats_cache')
      .select('sport')
      .order('team_id');

    if (!countError && allTeams) {
      const sportCounts = allTeams.reduce((acc, team) => {
        acc[team.sport] = (acc[team.sport] || 0) + 1;
        return acc;
      }, {});

      console.log('\n📊 Final team counts by sport:');
      Object.entries(sportCounts).forEach(([sport, count]) => {
        console.log(`   ${sport}: ${count} teams`);
      });
      
      console.log(`   Total: ${allTeams.length} teams`);
    }

    // Show some sample NCAAB teams
    const { data: sampleNcaab } = await supabase
      .from('team_stats_cache')
      .select('team_id, team_name, sport')
      .eq('sport', 'NCAAB')
      .order('team_id')
      .limit(10);

    if (sampleNcaab) {
      console.log('\n🏀 Sample NCAAB teams created:');
      sampleNcaab.forEach(team => {
        console.log(`   ID ${team.team_id}: ${team.team_name}`);
      });
    }

  } catch (error) {
    console.error('❌ Error copying teams:', error.message);
  }
}

copyNcaafToNcaab().then(() => {
  console.log('\n✅ NCAAB team copying complete!');
  process.exit(0);
}).catch(console.error);