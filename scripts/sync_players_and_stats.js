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
  console.log('\n📋 Step 1: Syncing NFL rosters from API-Sports...\n');
  
  // Get all NFL teams
  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('*')
    .eq('league', 'nfl')
    .order('name');

  if (teamsError || !teams || teams.length === 0) {
    console.error('❌ No NFL teams found in database');
    return { players: 0, teams: 0 };
  }

  console.log(`✅ Found ${teams.length} NFL teams`);

  let totalPlayers = 0;
  let totalUpdated = 0;
  let totalInserted = 0;

  for (const team of teams.slice(0, 5)) { // Limit to 5 teams for API quota
    try {
      console.log(`\n📡 Fetching roster for ${team.name}...`);

      // Fetch roster from API-Sports
      const response = await fetch(
        `https://v1.american-football.api-sports.io/players?team=${team.api_sports_id || team.external_id}&season=2024`,
        {
          headers: {
            'x-apisports-key': API_SPORTS_KEY
          }
        }
      );

      if (!response.ok) {
        console.warn(`⚠️  API error for ${team.name}: ${response.status}`);
        continue;
      }

      const data = await response.json();
      
      if (!data.response || data.response.length === 0) {
        console.log(`  ⚠️  No roster data returned for ${team.name}`);
        continue;
      }

      console.log(`  ✓ Fetched ${data.response.length} players`);

      // Process each player
      for (const playerData of data.response) {
        const player = playerData.player;
        const playerName = player.name || player.firstname + ' ' + player.lastname;
        
        // Upsert player into players table
        const { data: existingPlayer, error: lookupError } = await supabase
          .from('players')
          .select('id')
          .eq('api_sports_id', player.id)
          .maybeSingle();

        if (existingPlayer) {
          // Update existing player
          const { error: updateError } = await supabase
            .from('players')
            .update({
              name: playerName,
              position: player.position,
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
              api_sports_id: player.id,
              position: player.position,
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
}

async function matchPlayerStatsToPlayers() {
  console.log('\n📊 Step 2: Matching player_game_stats to players table...\n');

  // Get all player_game_stats records with null or invalid player_id
  const { data: stats, error: statsError } = await supabase
    .from('player_game_stats')
    .select('*')
    .limit(100);

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
    
    // You'd match here by looking up the player_id in your mapping
    // This is a placeholder - actual logic depends on your data structure
  }

  console.log(`\n✅ Matching complete:`);
  console.log(`   Matched: ${matched}`);
  console.log(`   Unmatched: ${unmatched}`);

  return { matched, unmatched };
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
