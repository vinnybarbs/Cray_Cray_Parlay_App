#!/usr/bin/env node

/**
 * Migrate old parlay picks from metadata JSON to ai_suggestions table
 * This enables:
 * - Auto-settlement of old parlays
 * - Model performance tracking
 * - User selection analysis
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ quiet: true });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function migrateOldParlays() {
  console.log('🔄 Starting migration of old parlays...\n');

  try {
    // Get all parlays with metadata.locked_picks
    const { data: parlays, error: fetchError } = await supabase
      .from('parlays')
      .select('*')
      .not('metadata', 'is', null);

    if (fetchError) throw fetchError;

    console.log(`📦 Found ${parlays.length} parlays with metadata`);

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const parlay of parlays) {
      try {
        const metadata = parlay.metadata || {};
        const lockedPicks = metadata.locked_picks || [];

        if (!lockedPicks.length) {
          console.log(`  ⏭️  Parlay ${parlay.id}: No locked_picks in metadata, skipping`);
          skippedCount++;
          continue;
        }

        // Check if already migrated
        const { data: existing, error: checkError } = await supabase
          .from('ai_suggestions')
          .select('id', { count: 'exact', head: true })
          .eq('parlay_id', parlay.id);

        if (checkError) throw checkError;

        if (existing && existing.length > 0) {
          console.log(`  ✅ Parlay ${parlay.id}: Already migrated (${existing.length} picks), skipping`);
          skippedCount++;
          continue;
        }

        console.log(`  🔧 Migrating parlay ${parlay.id} (${lockedPicks.length} picks)...`);

        // Convert locked_picks to ai_suggestions format
        const picksToInsert = lockedPicks.map((pick, index) => {
          // Handle different field name formats (camelCase vs snake_case)
          const gameDate = pick.gameDate || pick.game_date;
          const homeTeam = pick.homeTeam || pick.home_team;
          const awayTeam = pick.awayTeam || pick.away_team;
          const betType = pick.betType || pick.bet_type;

          return {
            parlay_id: parlay.id,
            user_id: parlay.user_id,
            session_id: `parlay_${parlay.id}`,
            sport: pick.sport || 'NFL',
            home_team: homeTeam,
            away_team: awayTeam,
            game_date: gameDate,
            bet_type: betType,
            pick: pick.pick,
            odds: pick.odds?.toString() || '+100',
            point: pick.point || pick.spread || null,
            confidence: pick.confidence || 7,
            reasoning: pick.reasoning || '',
            risk_level: parlay.risk_level || 'Medium',
            generate_mode: parlay.generate_mode || 'regular',
            actual_outcome: pick.result || 'pending',
            resolved_at: pick.result && pick.result !== 'pending' ? new Date().toISOString() : null,
            was_locked_by_user: true, // User explicitly locked this pick
            created_at: parlay.created_at,
            updated_at: new Date().toISOString()
          };
        });

        // Insert picks
        const { error: insertError } = await supabase
          .from('ai_suggestions')
          .insert(picksToInsert);

        if (insertError) {
          console.error(`  ❌ Error inserting picks for ${parlay.id}:`, insertError.message);
          errorCount++;
          continue;
        }

        console.log(`  ✅ Migrated ${picksToInsert.length} picks for parlay ${parlay.id}`);
        migratedCount++;

      } catch (error) {
        console.error(`  ❌ Error processing parlay ${parlay.id}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY:');
    console.log('='.repeat(60));
    console.log(`✅ Migrated: ${migratedCount} parlays`);
    console.log(`⏭️  Skipped: ${skippedCount} parlays (already migrated or no picks)`);
    console.log(`❌ Errors: ${errorCount} parlays`);
    console.log(`📦 Total processed: ${parlays.length} parlays`);

    // Show updated counts
    console.log('\n' + '='.repeat(60));
    console.log('📈 DATABASE STATE:');
    console.log('='.repeat(60));

    const { count: totalSuggestions } = await supabase
      .from('ai_suggestions')
      .select('*', { count: 'exact', head: true });

    const { count: lockedSuggestions } = await supabase
      .from('ai_suggestions')
      .select('*', { count: 'exact', head: true })
      .eq('was_locked_by_user', true);

    const { count: settledSuggestions } = await supabase
      .from('ai_suggestions')
      .select('*', { count: 'exact', head: true })
      .in('actual_outcome', ['won', 'lost', 'push']);

    console.log(`📝 Total AI suggestions: ${totalSuggestions}`);
    console.log(`🔒 Locked by users: ${lockedSuggestions}`);
    console.log(`✅ Settled outcomes: ${settledSuggestions}`);
    console.log(`⏳ Pending outcomes: ${totalSuggestions - settledSuggestions}`);

    console.log('\n✅ Migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

// Run migration
migrateOldParlays();
