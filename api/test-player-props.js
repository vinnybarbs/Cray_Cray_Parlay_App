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

        // Get sample prop odds for NFL/NBA players using Supabase
    // Look for player prop markets: player_anytime_td, player_assists, player_points, etc.
    const sportUpper = sport.toUpperCase();
    const sportKey = sportUpper === 'NFL' ? 'americanfootball_nfl' : 
                    sportUpper === 'NBA' ? 'basketball_nba' : 
                    sportUpper === 'MLB' ? 'baseball_mlb' : 
                    sportUpper === 'NHL' ? 'icehockey_nhl' : sport.toLowerCase();
    
    const { data: propOdds, error: oddsError } = await supabase
      .from('odds_cache')
      .select('market_type, outcomes, bookmaker, home_team, away_team')
      .eq('sport', sportKey)
      .ilike('market_type', 'player_%')
      .limit(10);

    if (oddsError) throw oddsError;

    const validPropOdds = propOdds || [];
    const uniqueMarkets = [...new Set(validPropOdds.map(o => o.market_type))];
    
    const response = {
      success: true,
      sport: sport.toUpperCase(),
      sportKey: sportKey,
      playersWithTeams: players.length,
      samplePlayers: players.slice(0, 3).map(p => {
        const providerIds = JSON.parse(p.provider_ids || '{}');
        return {
          name: p.name,
          position: p.position,
          team: providerIds.team_name || 'Unknown'
        };
      }),
      propOddsAvailable: validPropOdds.length,
      propMarketTypes: uniqueMarkets,
      samplePropMarkets: validPropOdds.slice(0, 2).map(odds => {
        try {
          const outcomes = typeof odds.outcomes === 'string' ? JSON.parse(odds.outcomes) : odds.outcomes;
          return {
            market: odds.market_type,
            bookmaker: odds.bookmaker,
            game: `${odds.away_team} @ ${odds.home_team}`,
            playerCount: Array.isArray(outcomes) ? outcomes.length : 0
          };
        } catch (e) {
          return {
            market: odds.market_type,
            bookmaker: odds.bookmaker,
            game: `${odds.away_team} @ ${odds.home_team}`,
            playerCount: 'Parse Error'
          };
        }
      }),
      message: `✅ Found ${players.length} ${sport.toUpperCase()} players with team mappings and ${validPropOdds.length} prop betting markets available (${uniqueMarkets.join(', ')})`
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