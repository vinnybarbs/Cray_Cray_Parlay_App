const { logger } = require('../../shared/logger');
const { supabase } = require('../middleware/supabaseAuth');

/**
 * Sports Stats Service
 * Queries cached player and team statistics from API Sports data
 * Provides rich context for AI agents without burning API calls
 */
class SportsStatsService {
  constructor() {
    this.cache = new Map(); // In-memory cache for frequent queries
    this.cacheTimeout = 300000; // 5 minutes
  }

  /**
   * Get team statistics for a sport/season
   */
  async getTeamStats(sport, season = null) {
    try {
      const currentSeason = season || this.getCurrentSeason(sport);
      const cacheKey = `teams_${sport}_${currentSeason}`;
      
      // Check in-memory cache first
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTimeout) {
          return cached.data;
        }
      }

      const { data, error } = await supabase
        .from('team_stats')
        .select('*')
        .eq('sport', sport.toUpperCase())
        .eq('season', currentSeason)
        .order('team_name');

      if (error) {
        logger.error('Error fetching team stats:', error);
        return [];
      }

      // Cache the result
      this.cache.set(cacheKey, {
        data: data || [],
        timestamp: Date.now()
      });

      logger.info(`📊 Retrieved ${data?.length || 0} teams for ${sport} ${currentSeason}`);
      return data || [];

    } catch (error) {
      logger.error('SportsStatsService.getTeamStats error:', error);
      return [];
    }
  }

  /**
   * Get player statistics for a sport/season
   */
  async getPlayerStats(sport, season = null, teamId = null, position = null) {
    try {
      const currentSeason = season || this.getCurrentSeason(sport);
      
      let query = supabase
        .from('player_stats')
        .select('*')
        .eq('sport', sport.toUpperCase())
        .eq('season', currentSeason);

      if (teamId) {
        query = query.eq('team_id', teamId);
      }

      if (position) {
        query = query.eq('position', position);
      }

      const { data, error } = await query
        .order('player_name')
        .limit(100); // Reasonable limit

      if (error) {
        logger.error('Error fetching player stats:', error);
        return [];
      }

      logger.info(`📊 Retrieved ${data?.length || 0} players for ${sport} ${currentSeason}`);
      return data || [];

    } catch (error) {
      logger.error('SportsStatsService.getPlayerStats error:', error);
      return [];
    }
  }

  /**
   * Get top performers for a specific stat
   */
  async getTopPerformers(sport, statPath, limit = 10, position = null) {
    try {
      const currentSeason = this.getCurrentSeason(sport);
      
      let query = supabase
        .from('player_stats')
        .select('player_name, team_name, position, stats_json')
        .eq('sport', sport.toUpperCase())
        .eq('season', currentSeason);

      if (position) {
        query = query.eq('position', position);
      }

      // Order by the stat path (e.g., 'passing_yards', 'rushing_tds')
      const { data, error } = await query
        .order(`stats_json->>${statPath}`, { ascending: false, nullsFirst: false })
        .limit(limit);

      if (error) {
        logger.error('Error fetching top performers:', error);
        return [];
      }

      return data || [];

    } catch (error) {
      logger.error('SportsStatsService.getTopPerformers error:', error);
      return [];
    }
  }

  /**
   * Get team by name (fuzzy match)
   */
  async findTeam(sport, teamName) {
    try {
      const currentSeason = this.getCurrentSeason(sport);
      
      const { data, error } = await supabase
        .from('team_stats')
        .select('*')
        .eq('sport', sport.toUpperCase())
        .eq('season', currentSeason)
        .or(`team_name.ilike.%${teamName}%,city.ilike.%${teamName}%`);

      if (error) {
        logger.error('Error finding team:', error);
        return null;
      }

      return data?.[0] || null;

    } catch (error) {
      logger.error('SportsStatsService.findTeam error:', error);
      return null;
    }
  }

  /**
   * Get player by name and team (for verification)
   */
  async findPlayer(sport, playerName, teamName = null) {
    try {
      const currentSeason = this.getCurrentSeason(sport);
      
      let query = supabase
        .from('player_stats')
        .select('*')
        .eq('sport', sport.toUpperCase())
        .eq('season', currentSeason)
        .ilike('player_name', `%${playerName}%`);

      if (teamName) {
        query = query.ilike('team_name', `%${teamName}%`);
      }

      const { data, error } = await query.limit(5);

      if (error) {
        logger.error('Error finding player:', error);
        return [];
      }

      return data || [];

    } catch (error) {
      logger.error('SportsStatsService.findPlayer error:', error);
      return [];
    }
  }

  /**
   * Get team matchup context (both teams' stats)
   */
  async getMatchupContext(sport, homeTeam, awayTeam) {
    try {
      const homeTeamData = await this.findTeam(sport, homeTeam);
      const awayTeamData = await this.findTeam(sport, awayTeam);

      if (!homeTeamData || !awayTeamData) {
        return null;
      }

      // Get key players for both teams
      const homePlayersPromise = this.getPlayerStats(sport, null, homeTeamData.team_id);
      const awayPlayersPromise = this.getPlayerStats(sport, null, awayTeamData.team_id);

      const [homePlayers, awayPlayers] = await Promise.all([
        homePlayersPromise,
        awayPlayersPromise
      ]);

      return {
        homeTeam: {
          ...homeTeamData,
          keyPlayers: homePlayers.slice(0, 5) // Top 5 players
        },
        awayTeam: {
          ...awayTeamData,
          keyPlayers: awayPlayers.slice(0, 5)
        },
        matchupInsights: this.getSportSpecificInsights(sport, homeTeamData, awayTeamData)
      };

    } catch (error) {
      logger.error('SportsStatsService.getMatchupContext error:', error);
      return null;
    }
  }

  /**
   * Generate insights from team stats comparison
   */
  generateMatchupInsights(homeTeam, awayTeam, sport) {
    const insights = [];

    try {
      const homeStats = homeTeam.stats_json;
      const awayStats = awayTeam.stats_json;

      if (!homeStats || !awayStats) return insights;

      // Sport-specific analysis
      if (sport.toUpperCase() === 'NFL') {
        // NFL-specific insights
        if (homeStats.wins > awayStats.wins) {
          insights.push(`${homeTeam.team_name} has a better record (${homeStats.wins}-${homeStats.losses}) vs ${awayTeam.team_name} (${awayStats.wins}-${awayStats.losses})`);
        }

        if (homeStats.points_for > awayStats.points_for) {
          insights.push(`${homeTeam.team_name} averages more points (${homeStats.points_for}) than ${awayTeam.team_name} (${awayStats.points_for})`);
        }

        if (homeStats.points_against < awayStats.points_against) {
          insights.push(`${homeTeam.team_name} has a stronger defense (${homeStats.points_against} pts allowed vs ${awayStats.points_against})`);
        }
      }

      insights.push(`Home field advantage: ${homeTeam.team_name} playing at ${homeTeam.city}`);

    } catch (error) {
      logger.error('Error generating matchup insights:', error);
    }

    return insights;
  }

  /**
   * Get current season based on sport and date
   */
  getCurrentSeason(sport) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-based

    switch (sport.toUpperCase()) {
      case 'NFL':
      case 'NCAAF':
        // Football season spans Aug-Jan, so 2024 season runs Aug 2024 - Jan 2025
        return month >= 7 ? year : year - 1; // Aug-Dec = current year, Jan-Jul = previous year
      
      case 'NBA':
        // NBA season spans Oct-Jun, so 2024-25 season
        return month >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
      
      case 'NHL':
        // Similar to NBA
        return month >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
      
      case 'SOCCER':
      case 'EPL':
        // Soccer season spans Aug-May
        return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
      
      case 'MLB':
        // Baseball season spans March-October
        return month >= 2 && month <= 9 ? year : year; // Always current year for MLB
        
      case 'GOLF':
      case 'TENNIS':
      case 'UFC':
        // Year-round sports, use calendar year
        return year.toString();
      
      default:
        return year.toString();
    }
  }

  /**
   * Get API usage stats (for budget monitoring)
   */
  async getApiUsage(days = 7) {
    try {
      const { data, error } = await supabase
        .from('api_call_log')
        .select('*')
        .order('date', { ascending: false })
        .limit(days);

      if (error) {
        logger.error('Error fetching API usage:', error);
        return [];
      }

      return data || [];

    } catch (error) {
      logger.error('SportsStatsService.getApiUsage error:', error);
      return [];
    }
  }

  /**
   * Get rankings for individual sports (Golf, Tennis, UFC)
   */
  async getRankings(sport, limit = 50, rankType = null) {
    try {
      let query = supabase
        .from('rankings')
        .select('*')
        .eq('sport', sport.toUpperCase())
        .order('rank_position');

      if (rankType) {
        query = query.eq('rank_type', rankType);
      }

      const { data, error } = await query.limit(limit);

      if (error) {
        logger.error('Error fetching rankings:', error);
        return [];
      }

      logger.info(`📊 Retrieved ${data?.length || 0} rankings for ${sport}`);
      return data || [];

    } catch (error) {
      logger.error('SportsStatsService.getRankings error:', error);
      return [];
    }
  }

  /**
   * Get sport-specific insights based on sport type
   */
  getSportSpecificInsights(sport, homeTeam, awayTeam) {
    const insights = [];

    try {
      const homeStats = homeTeam.stats_json;
      const awayStats = awayTeam.stats_json;

      if (!homeStats || !awayStats) return insights;

      switch (sport.toUpperCase()) {
        case 'MLB':
          if (homeStats.wins > awayStats.wins) {
            insights.push(`${homeTeam.team_name} has better record (${homeStats.wins}-${homeStats.losses}) vs ${awayTeam.team_name} (${awayStats.wins}-${awayStats.losses})`);
          }
          if (homeStats.era && awayStats.era) {
            insights.push(`Team ERA comparison: ${homeTeam.team_name} ${homeStats.era} vs ${awayTeam.team_name} ${awayStats.era}`);
          }
          break;

        case 'NHL':
          if (homeStats.points > awayStats.points) {
            insights.push(`${homeTeam.team_name} leads standings with ${homeStats.points} points vs ${awayTeam.team_name}'s ${awayStats.points}`);
          }
          if (homeStats.goals_for && awayStats.goals_for) {
            insights.push(`Offense: ${homeTeam.team_name} ${homeStats.goals_for} GF vs ${awayTeam.team_name} ${awayStats.goals_for} GF`);
          }
          break;

        case 'SOCCER':
          if (homeStats.position && awayStats.position) {
            insights.push(`League position: ${homeTeam.team_name} ${homeStats.position}th vs ${awayTeam.team_name} ${awayStats.position}th`);
          }
          if (homeStats.goals && awayStats.goals) {
            insights.push(`Goals scored: ${homeTeam.team_name} ${homeStats.goals} vs ${awayTeam.team_name} ${awayStats.goals}`);
          }
          break;

        default:
          // Generic insights for other sports
          break;
      }

      insights.push(`Home field advantage: ${homeTeam.team_name} playing at home`);

    } catch (error) {
      logger.error('Error generating sport-specific insights:', error);
    }

    return insights;
  }

  /**
   * Check if sport is supported for team-based analysis
   */
  isTeamSport(sport) {
    return ['NFL', 'NCAAF', 'NBA', 'MLB', 'NHL', 'SOCCER'].includes(sport.toUpperCase());
  }

  /**
   * Check if sport is individual/ranking-based
   */
  isIndividualSport(sport) {
    return ['GOLF', 'TENNIS', 'UFC'].includes(sport.toUpperCase());
  }

  /**
   * Get sport-appropriate data for betting analysis
   */
  async getSportData(sport, identifier1, identifier2 = null) {
    sport = sport.toUpperCase();

    if (this.isTeamSport(sport)) {
      // Team-based sports: get matchup context
      return await this.getMatchupContext(sport, identifier1, identifier2);
    } else if (this.isIndividualSport(sport)) {
      // Individual sports: get rankings/player data
      return await this.getRankings(sport, 20);
    }

    return null;
  }

  /**
   * Clear in-memory cache
   */
  clearCache() {
    this.cache.clear();
    logger.info('🗑️ Sports stats cache cleared');
  }

  /**
   * Get service stats
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      cacheTimeout: this.cacheTimeout,
      availableMethods: [
        'getTeamStats',
        'getPlayerStats', 
        'getTopPerformers',
        'findTeam',
        'findPlayer',
        'getMatchupContext',
        'getRankings',
        'getSportData',
        'getApiUsage'
      ]
    };
  }
}

module.exports = { SportsStatsService };