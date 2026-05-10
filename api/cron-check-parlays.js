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
    // Match the secret-auth pattern used by other cron routes (pre-analyze-games,
    // backfill-game-results, sync-standings). Endpoint is otherwise public.
    if (process.env.CRON_SECRET) {
      const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
      if (cronSecret !== process.env.CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    logger.info('🎲 Starting automated outcome check...');
    
    // 1. Check user parlay outcomes
    const parlayChecker = new ParlayOutcomeChecker();
    const parlayResult = await parlayChecker.checkAllPendingParlays();
    
    logger.info(`✅ Parlay check complete: ${parlayResult.checked} checked, ${parlayResult.updated} updated`);
    
    // 2. Check AI suggestion outcomes (for model accuracy)
    // ?daysBack=N overrides the default 7-day lookback (used to sweep older
    // pending picks, e.g. props that were reverted from a previous bug).
    const daysBack = parseInt(req.query.daysBack, 10);
    const suggestionChecker = new AISuggestionOutcomeChecker();
    const suggestionResult = await suggestionChecker.checkAllPendingSuggestions(
      Number.isFinite(daysBack) && daysBack > 0 ? { daysBack } : {}
    );

    logger.info(`✅ AI suggestion check complete: ${suggestionResult.checked} checked, ${suggestionResult.updated} updated`);

    // 3. Refresh model-accuracy MV so admin/digest reflect what we just settled.
    //    Without this, the dashboard reads yesterday's snapshot and shows N/A
    //    for sports that just got their first decisions today.
    if (suggestionResult.updated > 0 || parlayResult.updated > 0) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const { error } = await sb.rpc('refresh_mv_model_accuracy');
        if (error) logger.warn('mv_model_accuracy refresh failed', { error: error.message });
        else logger.info('🔄 mv_model_accuracy refreshed');
      } catch (err) {
        logger.warn('mv_model_accuracy refresh threw', { error: err.message });
      }
    }

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
