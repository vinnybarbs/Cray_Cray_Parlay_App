/**
 * ESPN Scoreboard Service
 * Fetches completed game results from ESPN Site API
 * Uses friendly Site API (not Core API) - accepts dates, returns team names
 */

class ESPNScoreboardService {
  constructor(supabase = null) {
    this.supabase = supabase;
    this.baseUrl = 'http://site.api.espn.com/apis/site/v2/sports';
    
    // Sport path mappings
    this.sports = {
      NFL: 'football/nfl',
      NBA: 'basketball/nba',
      MLB: 'baseball/mlb',
      NHL: 'hockey/nhl',
      NCAAF: 'football/college-football',
      NCAAB: 'basketball/mens-college-basketball'
    };
  }

  /**
   * Fetch scoreboard for a specific date and sport
   * @param {string} sport - Sport key (NFL, NBA, etc.)
   * @param {Date} date - Date to fetch games for
   * @returns {Promise<Array>} Array of game objects
   */
  async fetchScoreboard(sport, date) {
    try {
      // Format date as YYYYMMDD
      const dateStr = this.formatDate(date);
      const sportPath = this.sports[sport];
      
      if (!sportPath) {
        throw new Error(`Unsupported sport: ${sport}`);
      }

      const url = `${this.baseUrl}/${sportPath}/scoreboard?dates=${dateStr}`;
      console.log(`📊 Fetching ${sport} scoreboard for ${dateStr}...`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`ESPN API responded with ${response.status}`);
      }

      const data = await response.json();
      const games = this.parseGames(data, sport);
      
      console.log(`✅ Found ${games.length} ${sport} games on ${dateStr}`);
      return games;

    } catch (error) {
      console.error(`❌ Error fetching ${sport} scoreboard:`, error.message);
      return [];
    }
  }

  /**
   * Fetch scoreboard for multiple sports on a specific date
   * @param {Array<string>} sports - Array of sport keys
   * @param {Date} date - Date to fetch
   * @returns {Promise<Array>} Combined array of all games
   */
  async fetchMultipleSports(sports, date) {
    const allGames = [];
    
    for (const sport of sports) {
      const games = await this.fetchScoreboard(sport, date);
      allGames.push(...games);
      
      // Rate limiting between sports
      await this.sleep(500);
    }
    
    return allGames;
  }

  /**
   * Fetch yesterday's games for all active sports
   * @returns {Promise<Array>} All games from yesterday
   */
  async fetchYesterdaysGames() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const activeSports = ['NFL', 'NBA', 'MLB', 'NHL'];
    return await this.fetchMultipleSports(activeSports, yesterday);
  }

  /**
   * Parse ESPN API response into normalized game objects
   * @param {Object} data - Raw ESPN API response
   * @param {string} sport - Sport key
   * @returns {Array} Normalized game objects
   */
  parseGames(data, sport) {
    const games = [];
    
    if (!data.events || data.events.length === 0) {
      return games;
    }

    for (const event of data.events) {
      try {
        const game = this.parseEvent(event, sport);
        if (game) {
          games.push(game);
        }
      } catch (error) {
        console.warn(`⚠️ Error parsing event ${event.id}:`, error.message);
      }
    }
    
    return games;
  }

  /**
   * Parse a single event into a normalized game object
   * @param {Object} event - ESPN event object
   * @param {string} sport - Sport key
   * @returns {Object|null} Normalized game object
   */
  parseEvent(event, sport) {
    const competition = event.competitions?.[0];
    
    if (!competition) {
      return null;
    }

    // Find home and away teams
    const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
    const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
    
    if (!homeTeam || !awayTeam) {
      console.warn(`⚠️ Missing team data for event ${event.id}`);
      return null;
    }

    // Parse scores (handle null/undefined safely)
    const homeScore = this.parseScore(homeTeam.score);
    const awayScore = this.parseScore(awayTeam.score);

    // Normalize status
    const status = this.normalizeStatus(event.status?.type?.name);

    return {
      espn_event_id: event.id,
      sport,
      game_date: new Date(event.date),
      home_team: homeTeam.team.displayName,
      away_team: awayTeam.team.displayName,
      home_score: homeScore,
      away_score: awayScore,
      status,
      metadata: {
        event_name: event.name,
        event_short_name: event.shortName,
        venue: competition.venue?.fullName,
        broadcast: competition.broadcasts?.[0]?.names?.[0],
        odds: competition.odds?.[0]
      }
    };
  }

  /**
   * Parse score safely (ESPN sometimes returns strings or null)
   * @param {any} scoreValue - Score from ESPN API
   * @returns {number|null}
   */
  parseScore(scoreValue) {
    if (scoreValue === null || scoreValue === undefined || scoreValue === '') {
      return null;
    }
    
    const parsed = parseInt(scoreValue, 10);
    return isNaN(parsed) ? null : parsed;
  }

  /**
   * Normalize ESPN status names to our standard statuses
   * @param {string} espnStatus - ESPN status name
   * @returns {string}
   */
  normalizeStatus(espnStatus) {
    if (!espnStatus) return 'unknown';
    
    const status = espnStatus.toLowerCase();
    
    // Map ESPN statuses to our statuses
    const statusMap = {
      'status_final': 'final',
      'status_end_period': 'final',
      'status_scheduled': 'scheduled',
      'status_postponed': 'postponed',
      'status_canceled': 'cancelled',
      'status_delayed': 'delayed',
      'status_suspended': 'suspended',
      'status_in_progress': 'in_progress',
      'status_halftime': 'in_progress'
    };
    
    return statusMap[status] || status;
  }

  /**
   * Cache games to database
   * @param {Array} games - Array of normalized game objects
   * @returns {Promise<number>} Number of games cached
   */
  async cacheGames(games) {
    if (!this.supabase) {
      console.warn('⚠️ No Supabase client provided, skipping cache');
      return 0;
    }

    if (games.length === 0) {
      console.log('📭 No games to cache');
      return 0;
    }

    let cachedCount = 0;

    for (const game of games) {
      try {
        const { error } = await this.supabase
          .from('game_results')
          .upsert(game, { 
            onConflict: 'espn_event_id',
            ignoreDuplicates: false
          });

        if (error) {
          console.error(`❌ Error caching game ${game.espn_event_id}:`, error.message);
        } else {
          cachedCount++;
        }
      } catch (err) {
        console.error(`❌ Exception caching game ${game.espn_event_id}:`, err.message);
      }
    }

    console.log(`💾 Cached ${cachedCount}/${games.length} games to database`);
    return cachedCount;
  }

  /**
   * Fetch and cache games for a specific date
   * @param {Array<string>} sports - Sports to fetch
   * @param {Date} date - Date to fetch
   * @returns {Promise<Object>} Summary of operation
   */
  async fetchAndCache(sports, date) {
    console.log(`🔄 Fetching and caching games for ${this.formatDate(date)}...`);
    
    const games = await this.fetchMultipleSports(sports, date);
    const cachedCount = await this.cacheGames(games);
    
    return {
      date: this.formatDate(date),
      sports_checked: sports.length,
      games_found: games.length,
      games_cached: cachedCount
    };
  }

  /**
   * Format date as YYYYMMDD for ESPN API
   * @param {Date} date 
   * @returns {string}
   */
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * Sleep utility for rate limiting
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { ESPNScoreboardService };
