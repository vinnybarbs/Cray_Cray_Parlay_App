/**
 * Cron endpoint to automatically check outcomes
 * Called daily by Supabase pg_cron
 * 
 * Checks TWO things:
 * 1. User Parlay Outcomes (parlay_legs table) - for user dashboard
 * 2. AI Suggestion Outcomes (ai_suggestions table) - for model accuracy tracking
 * 
 * URL: POST /api/cron/check-parlays
 */

const ParlayOutcomeChecker = require('../lib/services/parlay-outcome-checker');
const AISuggestionOutcomeChecker = require('../lib/services/ai-suggestion-outcome-checker');
const { logger } = require('../shared/logger');

async function cronCheckParlays(req, res) {
  try {
    logger.info('🎲 Starting automated outcome check...');
    
    // 1. Check user parlay outcomes
    const parlayChecker = new ParlayOutcomeChecker();
    const parlayResult = await parlayChecker.checkAllPendingParlays();
    
    logger.info(`✅ Parlay check complete: ${parlayResult.checked} checked, ${parlayResult.updated} updated`);
    
    // 2. Check AI suggestion outcomes (for model accuracy)
    const suggestionChecker = new AISuggestionOutcomeChecker();
    const suggestionResult = await suggestionChecker.checkAllPendingSuggestions();
    
    logger.info(`✅ AI suggestion check complete: ${suggestionResult.checked} checked, ${suggestionResult.updated} updated`);
    
    res.json({
      success: true,
      message: `Checked ${parlayResult.checked} parlays and ${suggestionResult.checked} AI suggestions`,
      timestamp: new Date().toISOString(),
      parlays: parlayResult,
      suggestions: suggestionResult
    });
    
  } catch (error) {
    logger.error('❌ Error in cron outcome check:', error);
    res.status(500).json({ 
      error: 'Failed to check outcomes',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = cronCheckParlays;
