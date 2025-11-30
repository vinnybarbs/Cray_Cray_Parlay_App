/**
 * API-Sports Client
 * Wrapper for API-Sports NFL/NCAAF endpoints
 * Docs: https://api-sports.io/documentation/nfl/v1
 */

const { logger } = require('../../shared/logger');

class ApiSportsClient {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.APISPORTS_API_KEY;
    this.baseUrl = 'https://v1.american-football.api-sports.io';
    this.callCount = 0;
    this.dailyLimit = 100;
  }

  /**
   * Make API request with rate limiting and error handling
   */
  async request(endpoint, params = {}) {
    try {
      // Check rate limit
      if (this.callCount >= this.dailyLimit) {
        throw new Error(`API quota exceeded: ${this.callCount}/${this.dailyLimit} calls used today`);
      }

      const url = new URL(`${this.baseUrl}/${endpoint}`);
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null) {
          url.searchParams.append(key, params[key]);
        }
      });

      logger.info(`API-Sports: ${endpoint} (call ${this.callCount + 1}/${this.dailyLimit})`);

      const response = await fetch(url, {
        headers: {
          'x-apisports-key': this.apiKey
        }
      });

      this.callCount++;

      if (!response.ok) {
        throw new Error(`API-Sports error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Check for API errors
      if (data.errors && Object.keys(data.errors).length > 0) {
        throw new Error(`API-Sports error: ${JSON.stringify(data.errors)}`);
      }

      logger.info(`  ✓ Retrieved ${data.results} results`);
      
      return data;

    } catch (error) {
      logger.error(`API-Sports request failed: ${endpoint}`, error);
      throw error;
    }
  }

  /**
   * Get current NFL season year
   */
  getCurrentSeason() {
    const now = new Date();
    const month = now.getMonth(); // 0-11 (0=Jan, 8=Sep, 11=Dec)
    const year = now.getFullYear();
    
    // NFL season: Sept-Feb
    // If we're in Jan-Aug, we're in last year's season
    // If we're in Sept-Dec, we're in current year's season
    // But for Nov 2025, we're in the 2025 season
    if (month >= 8) {
      // Sept-Dec: current year's season
      return year;
    } else {
      // Jan-Aug: previous year's season
      return year - 1;
    }
  }

  // ============================================
  // TEAMS
  // ============================================

  /**
   * Get all NFL teams (requires season)
   */
  async getTeams(season = null, league = 1) {
    // league: 1 = NFL, 2 = NCAA
    season = season || this.getCurrentSeason();
    return this.request('teams', { league, season });
  }

  // ============================================
  // STANDINGS
  // ============================================

  /**
   * Get current standings
   */
  async getStandings(season = null, league = 1) {
    season = season || this.getCurrentSeason();
    return this.request('standings', { league, season });
  }

  // ============================================
  // PLAYERS
  // ============================================

  /**
   * Get players for a team
   */
  async getPlayersByTeam(teamId, season = null) {
    season = season || this.getCurrentSeason();
    return this.request('players', { team: teamId, season });
  }

  /**
   * Search for a specific player
   */
  async searchPlayer(name, season = null) {
    season = season || this.getCurrentSeason();
    return this.request('players', { search: name, season });
  }

  // ============================================
  // INJURIES
  // ============================================

  /**
   * Get current injuries (THE MOST CRITICAL ENDPOINT)
   * Note: Injuries endpoint doesn't require season/league params
   */
  async getInjuries() {
    return this.request('injuries');
  }

  /**
   * Get injuries for specific team
   */
  async getTeamInjuries(teamId) {
    return this.request('injuries', { team: teamId });
  }

  // ============================================
  // GAMES
  // ============================================

  /**
   * Get games for a specific date
   */
  async getGamesByDate(date, league = 1) {
    // date format: YYYY-MM-DD
    return this.request('games', { league, date });
  }

  /**
   * Get games for a team in a season
   */
  async getTeamGames(teamId, season = null) {
    season = season || this.getCurrentSeason();
    return this.request('games', { team: teamId, season });
  }

  /**
   * Get games for a specific week (MUCH more efficient than per-team!)
   */
  async getGamesByWeek(week, season = null, league = 1) {
    season = season || this.getCurrentSeason();
    return this.request('games', { league, season, week });
  }

  /**
   * Get specific game details
   */
  async getGame(gameId) {
    return this.request('games', { id: gameId });
  }

  // ============================================
  // STATISTICS
  // ============================================

  /**
   * Get player statistics for a game
   */
  async getGamePlayerStats(gameId) {
    return this.request('games/statistics/players', { id: gameId });
  }

  /**
   * Get team statistics for a game
   */
  async getGameTeamStats(gameId) {
    return this.request('games/statistics/teams', { id: gameId });
  }

  /**
   * Get player season statistics
   */
  async getPlayerSeasonStats(playerId, season = null) {
    season = season || this.getCurrentSeason();
    return this.request('players/statistics', { id: playerId, season });
  }

  /**
   * Get team season statistics
   */
  async getTeamSeasonStats(teamId, season = null) {
    season = season || this.getCurrentSeason();
    return this.request('teams/statistics', { id: teamId, season });
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Reset daily call counter (call at midnight)
   */
  resetCallCounter() {
    this.callCount = 0;
    logger.info('API-Sports call counter reset');
  }

  /**
   * Get remaining API calls for today
   */
  getRemainingCalls() {
    return this.dailyLimit - this.callCount;
  }

  /**
   * Check if we have enough calls remaining
   */
  canMakeCall(numCalls = 1) {
    return this.callCount + numCalls <= this.dailyLimit;
  }
}

module.exports = ApiSportsClient;
