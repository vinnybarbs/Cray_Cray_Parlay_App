const NodeCache = require('node-cache');
const axios = require('axios');
const { logger } = require('../../shared/logger');

/**
 * Roster Cache Service
 * Fetches and caches player rosters from API-Sports to verify player-team assignments
 * Prevents AI hallucinations like "Stefon Diggs on Patriots" when he plays for Texans
 */
class RosterCache {
  constructor() {
    // Cache rosters for 7 days (604800 seconds)
    this.cache = new NodeCache({ 
      stdTTL: 604800,  // 7 days
      checkperiod: 86400  // Check for expired entries daily
    });
    this.apiKey = process.env.API_SPORTS_KEY;
    
    if (!this.apiKey) {
      logger.warn('⚠️ API_SPORTS_KEY not found in environment variables. Roster verification disabled.');
    }

    // Map sport names to API endpoints
    this.endpoints = {
      'NFL': 'https://v1.american-football.api-sports.io',
      'NCAAF': 'https://v1.american-football.api-sports.io',
      'NBA': 'https://v2.nba.api-sports.io'
    };

    // Map sport to API host for headers
    this.apiHosts = {
      'NFL': 'v1.american-football.api-sports.io',
      'NCAAF': 'v1.american-football.api-sports.io',
      'NBA': 'v2.nba.api-sports.io'
    };

    // Track API usage
    this.apiCallCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Get team roster from cache or API
   */
  async getTeamRoster(sport, teamId, season = null) {
    if (!this.apiKey) {
      logger.warn('Roster cache disabled - no API key');
      return null;
    }

    const currentSeason = season || this.getCurrentSeason(sport);
    const cacheKey = `${sport}_team_${teamId}_${currentSeason}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cacheHits++;
      logger.info(`✅ Roster cache HIT for ${sport} team ${teamId} (${this.cacheHits} hits, ${this.cacheMisses} misses)`);
      return cached;
    }

    // Fetch from API-Sports
    this.cacheMisses++;
    logger.info(`📡 Fetching roster for ${sport} team ${teamId} season ${currentSeason} (API call #${++this.apiCallCount})`);
    
    try {
      const roster = await this.fetchRosterFromAPI(sport, teamId, currentSeason);
      
      // Cache for 7 days
      this.cache.set(cacheKey, roster);
      logger.info(`💾 Cached ${roster.length} players for ${sport} team ${teamId}`);
      
      return roster;
    } catch (error) {
      logger.error(`❌ Failed to fetch roster for ${sport} team ${teamId}:`, error.message);
      return null;
    }
  }

  /**
   * Fetch roster from API-Sports
   */
  async fetchRosterFromAPI(sport, teamId, season) {
    const baseUrl = this.endpoints[sport];
    const host = this.apiHosts[sport];
    
    if (!baseUrl) {
      throw new Error(`Unsupported sport: ${sport}`);
    }

    // Build endpoint based on sport
    let endpoint;
    if (sport === 'NBA') {
      endpoint = `${baseUrl}/players?team=${teamId}&season=${season}`;
    } else {
      // NFL and NCAAF use same endpoint structure
      endpoint = `${baseUrl}/players?team=${teamId}&season=${season}`;
    }

    const response = await axios.get(endpoint, {
      headers: {
        'x-rapidapi-key': this.apiKey,
        'x-rapidapi-host': host
      },
      timeout: 10000
    });

    if (!response.data || !response.data.response) {
      throw new Error('Invalid API response');
    }

    return response.data.response;
  }

  /**
   * Get all teams for a sport/league
   */
  async getTeams(sport, league = null) {
    if (!this.apiKey) return null;

    const currentSeason = this.getCurrentSeason(sport);
    const cacheKey = `${sport}_teams_${league || 'all'}_${currentSeason}`;
    
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cacheHits++;
      logger.info(`✅ Teams cache HIT for ${sport} (${this.cacheHits} hits)`);
      return cached;
    }

    this.cacheMisses++;
    logger.info(`📡 Fetching teams for ${sport} (API call #${++this.apiCallCount})`);

    try {
      const baseUrl = this.endpoints[sport];
      const host = this.apiHosts[sport];
      
      let endpoint;
      if (sport === 'NBA') {
        endpoint = `${baseUrl}/teams`;
      } else if (sport === 'NFL') {
        endpoint = `${baseUrl}/teams?league=1`; // NFL league ID
      } else if (sport === 'NCAAF') {
        endpoint = `${baseUrl}/teams?league=2`; // NCAAF league ID
      }

      const response = await axios.get(endpoint, {
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': host
        },
        timeout: 10000
      });

      const teams = response.data.response || [];
      this.cache.set(cacheKey, teams, 604800); // Cache for 7 days
      logger.info(`💾 Cached ${teams.length} teams for ${sport}`);
      
      return teams;
    } catch (error) {
      logger.error(`❌ Failed to fetch teams for ${sport}:`, error.message);
      return null;
    }
  }

  /**
   * Verify if a player plays for a specific team
   * Returns { found: boolean, actualTeam: string, correctTeam: boolean }
   */
  async verifyPlayerTeam(playerName, expectedTeamName, sport) {
    if (!this.apiKey) {
      return { found: false, error: 'API key not configured' };
    }

    logger.info(`🔍 Verifying: Does "${playerName}" play for "${expectedTeamName}" in ${sport}?`);

    // Search through all cached rosters for this sport
    const allKeys = this.cache.keys();
    const sportKeys = allKeys.filter(k => k.startsWith(`${sport}_team_`));

    // If no cached rosters, fetch teams first
    if (sportKeys.length === 0) {
      logger.info(`No cached rosters for ${sport}, fetching teams...`);
      const teams = await this.getTeams(sport);
      
      if (!teams || teams.length === 0) {
        return { found: false, error: 'Could not fetch teams' };
      }

      // Fetch rosters for all teams (this will be cached)
      for (const team of teams.slice(0, 35)) { // Limit to avoid hitting rate limit
        await this.getTeamRoster(sport, team.id);
      }
    }

    // Now search through cached rosters
    const updatedKeys = this.cache.keys().filter(k => k.startsWith(`${sport}_team_`));
    
    for (const key of updatedKeys) {
      const roster = this.cache.get(key);
      if (!roster) continue;

      const player = roster.find(p => {
        const name = p.name || p.player?.name || '';
        return name.toLowerCase().includes(playerName.toLowerCase());
      });
      
      if (player) {
        const actualTeam = player.team?.name || player.team || 'Unknown';
        const correctTeam = actualTeam.toLowerCase().includes(expectedTeamName.toLowerCase()) ||
                           expectedTeamName.toLowerCase().includes(actualTeam.toLowerCase());
        
        if (correctTeam) {
          logger.info(`✅ VERIFIED: ${playerName} plays for ${actualTeam}`);
        } else {
          logger.warn(`⚠️ MISMATCH: ${playerName} plays for ${actualTeam}, NOT ${expectedTeamName}`);
        }

        return {
          found: true,
          actualTeam: actualTeam,
          correctTeam: correctTeam,
          playerData: {
            name: player.name || player.player?.name,
            position: player.position,
            number: player.number
          }
        };
      }
    }

    logger.warn(`❓ NOT FOUND: ${playerName} not found in ${sport} rosters`);
    return { found: false };
  }

  /**
   * Batch verify multiple players
   */
  async verifyPlayers(players, sport) {
    const results = [];
    
    for (const player of players) {
      const verification = await this.verifyPlayerTeam(
        player.name,
        player.expectedTeam,
        sport
      );
      
      results.push({
        player: player.name,
        expectedTeam: player.expectedTeam,
        game: player.game,
        ...verification
      });
    }

    return results;
  }

  /**
   * Get current season based on sport
   */
  getCurrentSeason(sport) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12

    if (sport === 'NBA') {
      // NBA season spans two years (e.g., 2024-2025)
      // Season starts in October
      if (month >= 10) {
        return `${year}-${year + 1}`;
      } else {
        return `${year - 1}-${year}`;
      }
    } else if (sport === 'NFL') {
      // NFL season is single year
      // Season starts in September
      if (month >= 9) {
        return year.toString();
      } else {
        return (year - 1).toString();
      }
    } else if (sport === 'NCAAF') {
      // NCAAF same as NFL
      if (month >= 9) {
        return year.toString();
      } else {
        return (year - 1).toString();
      }
    }

    return year.toString();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const keys = this.cache.keys();
    return {
      totalCachedItems: keys.length,
      apiCallsMade: this.apiCallCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      hitRate: this.cacheHits + this.cacheMisses > 0 
        ? ((this.cacheHits / (this.cacheHits + this.cacheMisses)) * 100).toFixed(1) + '%'
        : 'N/A',
      cachedSports: [...new Set(keys.map(k => k.split('_')[0]))]
    };
  }

  /**
   * Clear cache (for testing or manual refresh)
   */
  clearCache(sport = null) {
    if (sport) {
      const keys = this.cache.keys().filter(k => k.startsWith(`${sport}_`));
      keys.forEach(k => this.cache.del(k));
      logger.info(`🗑️ Cleared ${keys.length} cached items for ${sport}`);
    } else {
      this.cache.flushAll();
      logger.info('🗑️ Cleared entire roster cache');
    }
  }
}

// Export singleton instance
module.exports = new RosterCache();
