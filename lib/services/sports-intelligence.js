const { logger } = require('../../shared/logger');
const { supabase } = require('../middleware/supabaseAuth');

/**
 * Sports Intelligence Service
 * Retrieves cached news, analyst picks, injury reports, and betting trends
 * Provides rich context for AI agents without real-time API calls
 */
class SportsIntelligenceService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 300000; // 5 minutes in-memory cache
  }

  /**
   * Get comprehensive intelligence for a team matchup
   */
  async getMatchupIntelligence(sport, homeTeam, awayTeam) {
    try {
      const intelligence = {
        homeTeam: await this.getTeamIntelligence(sport, homeTeam),
        awayTeam: await this.getTeamIntelligence(sport, awayTeam),
        bettingTrends: await this.getBettingTrends(sport, homeTeam, awayTeam),
        lastUpdated: new Date().toISOString()
      };

      // Generate matchup-specific insights
      intelligence.matchupInsights = this.generateMatchupInsights(intelligence);
      
      logger.info(`🧠 Retrieved intelligence for ${awayTeam} @ ${homeTeam}`);
      return intelligence;

    } catch (error) {
      logger.error('Error getting matchup intelligence:', error);
      return null;
    }
  }

  /**
   * Get all cached intelligence for a specific team
   */
  async getTeamIntelligence(sport, teamName) {
    try {
      const cacheKey = `team_intel_${sport}_${teamName}`;
      
      // Check in-memory cache first
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTimeout) {
          return cached.data;
        }
      }

      // Query all intelligence types for the team
      const { data, error } = await supabase
        .from('news_cache')
        .select('*')
        .eq('sport', sport.toUpperCase())
        .eq('team_name', teamName)
        .gt('expires_at', new Date().toISOString())
        .order('last_updated', { ascending: false });

      if (error) {
        logger.error('Error fetching team intelligence:', error);
        return this.getEmptyIntelligence();
      }

      const intelligence = this.organizeTeamIntelligence(data || []);
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: intelligence,
        timestamp: Date.now()
      });

      return intelligence;

    } catch (error) {
      logger.error('SportsIntelligenceService.getTeamIntelligence error:', error);
      return this.getEmptyIntelligence();
    }
  }

  /**
   * Get cached betting trends for sport or specific matchup
   */
  async getBettingTrends(sport, homeTeam = null, awayTeam = null) {
    try {
      let query = supabase
        .from('news_cache')
        .select('*')
        .eq('sport', sport.toUpperCase())
        .eq('search_type', 'betting_trends')
        .gt('expires_at', new Date().toISOString())
        .order('last_updated', { ascending: false })
        .limit(3);

      const { data, error } = await query;

      if (error) {
        logger.error('Error fetching betting trends:', error);
        return null;
      }

      return this.formatBettingTrends(data || []);

    } catch (error) {
      logger.error('Error getting betting trends:', error);
      return null;
    }
  }

  /**
   * Get injury reports for a team
   */
  async getInjuryReport(sport, teamName) {
    try {
      const { data, error } = await supabase
        .from('news_cache')
        .select('*')
        .eq('sport', sport.toUpperCase())
        .eq('team_name', teamName)
        .eq('search_type', 'injuries')
        .gt('expires_at', new Date().toISOString())
        .order('last_updated', { ascending: false })
        .limit(1);

      if (error || !data || data.length === 0) {
        return null;
      }

      return {
        summary: data[0].summary,
        articles: JSON.parse(data[0].articles || '[]'),
        lastUpdated: data[0].last_updated,
        tagline: this.generateInjuryTagline(data[0].summary)
      };

    } catch (error) {
      logger.error('Error getting injury report:', error);
      return null;
    }
  }

  /**
   * Get analyst picks for a team
   */
  async getAnalystPicks(sport, teamName) {
    try {
      const { data, error } = await supabase
        .from('news_cache')
        .select('*')
        .eq('sport', sport.toUpperCase())
        .eq('team_name', teamName)
        .eq('search_type', 'analyst_picks')
        .gt('expires_at', new Date().toISOString())
        .order('last_updated', { ascending: false })
        .limit(1);

      if (error || !data || data.length === 0) {
        return null;
      }

      return {
        summary: data[0].summary,
        articles: JSON.parse(data[0].articles || '[]'),
        lastUpdated: data[0].last_updated,
        tagline: this.generateAnalystTagline(data[0].summary)
      };

    } catch (error) {
      logger.error('Error getting analyst picks:', error);
      return null;
    }
  }

  /**
   * Organize team intelligence by category
   */
  organizeTeamIntelligence(rawData) {
    const organized = {
      injuries: null,
      analystPicks: null,
      teamNews: null,
      hasIntelligence: false
    };

    rawData.forEach(item => {
      const articles = JSON.parse(item.articles || '[]');
      const intel = {
        summary: item.summary,
        articles: articles,
        lastUpdated: item.last_updated,
        tagline: this.generateTagline(item.summary, item.search_type)
      };

      switch (item.search_type) {
        case 'injuries':
          organized.injuries = intel;
          organized.hasIntelligence = true;
          break;
        case 'analyst_picks':
          organized.analystPicks = intel;
          organized.hasIntelligence = true;
          break;
        case 'team_news':
          organized.teamNews = intel;
          organized.hasIntelligence = true;
          break;
      }
    });

    return organized;
  }

  /**
   * Generate contextual insights from combined intelligence
   */
  generateMatchupInsights(intelligence) {
    const insights = [];

    try {
      // Injury impact analysis
      if (intelligence.homeTeam.injuries || intelligence.awayTeam.injuries) {
        const homeInjuries = intelligence.homeTeam.injuries?.summary || '';
        const awayInjuries = intelligence.awayTeam.injuries?.summary || '';
        
        if (homeInjuries.toLowerCase().includes('key') || homeInjuries.toLowerCase().includes('star')) {
          insights.push('Home team dealing with key player injuries');
        }
        if (awayInjuries.toLowerCase().includes('key') || awayInjuries.toLowerCase().includes('star')) {
          insights.push('Away team has significant injury concerns');
        }
      }

      // Analyst consensus
      if (intelligence.homeTeam.analystPicks && intelligence.awayTeam.analystPicks) {
        insights.push('Professional analysts have weighed in on both teams');
      }

      // Betting trends insight
      if (intelligence.bettingTrends) {
        insights.push('Current betting market shows interesting trends');
      }

      // Recent news impact
      if (intelligence.homeTeam.teamNews || intelligence.awayTeam.teamNews) {
        insights.push('Recent team developments may impact performance');
      }

    } catch (error) {
      logger.error('Error generating matchup insights:', error);
    }

    return insights;
  }

  /**
   * Generate compelling taglines for different intelligence types
   */
  generateTagline(summary, type) {
    if (!summary) return 'Latest updates available';
    
    // Handle both string summaries and article arrays
    const summaryText = typeof summary === 'string' ? summary : 
                       Array.isArray(summary) ? summary.map(a => a.snippet || a.title).join(' ') : 
                       String(summary);

    switch (type) {
      case 'injuries':
        return this.generateInjuryTagline(summaryText);
      case 'analyst_picks':
        return this.generateAnalystTagline(summaryText);
      case 'team_news':
        return this.generateNewsTagline(summaryText);
      case 'betting_trends':
        return this.generateTrendsTagline(summaryText);
      default:
        return 'Recent developments worth noting';
    }
  }

  generateInjuryTagline(summary) {
    if (summary.toLowerCase().includes('questionable')) return '⚠️ Key players questionable for game';
    if (summary.toLowerCase().includes('out')) return '🚫 Impact players ruled out';
    if (summary.toLowerCase().includes('return')) return '🔄 Players returning from injury';
    return '🏥 Latest injury report available';
  }

  generateAnalystTagline(summary) {
    if (summary.toLowerCase().includes('favor')) return '📊 Experts leaning one direction';
    if (summary.toLowerCase().includes('split')) return '🤔 Analysts divided on outcome';
    if (summary.toLowerCase().includes('consensus')) return '✅ Strong expert consensus';
    return '🎯 Professional analysis available';
  }

  generateNewsTagline(summary) {
    if (summary.toLowerCase().includes('trade')) return '🔄 Recent roster moves';
    if (summary.toLowerCase().includes('coach')) return '👔 Coaching developments';
    if (summary.toLowerCase().includes('contract')) return '💰 Contract news';
    return '📰 Important team updates';
  }

  generateTrendsTagline(summary) {
    if (summary.toLowerCase().includes('public')) return '📈 Public betting patterns';
    if (summary.toLowerCase().includes('sharp')) return '🎯 Sharp money activity';
    if (summary.toLowerCase().includes('line')) return '📊 Line movement detected';
    return '💹 Market trends analysis';
  }

  /**
   * Format betting trends data
   */
  formatBettingTrends(trendsData) {
    if (!trendsData || trendsData.length === 0) return null;

    return {
      summary: trendsData[0].summary,
      articles: JSON.parse(trendsData[0].articles || '[]'),
      lastUpdated: trendsData[0].last_updated,
      tagline: this.generateTrendsTagline(trendsData[0].summary)
    };
  }

  /**
   * Get empty intelligence structure
   */
  getEmptyIntelligence() {
    return {
      injuries: null,
      analystPicks: null,
      teamNews: null,
      hasIntelligence: false
    };
  }

  /**
   * Get sport-specific intelligence for agent reasoning
   */
  async getAgentContext(sport, homeTeam, awayTeam) {
    try {
      const intelligence = await this.getMatchupIntelligence(sport, homeTeam, awayTeam);
      
      if (!intelligence) {
        return { hasIntel: false, context: '' };
      }

      const contextLines = [];

      // Add injury context
      if (intelligence.homeTeam.injuries) {
        contextLines.push(`🏥 ${intelligence.homeTeam.injuries.tagline}: ${intelligence.homeTeam.injuries.summary}`);
      }
      if (intelligence.awayTeam.injuries) {
        contextLines.push(`🏥 ${intelligence.awayTeam.injuries.tagline}: ${intelligence.awayTeam.injuries.summary}`);
      }

      // Add analyst context  
      if (intelligence.homeTeam.analystPicks) {
        contextLines.push(`📊 ${intelligence.homeTeam.analystPicks.tagline}: ${intelligence.homeTeam.analystPicks.summary}`);
      }
      if (intelligence.awayTeam.analystPicks) {
        contextLines.push(`📊 ${intelligence.awayTeam.analystPicks.tagline}: ${intelligence.awayTeam.analystPicks.summary}`);
      }

      // Add betting trends
      if (intelligence.bettingTrends) {
        contextLines.push(`💹 ${intelligence.bettingTrends.tagline}: ${intelligence.bettingTrends.summary}`);
      }

      return {
        hasIntel: contextLines.length > 0,
        context: contextLines.join('\n'),
        taglines: this.extractTaglines(intelligence)
      };

    } catch (error) {
      logger.error('Error getting agent context:', error);
      return { hasIntel: false, context: '' };
    }
  }

  /**
   * Extract taglines for UI display
   */
  extractTaglines(intelligence) {
    const taglines = [];

    if (intelligence.homeTeam.injuries) {
      taglines.push({ type: 'injury', text: intelligence.homeTeam.injuries.tagline });
    }
    if (intelligence.awayTeam.injuries) {
      taglines.push({ type: 'injury', text: intelligence.awayTeam.injuries.tagline });
    }
    if (intelligence.homeTeam.analystPicks) {
      taglines.push({ type: 'analyst', text: intelligence.homeTeam.analystPicks.tagline });
    }
    if (intelligence.awayTeam.analystPicks) {
      taglines.push({ type: 'analyst', text: intelligence.awayTeam.analystPicks.tagline });
    }
    if (intelligence.bettingTrends) {
      taglines.push({ type: 'trends', text: intelligence.bettingTrends.tagline });
    }

    return taglines;
  }

  /**
   * Clear in-memory cache
   */
  clearCache() {
    this.cache.clear();
    logger.info('🗑️ Sports intelligence cache cleared');
  }

  /**
   * Get service stats
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      cacheTimeout: this.cacheTimeout,
      availableMethods: [
        'getMatchupIntelligence',
        'getTeamIntelligence', 
        'getInjuryReport',
        'getAnalystPicks',
        'getBettingTrends',
        'getAgentContext'
      ]
    };
  }
}

module.exports = { SportsIntelligenceService };