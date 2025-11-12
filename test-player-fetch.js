require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { supabase } = require('./lib/middleware/supabaseAuth.js');

async function testPlayerFetch() {
  try {
    console.log('Testing simplified player data fetch...');
    
    const { data: players, error } = await supabase
      .from('players')
      .select(`
        name,
        sport,
        position,
        provider_ids,
        teams!inner(name)
      `)
      .in('sport', ['nfl'])
      .not('team_id', 'is', null)
      .limit(5); // Just test 5 players

    if (error) {
      console.error('Query error:', error);
      return;
    }

    console.log(`Found ${players.length} players:`);
    players.forEach(player => {
      const providerIds = JSON.parse(player.provider_ids || '{}');
      console.log(`- ${player.name} (${player.position}) - ${player.teams?.name || providerIds.team_name}`);
    });

  } catch (error) {
    console.error('Test error:', error);
  }
}

testPlayerFetch();