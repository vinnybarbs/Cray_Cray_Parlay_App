/**
 * CRON JOB: Refresh AI Suggestions Cache
 * Runs every 30 minutes to keep suggestions fresh
 * Regenerates cache if odds have moved significantly
 */

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { SuggestionsCache } = require('../../lib/services/suggestions-cache.js');

async function refreshSuggestionsCacheHandler(req, res) {
  const startTime = Date.now();
  
  try {
    // Verify cron secret for security
    const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
    if (cronSecret !== process.env.CRON_SECRET) {
      console.error('❌ Unauthorized cron request - invalid secret');
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Invalid cron secret' 
      });
    }

    console.log('\n🔄 CRON: Refreshing suggestions cache...');
    
    const cache = new SuggestionsCache(supabase);
    
    // Step 1: Clean up expired entries
    await cache.clearExpired();
    
    // Step 2: Get all active cache entries
    const { data: activeCache, error } = await supabase
      .from('ai_suggestions_cache')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .order('generated_at', { ascending: true });
      
    if (error) {
      throw new Error(`Failed to fetch active cache: ${error.message}`);
    }
    
    if (!activeCache || activeCache.length === 0) {
      console.log('📭 No active cache entries found');
      return res.json({
        success: true,
        message: 'No cache entries to refresh',
        duration: Date.now() - startTime
      });
    }
    
    console.log(`📊 Found ${activeCache.length} active cache entries`);
    
    // Step 3: Check each cache entry for staleness
    let refreshed = 0;
    let skipped = 0;
    
    for (const entry of activeCache) {
      const age = Date.now() - new Date(entry.generated_at).getTime();
      const ageMinutes = Math.floor(age / 1000 / 60);
      
      // Only refresh if older than 30 minutes
      if (ageMinutes < 30) {
        console.log(`⏭️  Skipping ${entry.sport} ${entry.risk_level} (${ageMinutes}min old)`);
        skipped++;
        continue;
      }
      
      console.log(`♻️  Refreshing ${entry.sport} ${entry.risk_level} (${ageMinutes}min old)`);
      
      // Invalidate this entry - will regenerate on next user request
      await cache.invalidate({
        sports: [entry.sport],
        betTypes: entry.bet_types,
        riskLevel: entry.risk_level,
        dateRange: 1
      });
      
      refreshed++;
    }
    
    const duration = Date.now() - startTime;
    
    console.log(`✅ Cache refresh complete: ${refreshed} invalidated, ${skipped} skipped (${duration}ms)`);
    
    res.json({
      success: true,
      refreshed,
      skipped,
      total: activeCache.length,
      duration
    });
    
  } catch (error) {
    console.error('❌ Error refreshing cache:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

module.exports = refreshSuggestionsCacheHandler;
