/**
 * Background Research Cache
 * Proactively caches research for upcoming games
 * Refreshes periodically to keep data fresh
 */

const { createLogger } = require('../../shared/logger');
const logger = createLogger('BackgroundCache');

class BackgroundResearchCache {
  constructor(researchAgent) {
    this.researchAgent = researchAgent;
    this.cache = new Map();
    this.isRunning = false;
    this.refreshInterval = 30 * 60 * 1000; // Refresh every 30 minutes
    this.cacheWindow = 48 * 60 * 60 * 1000; // Cache games within 48 hours
  }

  /**
   * Start background caching process
   */
  start() {
    if (this.isRunning) {
      logger.warn('Background cache already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting background research cache');

    // Initial cache population
    this.refreshCache();

    // Set up periodic refresh
    this.intervalId = setInterval(() => {
      this.refreshCache();
    }, this.refreshInterval);
  }

  /**
   * Stop background caching
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Stopped background research cache');
  }

  /**
   * Refresh cache with latest game data
   */
  async refreshCache() {
    try {
      logger.info('Refreshing background cache...');
      const startTime = Date.now();

      // Get upcoming games from all major sports
      const sports = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF'];
      const allGames = [];

      for (const sport of sports) {
        try {
          const games = await this.fetchUpcomingGames(sport);
          allGames.push(...games);
        } catch (error) {
          logger.error(`Failed to fetch ${sport} games`, { error: error.message });
        }
      }

      logger.info(`Fetched ${allGames.length} upcoming games`);

      // Filter to games within cache window
      const now = Date.now();
      const relevantGames = allGames.filter(game => {
        const gameTime = new Date(game.commence_time).getTime();
        return gameTime > now && gameTime < now + this.cacheWindow;
      });

      logger.info(`${relevantGames.length} games within 48-hour window`);

      // Research games in batches (aggressive - we have 300 qps!)
      const batchSize = 20; // Process 20 games at a time
      let researched = 0;

      for (let i = 0; i < relevantGames.length; i += batchSize) {
        const batch = relevantGames.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (game) => {
            try {
              const research = await this.researchGame(game);
              this.cacheGame(game, research);
              researched++;
            } catch (error) {
              logger.error(`Failed to research game`, {
                game: `${game.away_team} @ ${game.home_team}`,
                error: error.message
              });
            }
          })
        );

        logger.info(`Researched ${researched}/${relevantGames.length} games`);
      }

      const duration = Date.now() - startTime;
      logger.info('Cache refresh complete', {
        gamesResearched: researched,
        durationMs: duration,
        cacheSize: this.cache.size
      });

    } catch (error) {
      logger.error('Cache refresh failed', { error: error.message });
    }
  }

  /**
   * Fetch upcoming games for a sport
   */
  async fetchUpcomingGames(sport) {
    // This would integrate with your odds agent
    // For now, return empty array
    // TODO: Integrate with OddsAgent
    return [];
  }

  /**
   * Research a single game
   */
  async researchGame(game) {
    const currentYear = new Date().getFullYear();
    const gameDate = new Date(game.commence_time).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });

    // Game-level research
    const gameQuery = `${game.away_team} vs ${game.home_team} ${currentYear} ${gameDate} injury report recent performance trends prediction`;
    const gameResearch = await this.researchAgent.performSerperSearch(gameQuery, { fastMode: false });

    // Player research if available
    const playerNames = this.researchAgent.extractPlayerNames(game);
    let playerResearch = null;

    if (playerNames.length > 0) {
      playerResearch = await this.researchAgent.researchPlayersDetailed(playerNames, game);
    }

    return {
      gameResearch,
      playerResearch,
      timestamp: Date.now()
    };
  }

  /**
   * Cache game research
   */
  cacheGame(game, research) {
    const key = this.getCacheKey(game);
    this.cache.set(key, {
      ...research,
      game,
      cachedAt: Date.now()
    });
  }

  /**
   * Get cached research for a game
   */
  getCachedResearch(game) {
    const key = this.getCacheKey(game);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if cache is stale (older than 30 minutes)
    const age = Date.now() - cached.cachedAt;
    if (age > this.refreshInterval) {
      logger.debug('Cache entry stale', { game: key, ageMinutes: age / 60000 });
      return null;
    }

    return cached;
  }

  /**
   * Generate cache key for a game
   */
  getCacheKey(game) {
    return `${game.away_team}_${game.home_team}_${game.commence_time}`.toLowerCase();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const now = Date.now();
    const entries = Array.from(this.cache.values());
    
    const fresh = entries.filter(e => now - e.cachedAt < this.refreshInterval).length;
    const stale = entries.length - fresh;

    return {
      totalEntries: entries.length,
      freshEntries: fresh,
      staleEntries: stale,
      isRunning: this.isRunning
    };
  }

  /**
   * Clear cache
   */
  clear() {
    this.cache.clear();
    logger.info('Cache cleared');
  }
}

module.exports = { BackgroundResearchCache };
