#!/usr/bin/env node

/**
 * Manually resolve college game results based on confirmed scores
 * Jacksonville State 30, UTEP 27
 * Bowling Green 21, Eastern Michigan 27  
 * Missouri State 21, Liberty 17
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://pcjhulzyqmhrhsrgvwvx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs';

const supabase = createClient(supabaseUrl, supabaseKey);

// Known game results from ESPN
const gameResults = {
  'Jacksonville State Gamecocks @ UTEP Miners': {
    awayScore: 30, // Jacksonville State won
    homeScore: 27,
    winner: 'away'
  },
  'Bowling Green Falcons @ Eastern Michigan Eagles': {
    awayScore: 21, 
    homeScore: 27, // Eastern Michigan won
    winner: 'home'
  },
  'Missouri State Bears @ Liberty Flames': {
    awayScore: 21, // Missouri State won
    homeScore: 17,
    winner: 'away'
  }
};

async function resolveCollegeGames() {
  try {
    console.log('🎯 Manually resolving college game results...\n');
    
    // Get college game legs that need resolution
    const { data: collegeLegs, error: fetchError } = await supabase
      .from('parlay_legs')
      .select('*')
      .eq('game_date', '2025-11-08')
      .eq('sport', 'NCAA')
      .eq('game_completed', false);
    
    if (fetchError) throw fetchError;
    
    console.log(`Found ${collegeLegs.length} college legs to resolve:\n`);
    
    for (const leg of collegeLegs) {
      const gameKey = `${leg.away_team} @ ${leg.home_team}`;
      const result = gameResults[gameKey];
      
      console.log(`🏈 ${gameKey}`);
      console.log(`   Bet Type: ${leg.bet_type}`);
      
      if (!result) {
        console.log(`   ❌ No result data found for this game`);
        continue;
      }
      
      console.log(`   Final Score: ${leg.away_team} ${result.awayScore}, ${leg.home_team} ${result.homeScore}`);
      
      let legResult = null;
      let actualValue = 0;
      let marginOfVictory = Math.abs(result.homeScore - result.awayScore);
      
      // Parse bet details
      let betDetails;
      try {
        betDetails = typeof leg.bet_details === 'string' 
          ? JSON.parse(leg.bet_details) 
          : leg.bet_details;
      } catch (e) {
        console.log(`   ❌ Could not parse bet details: ${leg.bet_details}`);
        continue;
      }
      
      // Determine outcome based on bet type
      if (leg.bet_type === 'Moneyline') {
        // Check which team was picked
        const pick = (betDetails.pick || betDetails.description || '').toLowerCase();
        
        if (pick.includes(leg.home_team.toLowerCase()) || pick.includes('utep') || pick.includes('eastern michigan') || pick.includes('liberty')) {
          // Home team was picked
          legResult = result.winner === 'home' ? 'won' : 'lost';
        } else if (pick.includes(leg.away_team.toLowerCase()) || pick.includes('jacksonville state') || pick.includes('bowling green') || pick.includes('missouri state')) {
          // Away team was picked  
          legResult = result.winner === 'away' ? 'won' : 'lost';
        }
        
        actualValue = result.homeScore - result.awayScore; // Positive = home wins
        
      } else if (leg.bet_type === 'Spread') {
        // Extract spread from bet details
        const pick = betDetails.pick || '';
        const spreadMatch = pick.match(/\(([\d.-]+)\)/);
        
        if (spreadMatch) {
          const spread = parseFloat(spreadMatch[1]);
          console.log(`   Spread: ${spread}`);
          
          // Determine which team was picked
          let isHomePick = pick.toLowerCase().includes(leg.home_team.toLowerCase());
          
          // Calculate result
          const scoreDiff = result.homeScore - result.awayScore;
          let adjustedDiff;
          
          if (isHomePick) {
            adjustedDiff = scoreDiff - spread; // Home team covers spread
          } else {
            adjustedDiff = -scoreDiff - spread; // Away team covers spread  
          }
          
          legResult = adjustedDiff > 0 ? 'won' : (adjustedDiff === 0 ? 'push' : 'lost');
          actualValue = adjustedDiff;
        }
        
      } else if (leg.bet_type === 'Total') {
        // Extract over/under from bet details
        const pick = betDetails.pick || betDetails.description || '';
        const totalMatch = pick.match(/(Over|Under)\s*\(([\d.]+)\)/i);
        
        if (totalMatch) {
          const isOver = totalMatch[1].toLowerCase() === 'over';
          const line = parseFloat(totalMatch[2]);
          const totalScore = result.homeScore + result.awayScore;
          
          console.log(`   ${isOver ? 'Over' : 'Under'} ${line}, Actual Total: ${totalScore}`);
          
          const diff = totalScore - line;
          legResult = isOver ? (diff > 0 ? 'won' : (diff === 0 ? 'push' : 'lost')) 
                            : (diff < 0 ? 'won' : (diff === 0 ? 'push' : 'lost'));
          actualValue = diff;
        }
      }
      
      if (legResult) {
        console.log(`   Result: ${legResult.toUpperCase()}`);
        
        // Update the leg in database
        const { error: updateError } = await supabase
          .from('parlay_legs')
          .update({
            game_completed: true,
            leg_result: legResult,
            actual_value: actualValue,
            margin_of_victory: marginOfVictory,
            resolved_at: new Date().toISOString()
          })
          .eq('id', leg.id);
        
        if (updateError) {
          console.log(`   ❌ Error updating leg: ${updateError.message}`);
        } else {
          console.log(`   ✅ Updated leg result: ${legResult}`);
        }
      } else {
        console.log(`   ❌ Could not determine leg result`);
      }
      
      console.log('');
    }
    
    console.log('\\n🔄 Now running parlay outcome calculation...');
    
    // Now run the parlay outcome checker to update the overall parlays
    const response = await fetch('https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/check-parlay-outcomes', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    
    const parlayResult = await response.json();
    console.log('\\n📊 Parlay update result:', JSON.stringify(parlayResult, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

resolveCollegeGames();