#!/usr/bin/env node

// One-time migration: Convert all existing game dates from UTC to Mountain Time
// This fixes timezone issues where European/UTC dates caused games to appear on wrong days

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Convert UTC date to Mountain Time date string
 * @param {string} utcDateStr - UTC date string like "2025-11-08"
 * @returns {string} - MT date string like "2025-11-07"
 */
function convertToMountainTime(utcDateStr) {
  // Create a date object representing midnight UTC on the given date
  const utcDate = new Date(utcDateStr + 'T00:00:00.000Z');
  
  // Get what date it is in Mountain Time
  const mtDateStr = utcDate.toLocaleDateString('en-US', { 
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit', 
    day: '2-digit'
  });
  
  // Convert MM/DD/YYYY to YYYY-MM-DD
  const [month, day, year] = mtDateStr.split('/');
  return `${year}-${month}-${day}`;
}

async function migrateGameDates() {
  console.log('🔄 Starting game date migration to Mountain Time...');
  
  try {
    // Get all parlay legs with their current game dates
    const { data: legs, error: fetchError } = await supabase
      .from('parlay_legs')
      .select('id, game_date, home_team, away_team')
      .order('game_date', { ascending: false });

    if (fetchError) {
      throw new Error(`Error fetching parlay legs: ${fetchError.message}`);
    }

    console.log(`Found ${legs.length} parlay legs to process`);
    
    let updatedCount = 0;
    const updates = [];

    for (const leg of legs) {
      const originalDate = leg.game_date;
      const mtDate = convertToMountainTime(originalDate);
      
      if (originalDate !== mtDate) {
        updates.push({
          id: leg.id,
          originalDate,
          mtDate,
          game: `${leg.away_team} @ ${leg.home_team}`
        });
      }
    }

    console.log(`\\nFound ${updates.length} dates that need conversion:`);
    updates.forEach((update, i) => {
      console.log(`${i + 1}. ${update.game}`);
      console.log(`   ${update.originalDate} (UTC) → ${update.mtDate} (MT)`);
    });

    if (updates.length === 0) {
      console.log('✅ No dates need conversion - all already in correct format');
      return;
    }

    console.log(`\\n🔄 Updating ${updates.length} game dates...`);

    // Update each leg with the MT date
    for (const update of updates) {
      const { error: updateError } = await supabase
        .from('parlay_legs')
        .update({ game_date: update.mtDate })
        .eq('id', update.id);

      if (updateError) {
        console.error(`❌ Error updating leg ${update.id}:`, updateError.message);
      } else {
        updatedCount++;
      }
    }

    console.log(`\\n✅ Migration complete: ${updatedCount}/${updates.length} dates updated to Mountain Time`);
    
    // Verify the migration
    console.log('\\n🔍 Verifying migration...');
    const { data: verifyData } = await supabase
      .from('parlay_legs')
      .select('game_date, home_team, away_team')
      .in('id', updates.map(u => u.id))
      .limit(5);

    if (verifyData) {
      console.log('Sample updated dates:');
      verifyData.forEach((leg) => {
        const mtDateCheck = new Date(leg.game_date + 'T00:00:00.000Z');
        const mtDisplay = mtDateCheck.toLocaleDateString('en-US', { timeZone: 'America/Denver' });
        console.log(`  ${leg.away_team} @ ${leg.home_team}: ${leg.game_date} (displays as ${mtDisplay} in MT)`);
      });
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

// Run the migration
if (require.main === module) {
  migrateGameDates()
    .then(() => {
      console.log('\\n🎉 Game date migration completed successfully!');
      console.log('\\nNext steps:');
      console.log('1. Update parlay-tracker.js to store dates in MT going forward');  
      console.log('2. Test ESPN API matching with converted dates');
      console.log('3. Update dashboard to display times in MT');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { convertToMountainTime };