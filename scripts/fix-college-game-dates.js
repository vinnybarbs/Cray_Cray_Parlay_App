#!/usr/bin/env node

/**
 * Update college game dates from Nov 7 to Nov 8, 2025
 * The college games actually played on Nov 8, not Nov 7
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://pcjhulzyqmhrhsrgvwvx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs';

const supabase = createClient(supabaseUrl, supabaseKey);

async function updateCollegeGameDates() {
  try {
    console.log('🔄 Updating college game dates from Nov 7 to Nov 8, 2025...\n');
    
    // Get all college games on Nov 7
    const { data: collegeLegs, error: fetchError } = await supabase
      .from('parlay_legs')
      .select('*')
      .eq('game_date', '2025-11-07')
      .in('sport', ['NCAA', 'NCAAF', 'College Football']);
    
    if (fetchError) throw fetchError;
    
    console.log(`Found ${collegeLegs.length} college game legs to update:\n`);
    
    collegeLegs.forEach((leg, index) => {
      console.log(`${index + 1}. ${leg.away_team} @ ${leg.home_team}`);
      console.log(`   Current date: ${leg.game_date}`);
      console.log(`   Bet type: ${leg.bet_type}`);
    });
    
    if (collegeLegs.length === 0) {
      console.log('✅ No college games to update');
      return;
    }
    
    console.log('\n🔄 Updating dates to 2025-11-08...\n');
    
    // Update all college game dates to Nov 8
    const { data: updatedLegs, error: updateError } = await supabase
      .from('parlay_legs')
      .update({ game_date: '2025-11-08' })
      .eq('game_date', '2025-11-07')
      .in('sport', ['NCAA', 'NCAAF', 'College Football'])
      .select();
    
    if (updateError) throw updateError;
    
    console.log(`✅ Updated ${updatedLegs.length} college game dates to Nov 8, 2025\n`);
    
    updatedLegs.forEach((leg, index) => {
      console.log(`${index + 1}. ${leg.away_team} @ ${leg.home_team} → ${leg.game_date}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

updateCollegeGameDates();