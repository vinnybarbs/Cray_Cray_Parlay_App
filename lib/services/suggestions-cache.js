/**
 * AI Suggestions Cache Service
 * Manages caching of AI-generated pick suggestions to reduce token usage
 * and improve response times
 */

class SuggestionsCache {
  constructor(supabase) {
    this.supabase = supabase;
    this.CACHE_DURATION_HOURS = 1; // Cache expires after 1 hour
    this.ODDS_MOVEMENT_THRESHOLD = 0.10; // 10% odds change triggers refresh
  }

  /**
   * Get cache key for a request
   */
  getCacheKey(request) {
    const { sports, betTypes, riskLevel, dateRange } = request;
    const sport = sports[0]; // Primary sport
    const gameDate = this.getGameDate(dateRange);
    
    return {
      sport,
      game_date: gameDate,
      risk_level: riskLevel || 'medium'
    };
  }

  /**
   * Get game date for cache key
   */
  getGameDate(dateRange) {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }

  /**
   * Check if cached suggestions exist and are fresh
   */
  async getCached(request) {
    try {
      const cacheKey = this.getCacheKey(request);
      
      const { data, error } = await this.supabase
        .from('ai_suggestions_cache')
        .select('*')
        .eq('sport', cacheKey.sport)
        .eq('game_date', cacheKey.game_date)
        .eq('risk_level', cacheKey.risk_level)
        .gt('expires_at', new Date().toISOString())
        .order('generated_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !data) {
        console.log('📭 Cache miss - no cached suggestions found');
        return null;
      }

      // Update access metadata
      await this.supabase
        .from('ai_suggestions_cache')
        .update({
          accessed_count: data.accessed_count + 1,
          last_accessed_at: new Date().toISOString()
        })
        .eq('id', data.id);

      const age = Date.now() - new Date(data.generated_at).getTime();
      const ageMinutes = Math.floor(age / 1000 / 60);
      
      console.log(`✅ Cache hit! Returning ${data.suggestions.length} cached suggestions (${ageMinutes}min old)`);
      
      return {
        suggestions: data.suggestions,
        analyticalSummary: data.analytical_summary,
        cached: true,
        cacheAge: ageMinutes,
        generatedAt: data.generated_at
      };
    } catch (error) {
      console.error('Error checking cache:', error);
      return null;
    }
  }

  /**
   * Store suggestions in cache
   */
  async store(request, suggestions, analyticalSummary, oddsSnapshot) {
    try {
      const cacheKey = this.getCacheKey(request);
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + this.CACHE_DURATION_HOURS);

      const cacheEntry = {
        ...cacheKey,
        num_suggestions: suggestions.length,
        suggestions: suggestions,
        odds_snapshot: oddsSnapshot || {},
        analytical_summary: analyticalSummary,
        expires_at: expiresAt.toISOString()
      };

      // Upsert (insert or update if exists)
      const { error } = await this.supabase
        .from('ai_suggestions_cache')
        .upsert(cacheEntry, {
          onConflict: 'sport,game_date,risk_level'
        });

      if (error) {
        console.error('Error storing cache:', error);
        return false;
      }

      console.log(`💾 Cached ${suggestions.length} suggestions (expires in ${this.CACHE_DURATION_HOURS}h)`);
      return true;
    } catch (error) {
      console.error('Error storing cache:', error);
      return false;
    }
  }

  /**
   * Check if odds have moved significantly (for background refresh)
   */
  async checkOddsMovement(cachedOdds, currentOdds) {
    try {
      let significantMoves = 0;
      
      // Compare each game's odds
      for (const gameId in cachedOdds) {
        const cached = cachedOdds[gameId];
        const current = currentOdds[gameId];
        
        if (!current) continue;
        
        // Check spread/moneyline movements
        if (cached.spread && current.spread) {
          const movement = Math.abs(cached.spread - current.spread);
          if (movement >= this.ODDS_MOVEMENT_THRESHOLD * Math.abs(cached.spread)) {
            significantMoves++;
          }
        }
      }
      
      const movementPercentage = significantMoves / Object.keys(cachedOdds).length;
      return movementPercentage;
    } catch (error) {
      console.error('Error checking odds movement:', error);
      return 0;
    }
  }

  /**
   * Clear expired cache entries
   */
  async clearExpired() {
    try {
      const { error } = await this.supabase
        .rpc('cleanup_old_suggestions_cache');
        
      if (error) {
        console.error('Error clearing expired cache:', error);
        return false;
      }
      
      console.log('🗑️  Cleared expired cache entries');
      return true;
    } catch (error) {
      console.error('Error clearing expired cache:', error);
      return false;
    }
  }

  /**
   * Invalidate cache for a specific request (force refresh)
   */
  async invalidate(request) {
    try {
      const cacheKey = this.getCacheKey(request);
      
      const { error } = await this.supabase
        .from('ai_suggestions_cache')
        .delete()
        .eq('sport', cacheKey.sport)
        .eq('game_date', cacheKey.game_date)
        .eq('risk_level', cacheKey.risk_level);
        
      if (error) {
        console.error('Error invalidating cache:', error);
        return false;
      }
      
      console.log('🔄 Cache invalidated - will regenerate on next request');
      return true;
    } catch (error) {
      console.error('Error invalidating cache:', error);
      return false;
    }
  }
}

module.exports = { SuggestionsCache };
