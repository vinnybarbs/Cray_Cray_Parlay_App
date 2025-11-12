const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugPlayerQuery() {
  console.log('🔍 Debugging the player query that suggest-picks is using...\n');

  // Test the EXACT query from suggest-picks.js
  console.log('1️⃣ Testing exact suggest-picks query with INNER JOIN:');
  const sports = ['NFL']; // This is what gets passed in
  
  const { data: playersWithTeams, error: withTeamsError } = await supabase
    .from('players')
    .select(`
      id,
      name,
      sport,
      position,
      provider_ids,
      teams!inner(name)
    `)
    .in('sport', sports.map(s => s.toLowerCase()));

  if (withTeamsError) {
    console.log('❌ Error with INNER JOIN query:', withTeamsError.message);
  } else {
    console.log(`✅ INNER JOIN query returned: ${playersWithTeams.length} players`);
  }

  // Test WITHOUT the INNER JOIN
  console.log('\n2️⃣ Testing query WITHOUT teams INNER JOIN:');
  
  const { data: playersWithoutTeams, error: withoutTeamsError } = await supabase
    .from('players')
    .select(`
      id,
      name,
      sport,
      position,
      provider_ids
    `)
    .in('sport', sports.map(s => s.toLowerCase()));

  if (withoutTeamsError) {
    console.log('❌ Error without INNER JOIN:', withoutTeamsError.message);
  } else {
    console.log(`✅ Query without INNER JOIN returned: ${playersWithoutTeams.length} players`);
  }

  // Check how many players have team_id
  console.log('\n3️⃣ Checking team_id mapping:');
  
  const { data: playersWithTeamId } = await supabase
    .from('players')
    .select('team_id')
    .in('sport', ['nfl'])
    .not('team_id', 'is', null);

  const { data: playersWithoutTeamId } = await supabase
    .from('players')
    .select('team_id')
    .in('sport', ['nfl'])
    .is('team_id', null);

  console.log(`📊 NFL players WITH team_id: ${playersWithTeamId?.length || 0}`);
  console.log(`📊 NFL players WITHOUT team_id: ${playersWithoutTeamId?.length || 0}`);

  // Sample of players without team_id
  if (playersWithoutTeamId && playersWithoutTeamId.length > 0) {
    console.log('\n4️⃣ Sample players WITHOUT team_id:');
    const { data: samplePlayers } = await supabase
      .from('players')
      .select('name, sport, position, team_id, provider_ids')
      .in('sport', ['nfl'])
      .is('team_id', null)
      .limit(5);

    samplePlayers?.forEach(player => {
      console.log(`   ${player.name} (${player.position}) - team_id: ${player.team_id}, provider_ids: ${player.provider_ids ? 'exists' : 'null'}`);
    });
  }
}

debugPlayerQuery().catch(console.error);