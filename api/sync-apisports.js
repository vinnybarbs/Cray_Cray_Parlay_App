/**
 * API-Sports Sync Endpoint
 * Triggers daily sync of NFL data
 * 
 * POST /api/sync-apisports
 */

const ApiSportsSync = require('../lib/services/apisports-sync');
const { logger } = require('../shared/logger');

/**
 * Sync API-Sports data
 */
async function syncApiSports(req, res) {
  try {
    logger.info('Starting API-Sports sync...');
    
    const sync = new ApiSportsSync();
    const { type = 'daily' } = req.query; // 'daily' or 'weekly'
    
    let results;
    if (type === 'weekly') {
      // Run weekly stats sync
      results = await sync.weeklySync(null, 1); // 1 = NFL
    } else {
      // Run daily sync (default)
      results = await sync.dailySync();
    }
    
    res.json({
      success: true,
      message: `API-Sports ${type} sync completed`,
      results: {
        standings: results.standings,
        injuries: results.injuries,
        apiCallsUsed: sync.apiClient.callCount,
        remaining: sync.apiClient.getRemainingCalls()
      },
      errors: results.errors
    });
    
  } catch (error) {
    logger.error('Error in syncApiSports:', error);
    res.status(500).json({ 
      error: 'Failed to sync API-Sports data',
      details: error.message 
    });
  }
}

/**
 * Get sync status
 * GET /api/sync-apisports/status
 */
async function getSyncStatus(req, res) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Get latest syncs
    const { data: syncs, error } = await supabase
      .from('apisports_sync_log')
      .select('*')
      .gte('sync_started_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('sync_started_at', { ascending: false })
      .limit(10);
    
    if (error) throw error;
    
    // Get data counts
    const { count: teamCount } = await supabase
      .from('teams')
      .select('*', { count: 'exact', head: true })
      .not('apisports_id', 'is', null);
    
    const { count: injuryCount } = await supabase
      .from('injuries')
      .select('*', { count: 'exact', head: true })
      .eq('is_current', true);
    
    const { count: standingsCount } = await supabase
      .from('standings')
      .select('*', { count: 'exact', head: true });
    
    res.json({
      success: true,
      status: {
        teamsInDatabase: teamCount,
        currentInjuries: injuryCount,
        standingsRecords: standingsCount,
        recentSyncs: syncs
      }
    });
    
  } catch (error) {
    logger.error('Error getting sync status:', error);
    res.status(500).json({ 
      error: 'Failed to get sync status',
      details: error.message 
    });
  }
}

module.exports = {
  syncApiSports,
  getSyncStatus
};
