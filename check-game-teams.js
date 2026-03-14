const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkGameTeams() {
  console.log('Checking recent NCAAB games and their team stats...\n');
  
  // Get recent NCAAB games
  const { data: games, error } = await supabase
    .from('game_results')
    .select('*')
    .eq('sport', 'NCAAB')
    .order('date', { ascending: false })
    .limit(5);
  
  if (error) {
    console.error('Error fetching games:', error);
    return;
  }
  
  console.log(`Found ${games.length} recent NCAAB games:\n`);
  
  for (const game of games) {
    console.log(`🏀 ${game.date}: ${game.home_team_name} vs ${game.away_team_name}`);
    
    // Check home team stats
    const { data: homeStanding } = await supabase
      .from('standings')
      .select('wins, losses, season')
      .eq('team_id', (
        await supabase.from('teams').select('id').ilike('name', `%${game.home_team_name}%`).eq('sport', 'NCAAB').maybeSingle()
      ).data?.id)
      .maybeSingle();
    
    // Check away team stats  
    const { data: awayStanding } = await supabase
      .from('standings')
      .select('wins, losses, season')
      .eq('team_id', (
        await supabase.from('teams').select('id').ilike('name', `%${game.away_team_name}%`).eq('sport', 'NCAAB').maybeSingle()
      ).data?.id)
      .maybeSingle();
    
    console.log(`  Home: ${game.home_team_name} - ${homeStanding ? `${homeStanding.wins}-${homeStanding.losses}` : 'No data'}`);
    console.log(`  Away: ${game.away_team_name} - ${awayStanding ? `${awayStanding.wins}-${awayStanding.losses}` : 'No data'}`);
    console.log('');
  }
}

checkGameTeams();
