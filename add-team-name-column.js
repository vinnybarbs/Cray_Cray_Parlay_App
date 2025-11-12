require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { supabase } = require('./lib/middleware/supabaseAuth.js');

async function addTeamNameColumn() {
  try {
    console.log('🔄 Updating players with team names using direct approach...');
    
    // Get all players with team_id but no team_name
    const { data: playersToUpdate, error: fetchError } = await supabase
      .from('players')
      .select('id, team_id, teams!inner(name)')
      .not('team_id', 'is', null);
    
    if (fetchError) {
      console.error('Error fetching players:', fetchError);
      return;
    }
    
    console.log(`Found ${playersToUpdate.length} players to update`);
    
    // Update players in batches
    let updated = 0;
    for (const player of playersToUpdate) {
      const { error: updateError } = await supabase
        .from('players')
        .update({ team_name: player.teams.name })
        .eq('id', player.id);
        
      if (!updateError) {
        updated++;
        if (updated % 100 === 0) {
          console.log(`Updated ${updated}/${playersToUpdate.length} players...`);
        }
      }
    }
    
    console.log(`✅ Updated ${updated} players with team names`);
    
    // Check results
    const { data: stats, error: statsError } = await supabase.from('players')
      .select('sport, team_name')
      .in('sport', ['nfl', 'nba', 'mlb']);
      
    if (!statsError) {
      const summary = stats.reduce((acc, p) => {
        if (!acc[p.sport]) acc[p.sport] = { total: 0, withTeam: 0 };
        acc[p.sport].total++;
        if (p.team_name) acc[p.sport].withTeam++;
        return acc;
      }, {});
      
      console.log('\n📊 Results:');
      Object.entries(summary).forEach(([sport, data]) => {
        const pct = Math.round((data.withTeam / data.total) * 100);
        console.log(`${sport.toUpperCase()}: ${data.withTeam}/${data.total} players with team names (${pct}%)`);
      });
    }
    
  } catch (error) {
    console.error('Script error:', error);
  }
}

addTeamNameColumn();