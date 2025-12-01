import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { setTimeout } from 'timers/promises';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const API_SPORTS_KEY = process.env.API_SPORTS_KEY || process.env.APISPORTS_API_KEY;
const API_BASE_URL = 'https://v1.american-football.api-sports.io';

// Rate limiting: 1 request per second
const RATE_LIMIT_DELAY = 1000;

async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'x-apisports-key': API_SPORTS_KEY,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 429 && i < retries - 1) {
          // Rate limited, wait and retry
          const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10) * 1000;
          console.log(`⚠️ Rate limited. Waiting ${retryAfter}ms before retry ${i + 1}/${retries}...`);
          await setTimeout(retryAfter);
          continue;
        }
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`⚠️ Attempt ${i + 1} failed, retrying...`, error.message);
      await setTimeout(delay * (i + 1)); // Exponential backoff
    }
  }
}

async function fetchNFLTeams() {
  console.log('🏈 Fetching NFL teams...');
  const data = await fetchWithRetry(`${API_BASE_URL}/teams?league=1&season=2024`);
  
  if (!data || !data.response || !Array.isArray(data.response)) {
    throw new Error('Unexpected response format from teams endpoint');
  }
  
  console.log(`✅ Found ${data.response.length} NFL teams`);
  return data.response;
}

async function fetchTeamRoster(teamId, teamName) {
  console.log(`\n🔍 Fetching roster for ${teamName} (ID: ${teamId})...`);
  
  const data = await fetchWithRetry(
    `${API_BASE_URL}/players?team=${teamId}&season=2024`
  );
  
  if (!data || !data.response || !Array.isArray(data.response)) {
    console.log(`⚠️  No players found for ${teamName} or unexpected format:`, JSON.stringify(data).substring(0, 200));
    return [];
  }
  
  console.log(`✅ Found ${data.response.length} players for ${teamName}`);
  return data.response.map(player => ({
    ...player,
    team_id: teamId,
    team_name: teamName
  }));
}

async function updatePlayers(players) {
  if (players.length === 0) return { success: true, count: 0 };
  
  console.log(`\n🔄 Processing ${players.length} players...`);
  const updates = players
    .map((row) => {
      // API-Sports typically wraps player info as { player: {...}, team: {...}, statistics: [...] }
      const p = row && (row.player || row);
      if (!p || !p.id) return null;

      const name =
        p.name ||
        [p.firstname, p.lastname].filter(Boolean).join(' ').trim();
      if (!name) return null;

      return {
        name,
        apisports_id: p.id,
        league: 'nfl',
        position: p.position || null,
        sport: 'nfl',
      };
    })
    .filter(Boolean);

  if (updates.length === 0) {
    console.log('⚠️  No valid players to update in this batch');
    return { success: true, count: 0 };
  }
  
  try {
    const { error } = await supabase
      .from('players')
      .upsert(updates, { onConflict: 'apisports_id,league' });
    
    if (error) throw error;
    
    console.log(`✅ Successfully updated ${updates.length} players`);
    return { success: true, count: updates.length };
  } catch (error) {
    console.error('❌ Error updating players:', error.message);
    return { success: false, error, count: 0 };
  }
}

async function main() {
  if (!API_SPORTS_KEY) {
    console.error('❌ Error: API_SPORTS_KEY or APISPORTS_API_KEY environment variable is required');
    process.exit(1);
  }
  
  console.log('🚀 Starting NFL player data sync');
  console.log('='.repeat(60));
  
  try {
    // Get current player count
    const { count: initialCount } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true });
    
    console.log(`📊 Current players in database: ${initialCount}`);
    
    // Get all NFL teams
    const teams = await fetchNFLTeams();
    if (teams.length === 0) {
      throw new Error('No teams found');
    }

    console.log('🔎 Sample team object from API:', JSON.stringify(teams[0], null, 2));
    
    // Process teams one by one with rate limiting
    let totalPlayersProcessed = 0;
    for (const t of teams) {
      const apiTeamId =
        (t.team && t.team.id) ??
        t.id ??
        t.team_id;
      const apiTeamName =
        (t.team && t.team.name) ??
        t.name ??
        'Unknown team';

      if (!apiTeamId) {
        console.warn('⚠️  Skipping team with missing id:', JSON.stringify(t));
        continue;
      }

      const players = await fetchTeamRoster(apiTeamId, apiTeamName);
      if (players.length > 0) {
        const result = await updatePlayers(players);
        if (result.success) {
          totalPlayersProcessed += result.count || 0;
        }
      }
      await setTimeout(RATE_LIMIT_DELAY); // Respect rate limits
    }
    
    // Get updated count
    const { count: finalCount } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true });
    
    console.log('\n' + '='.repeat(60));
    console.log('🏁 Sync complete!');
    console.log(`📈 Players before: ${initialCount}`);
    console.log(`📈 Players after: ${finalCount}`);
    console.log(`📈 Players processed: ${totalPlayersProcessed}`);
    
  } catch (error) {
    console.error('\n❌ Error during sync:', error.message);
    process.exit(1);
  }
}

// Run the sync
main().catch(error => {
  console.error('\n❌ Unhandled error in main:', error);
  process.exit(1);
});
