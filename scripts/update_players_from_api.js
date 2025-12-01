import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const API_SPORTS_KEY = process.env.API_SPORTS_KEY || process.env.APISPORTS_API_KEY;

async function fetchAllPlayers() {
  console.log('🔄 Fetching all players from API-Sports...');
  
  try {
    const response = await fetch('https://v1.american-football.api-sports.io/players?season=2024', {
      headers: {
        'x-apisports-key': API_SPORTS_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('📊 API Response:', JSON.stringify(data, null, 2).substring(0, 500) + '...');
    
    // Handle different possible response formats
    if (data && Array.isArray(data)) {
      return data;
    } else if (data.response && Array.isArray(data.response)) {
      return data.response;
    } else if (data.data && Array.isArray(data.data)) {
      return data.data;
    } else {
      console.warn('⚠️  Unexpected API response format, trying to find players array...');
      // Try to find any array that might contain players
      for (const key in data) {
        if (Array.isArray(data[key])) {
          console.log(`Found array in response.${key} with ${data[key].length} items`);
          return data[key];
        }
      }
      throw new Error('Could not find players array in response');
    }
  } catch (error) {
    console.error('❌ Error fetching players:', error.message);
    throw error;
  }
}

async function updatePlayers(players) {
  console.log(`\n🔄 Processing ${players.length} players...`);
  
  const BATCH_SIZE = 50;
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE);
    console.log(`\nProcessing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(players.length/BATCH_SIZE)} (${i+1}-${Math.min(i+BATCH_SIZE, players.length)})`);
    
    const updates = batch
      .filter(player => player && player.id) // Only include valid players with IDs
      .map(player => {
        const playerName = player.name || [player.firstname, player.lastname].filter(Boolean).join(' ');
        return {
          name: playerName,
          api_sports_id: player.id,
          position: player.position || 'Unknown',
          team_id: null, // We'll update team mapping separately
          league: 'nfl',
          sport: 'nfl',
          updated_at: new Date().toISOString()
        };
      });
    
    if (updates.length === 0) {
      console.log('  No valid players in this batch');
      continue;
    }
    
    try {
      const { data, error } = await supabase
        .from('players')
        .upsert(updates, { onConflict: 'api_sports_id' });
        
      if (error) throw error;
      
      console.log(`  ✅ Successfully processed ${updates.length} players`);
      successCount += updates.length;
    } catch (error) {
      console.error(`  ❌ Error processing batch:`, error.message);
      errorCount += updates.length;
      
      // Log the first error details for debugging
      if (errorCount === updates.length) { // Only log once per batch
        console.error('  Error details:', JSON.stringify({
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        }, null, 2));
      }
    }
    
    // Be nice to the API and database
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n📊 Results:');
  console.log(`  ✅ Successfully processed: ${successCount} players`);
  console.log(`  ❌ Errors: ${errorCount} players`);
  
  return { success: errorCount === 0, successCount, errorCount };
}

async function main() {
  if (!API_SPORTS_KEY) {
    console.error('❌ Error: API_SPORTS_KEY or APISPORTS_API_KEY environment variable is required');
    process.exit(1);
  }
  
  console.log('🚀 Starting player data sync from API-Sports');
  console.log('='.repeat(60));
  
  try {
    // First, check the current player count
    const { count: currentCount } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true });
    
    console.log(`📊 Current players in database: ${currentCount}`);
    
    // Fetch players from API
    const players = await fetchAllPlayers();
    console.log(`\n🎉 Successfully fetched ${players.length} players from API-Sports`);
    
    // Filter out any players without an ID
    const validPlayers = players.filter(p => p && p.id);
    console.log(`  - Valid players with ID: ${validPlayers.length}`);
    
    if (validPlayers.length > 0) {
      console.log('\n🔄 Updating database...');
      await updatePlayers(validPlayers);
    } else {
      console.log('\n⚠️  No valid players to update');
    }
    
    // Get updated count
    const { count: updatedCount } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true });
    
    console.log('\n' + '='.repeat(60));
    console.log('🏁 Sync complete!');
    console.log(`📈 Players before: ${currentCount}`);
    console.log(`📈 Players after: ${updatedCount}`);
    console.log(`📈 New players added: ${updatedCount - currentCount}`);
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the sync
main().catch(error => {
  console.error('\n❌ Unhandled error in main:', error);
  process.exit(1);
});
