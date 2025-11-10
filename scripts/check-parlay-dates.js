#!/usr/bin/env node

/**
 * Check the actual dates in our parlay data to understand the date issue
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://pcjhulzyqmhrhsrgvwvx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkParlayDates() {
  try {
    console.log('🔍 Checking actual parlay dates in database...\n');
    
    // Get all parlay legs with their dates
    const { data: legs, error } = await supabase
      .from('parlay_legs')
      .select('*')
      .order('game_date', { ascending: true });
    
    if (error) throw error;
    
    console.log(`Found ${legs.length} parlay legs:\n`);
    
    legs.forEach((leg, index) => {
      const gameDate = new Date(leg.game_date);
      console.log(`${index + 1}. ${leg.away_team} @ ${leg.home_team}`);
      console.log(`   Game Date: ${leg.game_date}`);
      console.log(`   Parsed Date: ${gameDate.toLocaleDateString()} ${gameDate.toLocaleTimeString()}`);
      console.log(`   Year: ${gameDate.getFullYear()}`);
      console.log(`   Bet Type: ${leg.bet_type}`);
      console.log(`   Bet Details: ${leg.bet_details}`);
      console.log(`   Game Completed: ${leg.game_completed}`);
      console.log(`   Leg Result: ${leg.leg_result}`);
      console.log('');
    });
    
    // Check what the ESPN date format should be for these dates
    console.log('🗓️ ESPN date formats needed:\n');
    
    const uniqueDates = [...new Set(legs.map(leg => leg.game_date.split('T')[0]))];
    uniqueDates.forEach(date => {
      const dateObj = new Date(date);
      const espnFormat = date.replace(/-/g, '');
      console.log(`${date} → ${espnFormat} (${dateObj.toLocaleDateString()})`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkParlayDates();