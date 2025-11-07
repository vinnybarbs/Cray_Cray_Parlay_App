const NodeCache = require('node-cache');
const axios = require('axios');
const { createLogger } = require('../../shared/logger');

const logger = createLogger('NFLStats');

/**
 * NFL Stats Service using API-Sports
 * Fetches real-time team and player statistics, standings, and injury data
 * Documentation: https://api-sports.io/documentation/nfl/v1
 */
class NFLStatsService {
  constructor(supabase = null) {
    // Cache stats for 1 hour (3600 seconds) - stats change frequently during season
    this.cache = new NodeCache({ 
      stdTTL: 3600,  // 1 hour
      checkperiod: 600  // Check every 10 minutes
    });
    
    this.supabase = supabase;
    this.apiKey = process.env.APISPORTS_API_KEY || process.env.API_SPORTS_KEY;
    this.baseUrl = 'https://v1.american-football.api-sports.io';
    this.currentSeason = new Date().getFullYear();
    
    if (!this.apiKey) {
      logger.warn('⚠️ API-Sports key not configured - NFL stats disabled');
    }

    // Track API usage
    this.apiCallCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.dbCacheHits = 0;
  }

  /**
   * Make API request with caching
   */
  async makeRequest(endpoint, params = {}) {
    if (!this.apiKey) {
      throw new Error('API-Sports key not configured');
    }

    const cacheKey = `${endpoint}_${JSON.stringify(params)}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      this.cacheHits++;
      logger.debug(`Cache hit: ${endpoint}`);
      return cached;
    }

    this.cacheMisses++;
    this.apiCallCount++;

    try {
      const response = await axios.get(`${this.baseUrl}${endpoint}`, {
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': 'v1.american-football.api-sports.io'
        },
        params,
        timeout: 10000
      });

      const data = response.data.response || [];
      this.cache.set(cacheKey, data);
      logger.debug(`API call: ${endpoint} - ${data.length} results`);
      
      return data;
    } catch (error) {
      logger.error(`API request failed: ${endpoint}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Get team standings/records for current season
   */
  async getStandings(season = null) {
    season = season || this.currentSeason;
    
    try {
      const standings = await this.makeRequest('/standings', { 
        league: 1, // NFL
        season 
      });
      
      return standings;
    } catch (error) {
      logger.error('Failed to fetch standings', { error: error.message });
      return null;
    }
  }

  /**
   * Get team statistics from DB cache (preferred) or API (fallback)
   */
  async getTeamStatsFromCache(teamName, season = null) {
    season = season || this.currentSeason;
    
    if (!this.supabase) {
      logger.warn('No Supabase client - cannot read from cache');
      return null;
    }
    
    try {
      const { data, error } = await this.supabase
        .from('team_stats_cache')
        .select('*')
        .eq('sport', 'NFL')
        .eq('season', season)
        .ilike('team_name', `%${teamName}%`)
        .single();
      
      if (error || !data) {
        logger.debug(`Team stats cache miss for ${teamName}`);
        return null;
      }
      
      this.dbCacheHits++;
      logger.debug(`Team stats cache hit for ${teamName}`);
      return data.stats;
    } catch (error) {
      logger.error(`Error reading team stats from cache: ${error.message}`);
      return null;
    }
  }

  /**
   * Get team statistics for a specific team
   */
  async getTeamStats(teamId, season = null) {
    season = season || this.currentSeason;
    
    try {
      const stats = await this.makeRequest('/teams/statistics', {
        id: teamId,
        season
      });
      
      return stats[0] || null;
    } catch (error) {
      logger.error(`Failed to fetch team stats for ${teamId}`, { error: error.message });
      return null;
    }
  }

  /**
   * Get player statistics for a specific player
   */
  async getPlayerStats(playerId, season = null) {
    season = season || this.currentSeason;
    
    try {
      const stats = await this.makeRequest('/players/statistics', {
        id: playerId,
        season
      });
      
      return stats[0] || null;
    } catch (error) {
      logger.error(`Failed to fetch player stats for ${playerId}`, { error: error.message });
      return null;
    }
  }

  /**
   * Get injury report
   */
  async getInjuries(season = null) {
    season = season || this.currentSeason;
    
    try {
      const injuries = await this.makeRequest('/injuries', {
        league: 1,
        season
      });
      
      return injuries;
    } catch (error) {
      logger.error('Failed to fetch injuries', { error: error.message });
      return null;
    }
  }

  /**
   * Get injuries for a specific team
   */
  async getTeamInjuries(teamName, season = null) {
    const allInjuries = await this.getInjuries(season);
    
    if (!allInjuries) return [];
    
    return allInjuries.filter(injury => {
      const injuryTeam = injury.team?.name || '';
      return injuryTeam.toLowerCase().includes(teamName.toLowerCase());
    });
  }

  /**
   * Find team ID by name
   */
  async findTeamByName(teamName) {
    try {
      const teams = await this.makeRequest('/teams', {
        league: 1,
        season: this.currentSeason
      });
      
      const team = teams.find(t => 
        t.name.toLowerCase().includes(teamName.toLowerCase()) ||
        teamName.toLowerCase().includes(t.name.toLowerCase())
      );
      
      return team || null;
    } catch (error) {
      logger.error(`Failed to find team: ${teamName}`, { error: error.message });
      return null;
    }
  }

  /**
   * Get comprehensive game analysis with stats
   */
  async getGameAnalysis(awayTeam, homeTeam) {
    try {
      logger.info(`📊 Fetching stats for ${awayTeam} @ ${homeTeam}`);

      // Find team IDs
      const [awayTeamData, homeTeamData] = await Promise.all([
        this.findTeamByName(awayTeam),
        this.findTeamByName(homeTeam)
      ]);

      if (!awayTeamData || !homeTeamData) {
        logger.warn(`Could not find team data for ${awayTeam} or ${homeTeam}`);
        return null;
      }

      // Fetch stats in parallel
      const [awayStats, homeStats, standings, injuries] = await Promise.all([
        this.getTeamStats(awayTeamData.id),
        this.getTeamStats(homeTeamData.id),
        this.getStandings(),
        this.getInjuries()
      ]);

      // Find team records from standings
      const awayRecord = standings?.find(s => s.team?.id === awayTeamData.id);
      const homeRecord = standings?.find(s => s.team?.id === homeTeamData.id);

      // Filter injuries for these teams
      const awayInjuries = injuries?.filter(i => i.team?.id === awayTeamData.id) || [];
      const homeInjuries = injuries?.filter(i => i.team?.id === homeTeamData.id) || [];

      return {
        awayTeam: {
          name: awayTeam,
          id: awayTeamData.id,
          record: awayRecord ? `${awayRecord.won}-${awayRecord.lost}` : 'N/A',
          stats: awayStats,
          injuries: awayInjuries
        },
        homeTeam: {
          name: homeTeam,
          id: homeTeamData.id,
          record: homeRecord ? `${homeRecord.won}-${homeRecord.lost}` : 'N/A',
          stats: homeStats,
          injuries: homeInjuries
        }
      };
    } catch (error) {
      logger.error(`Failed to get game analysis for ${awayTeam} @ ${homeTeam}`, { error: error.message });
      return null;
    }
  }

  /**
   * Format stats for AI consumption
   */
  formatStatsForAI(gameAnalysis) {
    if (!gameAnalysis) return '';

    const { awayTeam, homeTeam } = gameAnalysis;
    const lines = [];

    lines.push(`\n**📊 TEAM STATS & RECORDS:**`);
    lines.push('');

    // Away Team
    lines.push(`**${awayTeam.name}** (${awayTeam.record}):`);
    if (awayTeam.stats) {
      const stats = awayTeam.stats.statistics || {};
      if (stats.points) {
        lines.push(`  • Points/Game: ${stats.points.for?.average?.all || 'N/A'} (Allowed: ${stats.points.against?.average?.all || 'N/A'})`);
      }
      if (stats.offense) {
        lines.push(`  • Total Yards/Game: ${stats.offense.yards?.average?.all || 'N/A'}`);
        lines.push(`  • Passing Yards/Game: ${stats.offense.passing?.yards?.average?.all || 'N/A'}`);
        lines.push(`  • Rushing Yards/Game: ${stats.offense.rushing?.yards?.average?.all || 'N/A'}`);
      }
    }
    if (awayTeam.injuries.length > 0) {
      const keyInjuries = awayTeam.injuries.slice(0, 3);
      lines.push(`  • Injuries: ${keyInjuries.map(i => `${i.player?.name} (${i.status})`).join(', ')}`);
    }
    lines.push('');

    // Home Team
    lines.push(`**${homeTeam.name}** (${homeTeam.record}):`);
    if (homeTeam.stats) {
      const stats = homeTeam.stats.statistics || {};
      if (stats.points) {
        lines.push(`  • Points/Game: ${stats.points.for?.average?.all || 'N/A'} (Allowed: ${stats.points.against?.average?.all || 'N/A'})`);
      }
      if (stats.offense) {
        lines.push(`  • Total Yards/Game: ${stats.offense.yards?.average?.all || 'N/A'}`);
        lines.push(`  • Passing Yards/Game: ${stats.offense.passing?.yards?.average?.all || 'N/A'}`);
        lines.push(`  • Rushing Yards/Game: ${stats.offense.rushing?.yards?.average?.all || 'N/A'}`);
      }
    }
    if (homeTeam.injuries.length > 0) {
      const keyInjuries = homeTeam.injuries.slice(0, 3);
      lines.push(`  • Injuries: ${keyInjuries.map(i => `${i.player?.name} (${i.status})`).join(', ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.keys().length,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      apiCalls: this.apiCallCount,
      hitRate: this.cacheHits + this.cacheMisses > 0 
        ? ((this.cacheHits / (this.cacheHits + this.cacheMisses)) * 100).toFixed(1) + '%'
        : '0%'
    };
  }
}

// Export singleton instance
module.exports = new NFLStatsService();
