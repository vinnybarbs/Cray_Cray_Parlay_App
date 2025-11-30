/**
 * Cron endpoint to automatically check parlay outcomes
 * Called daily by Supabase pg_cron
 * 
 * URL: POST /api/cron/check-parlays
 */

const ParlayOutcomeChecker = require('../lib/services/parlay-outcome-checker');
const { logger } = require('../shared/logger');

async function cronCheckParlays(req, res) {
  try {
    logger.info('🎲 Starting automated parlay outcome check...');
    
    const checker = new ParlayOutcomeChecker();
    const result = await checker.checkAllPendingParlays();
    
    logger.info(`✅ Parlay check complete: ${result.checked} checked, ${result.updated} updated`);
    
    res.json({
      success: true,
      message: `Checked ${result.checked} parlays, updated ${result.updated}`,
      timestamp: new Date().toISOString(),
      ...result
    });
    
  } catch (error) {
    logger.error('❌ Error in cron parlay check:', error);
    res.status(500).json({ 
      error: 'Failed to check parlay outcomes',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = cronCheckParlays;
