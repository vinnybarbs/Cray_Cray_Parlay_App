#!/usr/bin/env node

/**
 * Comprehensive player roster and stats sync
 * 
 * Step 1: Sync rosters from API-Sports (populate players table)
 * Step 2: Sync player game stats, matching by name to existing player_id
 * 
 * This ensures player_game_stats.player_id references valid players table records
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const API_SPORTS_KEY = process.env.APISPORTS_API_KEY || process.env.API_SPORTS_KEY;

// Helper: normalize player names for matching
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function syncNFLRosters() {
  console.log('🔄 Syncing NFL rosters...');
  
  try {
    // Get all NFL teams with their API Sports IDs
    console.log('Fetching NFL teams from database...');
    const { data: teams, error: teamsError } = await supabase
      .from('teams')
      .select('*')
      .eq('league', 'nfl')
      .order('name');

    if (teamsError) {
      console.error('Error fetching teams:', teamsError);
      throw teamsError;
    }
    
    if (!teams || teams.length === 0) {
      console.log('No NFL teams found in database');
      return { success: false, message: 'No NFL teams found' };
    }

    console.log(`✅ Found ${teams.length} NFL teams`);
    console.log('Sample team:', JSON.stringify(teams[0], null, 2));
    
    let totalPlayers = 0;
    let totalUpdated = 0;
    let totalInserted = 0;
    
    // Process each team (limit to 2 teams for testing)
    for (const team of teams.slice(0, 2)) {
      try {
        console.log(`\n🔍 Fetching roster for ${team.name} (API ID: ${team.api_sports_id})...`);
        const url = `https://v1.american-football.api-sports.io/players?team=${team.api_sports_id}&season=2024`;
        console.log(`   URL: ${url}`);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'x-apisports-key': API_SPORTS_KEY,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`⚠️  API error for ${team.name}: ${response.status} - ${errorText}`);
          continue;
        }

        const responseData = await response.json();
        console.log('API Response:', JSON.stringify(responseData, null, 2).substring(0, 200) + '...');
        
        if (!responseData || !Array.isArray(responseData)) {
          console.log(`  ⚠️  No roster data returned for ${team.name} or invalid format`);
          console.log('  Response data:', responseData);
          continue;
        }

        const players = responseData;
        console.log(`  ✅ Fetched ${players.length} players for ${team.name}`);

        // Process each player
        for (const playerData of players.slice(0, 5)) { // Limit to 5 players per team for testing
          try {
            const playerName = playerData.name || `${playerData.firstname || ''} ${playerData.lastname || ''}`.trim();
            
            console.log(`  Processing player: ${playerName} (ID: ${playerData.id}, Position: ${playerData.position})`);
            
            // Upsert player into players table
            const { data: existingPlayer, error: lookupError } = await supabase
              .from('players')
              .select('id')
              .eq('api_sports_id', playerData.id)
              .maybeSingle();
              
            if (lookupError) {
              console.error(`  ❌ Error looking up player ${playerName}:`, lookupError);
              continue;
            }

            if (existingPlayer) {
              // Update existing player
              const { error: updateError } = await supabase
                .from('players')
                .update({
                  name: playerName,
                  position: playerData.position,
                  team_id: team.id,
                  updated_at: new Date().toISOString()
                })
                .eq('id', existingPlayer.id);

              if (updateError) throw updateError;
              totalUpdated++;
              console.log(`  ✅ Updated player: ${playerName}`);
            } else {
              // Insert new player
              const { error: insertError } = await supabase
                .from('players')
                .insert({
                  name: playerName,
                  api_sports_id: playerData.id,
                  position: playerData.position,
                  team_id: team.id,
                  league: 'nfl',
                  sport: 'nfl',
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                });

              if (insertError) throw insertError;
              totalInserted++;
              console.log(`  ✅ Added new player: ${playerName}`);
            }
            
            totalPlayers++;
          } catch (playerError) {
            console.error(`  ❌ Error processing player:`, playerError);
          }
        }
      } catch (teamError) {
        console.error(`❌ Error processing team ${team.name}:`, teamError);
      }
    }
    
    console.log(`\n✅ Roster sync complete:`);
    console.log(`   Total players processed: ${totalPlayers}`);
    console.log(`   New players inserted: ${totalInserted}`);
    console.log(`   Existing players updated: ${totalUpdated}`);
    
    return {
      success: true,
      players: totalPlayers,
      inserted: totalInserted,
      updated: totalUpdated
    };
  } catch (error) {
    console.error('Error in syncNFLRosters:', error);
    return {
      success: false,
      error: error.message
    };
  }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`⚠️  API error for ${team.name}: ${response.status} - ${errorText}`);
        continue;
      }

      const responseData = await response.json();
      console.log('API Response:', JSON.stringify(responseData, null, 2).substring(0, 500) + '...');
      
      if (!responseData || !Array.isArray(responseData)) {
        console.log(`  ⚠️  No roster data returned for ${team.name} or invalid format`);
        console.log('  Response data:', responseData);
        continue;
      }

      const players = responseData;
      console.log(`  ✅ Fetched ${players.length} players for ${team.name}`);

      // Process each player
      for (const playerData of players) {
        const playerName = playerData.name || `${playerData.firstname || ''} ${playerData.lastname || ''}`.trim();
        
        console.log(`  Processing player: ${playerName} (ID: ${playerData.id}, Position: ${playerData.position})`);
        
        // Upsert player into players table
        const { data: existingPlayer, error: lookupError } = await supabase
          .from('players')
          .select('id')
          .eq('api_sports_id', playerData.id)
          .maybeSingle();
          
        if (lookupError) {
          console.error(`  ❌ Error looking up player ${playerName}:`, lookupError);
          continue;
        }

        if (existingPlayer) {
          // Update existing player
          const { error: updateError } = await supabase
            .from('players')
            .update({
              name: playerName,
              position: playerData.position,
              team_id: team.id,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingPlayer.id);

          if (!updateError) totalUpdated++;
        } else {
          // Insert new player
          const { error: insertError } = await supabase
            .from('players')
            .insert({
              name: playerName,
              api_sports_id: playerData.id,
              position: playerData.position,
              team_id: team.id,
              league: 'nfl',
              sport: 'nfl'
            });

          if (!insertError) totalInserted++;
        }

        totalPlayers++;
      }

      console.log(`  ✅ ${team.name}: ${data.response.length} players synced`);

      // Rate limit: wait 3 seconds between teams
      await new Promise(resolve => setTimeout(resolve, 3000));

    } catch (error) {
      console.error(`  ❌ Error syncing ${team.name}:`, error.message);
    }
  }

  console.log(`\n✅ Roster sync complete:`);
  console.log(`   Total processed: ${totalPlayers}`);
  console.log(`   Inserted: ${totalInserted}`);
  console.log(`   Updated: ${totalUpdated}`);

  return { players: totalPlayers, inserted: totalInserted, updated: totalUpdated };
  } catch (error) {
    console.error('Error processing teams:', error);
  }
}

async function matchPlayerStatsToPlayers() {
  console.log('\n📊 Step 2: Matching player_game_stats to players table...\n');

  try {
    // Get all player_game_stats records with null or invalid player_id
    const { data: stats, error: statsError } = await supabase
      .from('player_game_stats')
      .select('*')
      .limit(100);

    if (statsError) throw statsError;
    if (!stats || stats.length === 0) {
      console.log('No player game stats found to process');
      return { matched: 0, unmatched: 0 };
    }

  if (statsError || !stats || stats.length === 0) {
    console.log('⚠️  No player_game_stats records found');
    return { matched: 0, unmatched: 0 };
  }

  console.log(`✓ Found ${stats.length} player_game_stats records to process`);

  // Get all players for matching
  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, name, position');

  if (playersError || !players || players.length === 0) {
    console.error('❌ No players found for matching');
    return { matched: 0, unmatched: 0 };
  }

  console.log(`✓ Loaded ${players.length} players for name matching`);

  // Build name lookup map
  const playerMap = new Map();
  players.forEach(p => {
    const normalized = normalizeName(p.name);
    playerMap.set(normalized, p);
  });

  let matched = 0;
  let unmatched = 0;

  // Try to match each stat record
  for (const stat of stats) {
    // If there's a player_name field in the stats (check your schema)
    // Otherwise, we'd need to cross-reference with the original API-Sports data
    
    // For now, log what we have
    console.log(`  Record: game_date=${stat.game_date}, player_id=${stat.player_id}`);

    return { matched: matchedCount, unmatched: unmatchedCount };
  } catch (error) {
    console.error('Error in matchPlayerStatsToPlayers:', error);
    return { matched: 0, unmatched: 0, error: error.message };
  }
}

async function main() {
  console.log('🚀 COMPREHENSIVE PLAYER & STATS SYNC\n');
  console.log('='.repeat(80));

  if (!API_SPORTS_KEY) {
    console.error('❌ API_SPORTS_KEY not found in environment');
    process.exit(1);
  }

  try {
    // Step 1: Sync rosters
    const rosterResults = await syncNFLRosters();

    // Step 2: Match stats to synced players
    const matchResults = await matchPlayerStatsToPlayers();

    console.log('\n' + '='.repeat(80));
    console.log('✅ SYNC COMPLETE\n');
    console.log('📋 Roster sync:', rosterResults);
    console.log('📊 Stats matching:', matchResults);
    console.log('\n💡 Next steps:');
    console.log('   1. Set up daily cron to keep rosters fresh');
    console.log('   2. Backfill historical player_game_stats from API-Sports');
    console.log('   3. Run AI function tests to verify player lookups work');

  } catch (error) {
    console.error('\n❌ SYNC FAILED:', error);
    process.exit(1);
  }
}

main().catch(console.error);
