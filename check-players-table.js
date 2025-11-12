const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkPlayersTable() {
  console.log('🔍 Checking players table...\n');

  // Check total players
  const { count: totalPlayers } = await supabase
    .from('players')
    .select('*', { count: 'exact', head: true });

  console.log(`📊 Total players in database: ${totalPlayers || 0}`);

  if (totalPlayers === 0) {
    console.log('❌ Players table is EMPTY');
    
    // Check if table exists and structure
    const { data: tableInfo, error } = await supabase
      .from('players')
      .select('*')
      .limit(1);
    
    if (error) {
      console.log('❌ Error accessing players table:', error.message);
    } else {
      console.log('✅ Players table exists but is empty');
    }
    
    return;
  }

  // Show breakdown by sport
  const { data: playersBySport, error: sportError } = await supabase
    .rpc('get_players_by_sport', {});

  if (!sportError && playersBySport) {
    console.log('\n📈 Players by sport:');
    playersBySport.forEach(sport => {
      console.log(`   ${sport.sport}: ${sport.count} players`);
    });
  } else {
    // Fallback query
    const { data: players } = await supabase
      .from('players')
      .select('sport')
      .then(response => {
        if (response.error) return response;
        
        const counts = {};
        response.data.forEach(player => {
          counts[player.sport] = (counts[player.sport] || 0) + 1;
        });
        
        return { data: Object.entries(counts).map(([sport, count]) => ({ sport, count })) };
      });

    if (players) {
      console.log('\n📈 Players by sport:');
      players.forEach(sport => {
        console.log(`   ${sport.sport}: ${sport.count} players`);
      });
    }
  }

  // Sample of recent players
  const { data: samplePlayers } = await supabase
    .from('players')
    .select('name, sport, position, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (samplePlayers && samplePlayers.length > 0) {
    console.log('\n👥 Recent players:');
    samplePlayers.forEach(player => {
      console.log(`   ${player.sport.toUpperCase()} - ${player.name} (${player.position}) - ${new Date(player.created_at).toLocaleDateString()}`);
    });
  }

  // Check if any have provider_ids (ESPN data)
  const { data: playersWithIds } = await supabase
    .from('players')
    .select('name, sport, provider_ids')
    .not('provider_ids', 'is', null)
    .limit(5);

  if (playersWithIds && playersWithIds.length > 0) {
    console.log('\n🔗 Players with ESPN provider IDs:');
    playersWithIds.forEach(player => {
      console.log(`   ${player.name} (${player.sport}) - ${JSON.stringify(player.provider_ids)}`);
    });
  }
}

checkPlayersTable().catch(console.error);