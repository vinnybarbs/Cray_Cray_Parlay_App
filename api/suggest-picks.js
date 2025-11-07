const { MultiAgentCoordinator } = require('../lib/agents/coordinator.js');
const { logger } = require('../shared/logger.js');
const { supabase } = require('../lib/middleware/supabaseAuth.js');

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
      dateRange = 1,
      numLegs = 3 // Used to determine how many suggestions to return
    } = req.body;

    // Determine number of suggestions based on numLegs
    const numSuggestions = numLegs <= 3 ? 10 : Math.min(30, numLegs * 5);

    logger.info('Generating pick suggestions', {
      selectedSports,
      selectedBetTypes,
      riskLevel,
      dateRange,
      numSuggestions
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

    // Generate suggestions
    const result = await coordinator.generatePickSuggestions({
      sports: selectedSports,
      betTypes: selectedBetTypes,
      riskLevel,
      dateRange,
      numSuggestions,
      sportsbook: req.body.oddsPlatform || 'DraftKings'
    });

    const duration = Date.now() - startTime;
    
    logger.info('Pick suggestions generated', {
      count: result.suggestions?.length || 0,
      duration: `${duration}ms`
    });

    res.json({
      success: true,
      suggestions: result.suggestions,
      metadata: {
        requestedSuggestions: numSuggestions,
        returnedSuggestions: result.suggestions?.length || 0,
        sports: selectedSports,
        betTypes: selectedBetTypes,
        riskLevel,
        generatedAt: new Date().toISOString(),
        duration: `${duration}ms`
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
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

module.exports = { suggestPicksHandler };
