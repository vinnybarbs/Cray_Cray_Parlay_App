#!/usr/bin/env node

/**
 * Check the exact format of bet_details for the college games
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://pcjhulzyqmhrhsrgvwvx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkBetDetails() {
  try {
    console.log('🔍 Checking bet_details format for college games...\n');
    
    const { data: legs, error } = await supabase
      .from('parlay_legs')
      .select('*')
      .eq('sport', 'NCAA')
      .eq('game_date', '2025-11-08');
    
    if (error) throw error;
    
    legs.forEach((leg, index) => {
      console.log(`${index + 1}. ${leg.away_team} @ ${leg.home_team}`);
      console.log(`   Bet Type: ${leg.bet_type}`);
      console.log(`   Bet Details (raw): ${leg.bet_details}`);
      
      try {
        const parsed = typeof leg.bet_details === 'string' 
          ? JSON.parse(leg.bet_details) 
          : leg.bet_details;
        console.log(`   Bet Details (parsed):`, parsed);
      } catch (e) {
        console.log(`   ❌ Could not parse bet_details`);
      }
      
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkBetDetails();