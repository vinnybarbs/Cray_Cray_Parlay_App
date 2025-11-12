const { MultiAgentCoordinator } = require('../lib/agents/coordinator.js');
const { logger } = require('../shared/logger.js');
const { supabase } = require('../lib/middleware/supabaseAuth.js');
const { toMountainTime, formatGameTime, getCurrentMountainTime } = require('../lib/timezone-utils.js');

/**
 * Get essential player data for prop validation and anti-hallucination
 */
async function getPlayerDataForProps(sports) {
  try {
    // Ultra-simple query: just get player name, sport, position, and extract team from provider_ids
    const { data: players, error } = await supabase
      .from('players')
      .select('name, sport, position, provider_ids')
      .in('sport', sports.map(s => s.toLowerCase()))
      .not('provider_ids', 'is', null)
      .limit(500); // Limit for fast results

    if (error) throw error;

    // Extract team names from provider_ids JSON - fast and simple
    const playerData = players
      .map(player => {
        try {
          const providerIds = JSON.parse(player.provider_ids || '{}');
          const teamName = providerIds.team_name;
          
          if (!teamName) return null; // Skip players without team info
          
          return {
            name: player.name,
            sport: player.sport.toUpperCase(),
            position: player.position,
            team: teamName
          };
        } catch (e) {
          return null; // Skip players with invalid JSON
        }
      })
      .filter(Boolean); // Remove null entries

    logger.info('Retrieved player data for prop validation', {
      totalPlayers: playerData.length,
      bySport: playerData.reduce((acc, p) => {
        acc[p.sport] = (acc[p.sport] || 0) + 1;
        return acc;
      }, {})
    });

    return playerData;

  } catch (error) {
    logger.error('Error fetching player data for props', error);
    return [];
  }
}

/**
 * Suggest individual picks (not a full parlay)
 * Returns 10-30 independent betting suggestions based on user preferences
 */
async function suggestPicksHandler(req, res) {
  const startTime = Date.now();
  
  try {
    const {
      selectedSports = ['NFL'],
      selectedBetTypes = ['Moneyline/Spread'],
      riskLevel = 'Medium',
      dateRange = 2, // Default to 2 days to capture upcoming NFL games
      numLegs = 3 // Used to determine how many suggestions to return
    } = req.body;

    // Determine number of suggestions based on numLegs
    let numSuggestions = numLegs <= 3 ? 10 : Math.min(30, numLegs * 5);
    
    // Production optimization: reduce scope for faster responses
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      numSuggestions = Math.min(numSuggestions, 8); // Limit to 8 games max in production
    }

    logger.info('Generating pick suggestions', {
      selectedSports,
      selectedBetTypes,
      riskLevel,
      dateRange,
      numSuggestions,
      isProduction
    });

    // API keys
    const apiKeys = {
      odds: process.env.ODDS_API_KEY,
      serper: process.env.SERPER_API_KEY,
      openai: process.env.OPENAI_API_KEY
    };

    if (!apiKeys.odds || !apiKeys.openai) {
      logger.error('Missing required API keys');
      return res.status(500).json({ 
        error: 'Server configuration error',
        details: 'Missing required API keys'
      });
    }

    // Initialize coordinator with supabase for odds caching
    const fetcher = global.fetch || require('node-fetch');
    const coordinator = new MultiAgentCoordinator(
      fetcher,
      apiKeys,
      supabase // Pass supabase for odds caching
    );

    // Get player data for prop validation (prevent AI hallucinations)
    const playerData = await getPlayerDataForProps(selectedSports);
    console.log(`📊 Retrieved ${playerData.length} players for validation`);

    // Generate suggestions with player validation context
    const result = await coordinator.generatePickSuggestions({
      sports: selectedSports,
      betTypes: selectedBetTypes,
      riskLevel,
      dateRange,
      numSuggestions,
      sportsbook: req.body.oddsPlatform || 'DraftKings',
      playerContext: playerData // Simple validation data to prevent hallucinations
    });

    const duration = Date.now() - startTime;
    
    logger.info('Pick suggestions generated', {
      count: result.suggestions?.length || 0,
      duration: `${duration}ms`
    });

    res.json({
      success: true,
      suggestions: result.suggestions,
      timings: result.timings,
      phaseData: result.phaseData,
      metadata: {
        requestedSuggestions: numSuggestions,
        returnedSuggestions: result.suggestions?.length || 0,
        sports: selectedSports,
        betTypes: selectedBetTypes,
        riskLevel,
        generatedAt: new Date().toISOString(),
        generatedAtMT: getCurrentMountainTime(),
        duration: `${duration}ms`,
        
        // Add player context metadata
        playerDataStats: {
          totalPlayers: playerData.length,
          playersBySport: playerData.reduce((acc, p) => {
            acc[p.sport] = (acc[p.sport] || 0) + 1;
            return acc;
          }, {}),
          dataSource: 'ESPN API'
        }
      }
    });

  } catch (error) {
    logger.error('Error generating pick suggestions', {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      error: 'Failed to generate pick suggestions',
      details: error.message, // Always show error details for debugging
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

module.exports = { suggestPicksHandler };
