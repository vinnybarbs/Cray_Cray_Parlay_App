const express = require('express');
const { supabase } = require('../lib/middleware/supabaseAuth.js');

/**
 * Simple player props test endpoint
 * Just returns available players and their teams for validation
 */
async function testPlayerProps(req, res) {
  try {
    const { sport = 'nfl' } = req.query;
    
    console.log(`Testing player props for ${sport.toUpperCase()}`);
    
    // Get players with team info from provider_ids - fast query
    const { data: players, error: playersError } = await supabase
      .from('players')
      .select('name, sport, position, provider_ids')
      .eq('sport', sport.toLowerCase())
      .not('provider_ids', 'is', null)
      .limit(10);

    if (playersError) throw playersError;

        // Get sample prop odds for NFL players using Supabase
    const { data: propOdds, error: oddsError } = await supabase
      .from('odds_cache')
      .select('market_type, outcomes, bookmaker, home_team, away_team')
      .eq('sport', sport.toUpperCase())
      .ilike('market_type', '%player%')
      .limit(5);

    const response = {
      success: true,
      sport: sport.toUpperCase(),
      playersWithTeams: players.length,
      totalPlayers: players.map(p => {
        const providerIds = JSON.parse(p.provider_ids || '{}');
        return {
          name: p.name,
          position: p.position,
          team: providerIds.team_name || 'Unknown'
        };
      }),
      propOddsAvailable: propOdds.length,
      samplePropMarkets: [...new Set(propOdds.map(o => o.market_type))],
      message: `✅ Found ${players.length} ${sport.toUpperCase()} players with team mappings and ${propOdds.length} prop betting markets available`
    };

    res.json(response);

  } catch (error) {
    console.error('Error testing player props:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

module.exports = testPlayerProps;