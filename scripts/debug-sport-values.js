#!/usr/bin/env node

/**
 * Debug what sport values are stored for the college games
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://pcjhulzyqmhrhsrgvwvx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs';

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugSportValues() {
  try {
    console.log('🔍 Checking sport values for all parlay legs...\n');
    
    // Get all parlay legs
    const { data: legs, error: fetchError } = await supabase
      .from('parlay_legs')
      .select('*')
      .order('game_date', { ascending: true });
    
    if (fetchError) throw fetchError;
    
    console.log(`Found ${legs.length} parlay legs:\n`);
    
    legs.forEach((leg, index) => {
      console.log(`${index + 1}. ${leg.away_team} @ ${leg.home_team}`);
      console.log(`   Sport: "${leg.sport}"`);
      console.log(`   Game Date: ${leg.game_date}`);
      console.log(`   Bet Type: ${leg.bet_type}`);
      console.log(`   Game Completed: ${leg.game_completed}`);
      console.log(`   Leg Result: ${leg.leg_result}`);
      console.log('');
    });
    
    // Show unique sport values
    const uniqueSports = [...new Set(legs.map(leg => leg.sport))];
    console.log('📊 Unique sport values found:', uniqueSports);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

debugSportValues();