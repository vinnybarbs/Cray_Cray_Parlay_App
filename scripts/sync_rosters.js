import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const API_SPORTS_KEY = process.env.API_SPORTS_KEY || process.env.APISPORTS_API_KEY;

if (!API_SPORTS_KEY) {
  console.error('❌ Error: API_SPORTS_KEY or APISPORTS_API_KEY environment variable is required');
  process.exit(1);
}

async function syncTeamRoster(team) {
  console.log(`\n🔍 Fetching roster for ${team.name} (ID: ${team.api_sports_id})...`);
  
  try {
    const response = await fetch(
      `https://v1.american-football.api-sports.io/players?team=${team.api_sports_id}&season=2024`,
      {
        headers: {
          'x-apisports-key': API_SPORTS_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    
    if (!Array.isArray(data)) {
      throw new Error('Invalid response format: expected array of players');
    }

    console.log(`✅ Found ${data.length} players for ${team.name}`);
    
    let inserted = 0;
    let updated = 0;
    
    for (const playerData of data.slice(0, 10)) { // Limit to 10 players per team for testing
      const playerName = playerData.name || `${playerData.firstname || ''} ${playerData.lastname || ''}`.trim();
      
      if (!playerName) {
        console.warn('⚠️  Player missing name, skipping:', playerData);
        continue;
      }
      
      const player = {
        name: playerName,
        api_sports_id: playerData.id,
        position: playerData.position || 'Unknown',
        team_id: team.id,
        league: 'nfl',
        sport: 'nfl',
        updated_at: new Date().toISOString()
      };
      
      // Upsert player
      const { error } = await supabase
        .from('players')
        .upsert(
          { ...player, created_at: new Date().toISOString() },
          { onConflict: 'api_sports_id' }
        );
        
      if (error) {
        console.error(`❌ Error upserting player ${playerName}:`, error);
      } else {
        console.log(`  ${playerName} (${player.position}) - ${error ? '❌' : '✅'}`);
        error ? updated++ : inserted++;
      }
    }
    
    return { success: true, inserted, updated, total: data.length };
    
  } catch (error) {
    console.error(`❌ Error syncing ${team.name}:`, error.message);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('🚀 Starting NFL Roster Sync\n');
  
  // Get all NFL teams with API Sports IDs
  const { data: teams, error } = await supabase
    .from('teams')
    .select('*')
    .eq('league', 'nfl')
    .order('name')
    .limit(2); // Start with just 2 teams for testing
    
  if (error) {
    console.error('❌ Error fetching teams:', error);
    process.exit(1);
  }
  
  if (!teams || teams.length === 0) {
    console.log('ℹ️ No NFL teams found in database');
    process.exit(0);
  }
  
  console.log(`\n🏈 Found ${teams.length} NFL teams to process\n`);
  
  let totalInserted = 0;
  let totalUpdated = 0;
  
  // Process each team
  for (const team of teams) {
    if (!team.api_sports_id) {
      console.warn(`⚠️  Team ${team.name} is missing api_sports_id, skipping`);
      continue;
    }
    
    const result = await syncTeamRoster(team);
    
    if (result.success) {
      totalInserted += result.inserted || 0;
      totalUpdated += result.updated || 0;
    }
    
    // Be nice to the API
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n✅ Sync complete!');
  console.log(`📊 Total players inserted: ${totalInserted}`);
  console.log(`📊 Total players updated: ${totalUpdated}`);
  
  // Verify the results
  const { count: totalPlayers } = await supabase
    .from('players')
    .select('*', { count: 'exact', head: true });
    
  console.log(`\n🏁 Total players in database: ${totalPlayers}`);
}

// Run the sync
main().catch(error => {
  console.error('❌ Unhandled error in main:', error);
  process.exit(1);
});
