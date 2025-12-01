import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkPlayers() {
  console.log('🔍 Checking players table...');
  
  // Get a sample of players
  const { data: players, error } = await supabase
    .from('players')
    .select('id, name, position, team_id, api_sports_id, created_at')
    .limit(5);
    
  if (error) {
    console.error('❌ Error fetching players:', error);
    return;
  }
  
  console.log('\nSample of players in database:');
  console.table(players);
  
  // Check if api_sports_id is populated
  const { count: withApiId } = await supabase
    .from('players')
    .select('*', { count: 'exact', head: true })
    .not('api_sports_id', 'is', null);
    
  const { count: totalPlayers } = await supabase
    .from('players')
    .select('*', { count: 'exact', head: true });
    
  console.log(`\n📊 Players with api_sports_id: ${withApiId} of ${totalPlayers} (${Math.round((withApiId / totalPlayers) * 100)}%)`);
  
  // Check for duplicate api_sports_id
  const { data: duplicates } = await supabase
    .from('players')
    .select('api_sports_id, count')
    .not('api_sports_id', 'is', null)
    .group('api_sports_id')
    .gte('count', 2);
    
  console.log(`\n🔍 Found ${duplicates?.length || 0} duplicate api_sports_id values`);
}

checkPlayers().catch(console.error);
