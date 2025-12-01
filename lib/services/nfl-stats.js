const NodeCache = require('node-cache');
const axios = require('axios');
const { createLogger } = require('../../shared/logger');
const { findTeamByName: findTeamByNameStatic, findTeamById } = require('./static-team-mapping');

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
    
    // In production, prefer cache-only mode to avoid API limits and timeouts
    this.cacheOnlyMode = process.env.NODE_ENV === 'production' || process.env.NFL_STATS_CACHE_ONLY === 'true';
    
    if (!this.apiKey) {
      logger.warn('⚠️ API-Sports key not configured - NFL stats disabled');
    }
    
    if (this.cacheOnlyMode) {
      logger.info('🚀 NFL Stats in cache-only mode - no live API calls');
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
    
    if (this.cacheOnlyMode) {
      logger.warn('Standings requested in cache-only mode - returning null');
      return null;
    }
    
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
   * Get team statistics for a specific team - uses cached data to avoid API calls
   */
  async getTeamStats(teamId, season = null) {
    season = season || this.currentSeason;
    
    try {
      // First try to get stats from cache
      if (this.supabase) {
        const { data, error } = await this.supabase
          .from('team_stats_cache')
          .select('stats')
          .eq('sport', 'NFL')
          .eq('team_id', teamId)
          .eq('season', season)
          .single();
        
        if (data && data.stats) {
          logger.debug(`Found team stats for ID ${teamId} in cache`);
          return data.stats;
        }
      }
      
      // Fallback to API if cache miss and not in cache-only mode
      if (this.cacheOnlyMode) {
        logger.warn(`Team stats for ID ${teamId} not found in cache, cache-only mode prevents API call`);
        return null;
      }
      
      logger.warn(`Team stats for ID ${teamId} not found in cache, falling back to API`);
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
   * Get team W-L record from season cache (team_stats_season + teams)
   * Used as a fallback when live standings do not contain the team.
   */
  async getTeamRecordFromSeasonCache(teamName, season = null) {
    season = season || this.currentSeason;

    if (!this.supabase) {
      logger.warn('No Supabase client - cannot read team records cache');
      return null;
    }

    try {
      // Find team row by name/display_name
      const { data: teamRow, error: teamError } = await this.supabase
        .from('teams')
        .select('id, name, display_name')
        .or(`display_name.ilike.%${teamName}%,name.ilike.%${teamName}%`)
        .limit(1)
        .maybeSingle();

      if (teamError || !teamRow) {
        logger.debug(`Team ${teamName} not found in teams table for record cache fallback`);
        return null;
      }

      const { data: seasonRow, error: seasonError } = await this.supabase
        .from('team_stats_season')
        .select('metrics')
        .eq('team_id', teamRow.id)
        .eq('season', season)
        .maybeSingle();

      if (seasonError || !seasonRow || !seasonRow.metrics) {
        logger.debug(`No season record found in team_stats_season for ${teamName} (${teamRow.id})`);
        return null;
      }

      const wins = seasonRow.metrics.wins || 0;
      const losses = seasonRow.metrics.losses || 0;
      return `${wins}-${losses}`;
    } catch (error) {
      logger.error(`Error reading team record from season cache for ${teamName}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get injury report
   */
  async getInjuries(season = null) {
    season = season || this.currentSeason;
    
    if (this.cacheOnlyMode) {
      logger.warn('Injuries requested in cache-only mode - returning empty array');
      return [];
    }
    
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
   * Find team ID by name - uses static mapping for instant lookup
   */
  async findTeamByName(teamName) {
    try {
      // First try static mapping (instant, no API calls)
      const staticTeam = findTeamByNameStatic(teamName);
      if (staticTeam) {
        logger.debug(`Found team ${teamName} in static mapping: ID ${staticTeam.id}`);
        return { id: staticTeam.id, name: staticTeam.name };
      }
      
      // Then try cache lookup
      if (this.supabase) {
        const { data, error } = await this.supabase
          .from('team_stats_cache')
          .select('team_id, team_name')
          .eq('sport', 'NFL')
          .or(`team_name.ilike.%${teamName}%,team_name.ilike.%${teamName.replace(/\s+/g, ' ')}%`)
          .limit(1);
        
        if (data && data.length > 0) {
          logger.debug(`Found team ${teamName} in database cache: ID ${data[0].team_id}`);
          return { id: data[0].team_id, name: data[0].team_name };
        }
      }
      
      // Fallback to API only if both static and cache lookups fail and not in cache-only mode
      if (this.cacheOnlyMode) {
        logger.warn(`Team ${teamName} not found in static mapping or cache, cache-only mode prevents API call`);
        return null;
      }
      
      logger.warn(`Team ${teamName} not found in static mapping or cache, falling back to API`);
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
      let awayRecordStr = null;
      let homeRecordStr = null;

      if (Array.isArray(standings)) {
        const awayRecord = standings.find(s => s.team?.id === awayTeamData.id);
        const homeRecord = standings.find(s => s.team?.id === homeTeamData.id);

        if (awayRecord) {
          awayRecordStr = `${awayRecord.won}-${awayRecord.lost}`;
        }
        if (homeRecord) {
          homeRecordStr = `${homeRecord.won}-${homeRecord.lost}`;
        }
      }

      // Fallback: use season cache (team_stats_season) when standings are missing
      if (!awayRecordStr) {
        awayRecordStr = await this.getTeamRecordFromSeasonCache(awayTeam);
      }
      if (!homeRecordStr) {
        homeRecordStr = await this.getTeamRecordFromSeasonCache(homeTeam);
      }

      // Filter injuries for these teams
      const awayInjuries = injuries?.filter(i => i.team?.id === awayTeamData.id) || [];
      const homeInjuries = injuries?.filter(i => i.team?.id === homeTeamData.id) || [];

      return {
        awayTeam: {
          name: awayTeam,
          id: awayTeamData.id,
          record: awayRecordStr || 'N/A',
          stats: awayStats,
          injuries: awayInjuries
        },
        homeTeam: {
          name: homeTeam,
          id: homeTeamData.id,
          record: homeRecordStr || 'N/A',
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
