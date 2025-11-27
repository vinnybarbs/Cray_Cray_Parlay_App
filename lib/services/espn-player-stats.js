/**
 * ESPN Player Stats Service
 * Fetches recent player performance stats from ESPN API
 * Uses your existing 12k player database with ESPN IDs
 */

class ESPNPlayerStatsService {
  constructor(supabase) {
    this.supabase = supabase;
    this.baseUrl = 'https://site.api.espn.com/apis/site/v2/sports';
    this.cacheHours = 12; // Cache stats for 12 hours
  }

  /**
   * Get recent stats for a player (last 5 games)
   * @param {string} playerName - Player name from odds/props
   * @param {string} sport - NFL, NBA, MLB, NHL
   * @returns {Object} Player stats summary
   */
  async getPlayerStats(playerName, sport) {
    try {
      // 1. Find player in database
      const player = await this.findPlayer(playerName, sport);
      if (!player) {
        console.log(`⚠️ Player not found in DB: ${playerName} (${sport})`);
        return null;
      }

      // 2. Check cache first
      const cached = await this.getCachedStats(player.espn_id, sport);
      if (cached && this.isCacheFresh(cached.updated_at)) {
        console.log(`✅ Cache hit for ${playerName}`);
        return cached.stats;
      }

      // 3. Fetch from ESPN
      console.log(`🔍 Fetching fresh stats for ${playerName} (ESPN ID: ${player.espn_id})`);
      const stats = await this.fetchPlayerStatsFromESPN(player.espn_id, sport);
      
      if (stats) {
        // 4. Cache the results
        await this.cacheStats(player.espn_id, sport, stats);
        return stats;
      }

      return null;

    } catch (error) {
      console.error(`❌ Error getting stats for ${playerName}:`, error.message);
      return null;
    }
  }

  /**
   * Find player in database by name (fuzzy match)
   */
  async findPlayer(playerName, sport) {
    // Try exact match first
    let { data: player } = await this.supabase
      .from('players')
      .select('id, espn_id, name, position, current_team_id')
      .eq('sport', sport)
      .ilike('name', playerName)
      .single();

    if (player) return player;

    // Try fuzzy match (handle "J. Smith" vs "John Smith")
    const { data: players } = await this.supabase
      .from('players')
      .select('id, espn_id, name, position, current_team_id')
      .eq('sport', sport)
      .ilike('name', `%${playerName.split(' ').pop()}%`) // Match last name
      .limit(5);

    if (players && players.length > 0) {
      // Return first match (could be improved with better fuzzy logic)
      return players[0];
    }

    return null;
  }

  /**
   * Fetch player stats from ESPN API
   */
  async fetchPlayerStatsFromESPN(espnId, sport) {
    try {
      const sportPath = this.getSportPath(sport);
      const url = `${this.baseUrl}/${sportPath}/athletes/${espnId}/gamelog`;
      
      const response = await fetch(url);
      if (!response.ok) {
        console.log(`⚠️ ESPN API returned ${response.status} for player ${espnId}`);
        return null;
      }

      const data = await response.json();
      
      // Parse stats based on sport
      return this.parsePlayerStats(data, sport);

    } catch (error) {
      console.error(`❌ Error fetching from ESPN:`, error.message);
      return null;
    }
  }

  /**
   * Parse player stats based on sport
   */
  parsePlayerStats(data, sport) {
    if (!data.events || data.events.length === 0) {
      return null;
    }

    // Get last 5 games
    const recentGames = data.events.slice(0, 5);
    
    switch (sport) {
      case 'NFL':
        return this.parseNFLStats(recentGames, data);
      case 'NBA':
        return this.parseNBAStats(recentGames, data);
      case 'MLB':
        return this.parseMLBStats(recentGames, data);
      case 'NHL':
        return this.parseNHLStats(recentGames, data);
      default:
        return null;
    }
  }

  /**
   * Parse NFL player stats (QB, RB, WR, etc.)
   */
  parseNFLStats(games, fullData) {
    const position = fullData.athlete?.position?.abbreviation || 'N/A';
    const stats = {
      position,
      games_played: games.length,
      last_5_games: []
    };

    // Aggregate stats based on position
    if (position === 'QB') {
      stats.passing_yards = this.calculateAverage(games, 'passingYards');
      stats.passing_tds = this.calculateAverage(games, 'passingTouchdowns');
      stats.interceptions = this.calculateAverage(games, 'interceptions');
      stats.completion_pct = this.calculateAverage(games, 'completionPct');
    } else if (['RB', 'FB'].includes(position)) {
      stats.rushing_yards = this.calculateAverage(games, 'rushingYards');
      stats.rushing_tds = this.calculateAverage(games, 'rushingTouchdowns');
      stats.receptions = this.calculateAverage(games, 'receptions');
      stats.receiving_yards = this.calculateAverage(games, 'receivingYards');
    } else if (['WR', 'TE'].includes(position)) {
      stats.receptions = this.calculateAverage(games, 'receptions');
      stats.receiving_yards = this.calculateAverage(games, 'receivingYards');
      stats.receiving_tds = this.calculateAverage(games, 'receivingTouchdowns');
      stats.targets = this.calculateAverage(games, 'targets');
    }

    // Store individual game stats for trend analysis
    stats.last_5_games = games.map(g => ({
      date: g.gameDate,
      opponent: g.opponent?.abbreviation,
      stats: this.extractGameStats(g.stats, position)
    }));

    return stats;
  }

  /**
   * Parse NBA player stats
   */
  parseNBAStats(games, fullData) {
    const stats = {
      position: fullData.athlete?.position?.abbreviation || 'N/A',
      games_played: games.length,
      points: this.calculateAverage(games, 'points'),
      rebounds: this.calculateAverage(games, 'rebounds'),
      assists: this.calculateAverage(games, 'assists'),
      threes_made: this.calculateAverage(games, 'threePointFieldGoalsMade'),
      last_5_games: games.map(g => ({
        date: g.gameDate,
        opponent: g.opponent?.abbreviation,
        stats: this.extractGameStats(g.stats, 'NBA')
      }))
    };

    return stats;
  }

  /**
   * Parse MLB player stats
   */
  parseMLBStats(games, fullData) {
    const position = fullData.athlete?.position?.abbreviation || 'N/A';
    const isPitcher = position === 'P' || position === 'SP' || position === 'RP';

    const stats = {
      position,
      games_played: games.length,
      last_5_games: []
    };

    if (isPitcher) {
      stats.innings_pitched = this.calculateAverage(games, 'inningsPitched');
      stats.strikeouts = this.calculateAverage(games, 'strikeouts');
      stats.earned_runs = this.calculateAverage(games, 'earnedRuns');
      stats.walks = this.calculateAverage(games, 'walks');
    } else {
      stats.hits = this.calculateAverage(games, 'hits');
      stats.home_runs = this.calculateAverage(games, 'homeRuns');
      stats.rbis = this.calculateAverage(games, 'runsBattedIn');
      stats.batting_avg = this.calculateAverage(games, 'battingAverage');
    }

    stats.last_5_games = games.map(g => ({
      date: g.gameDate,
      opponent: g.opponent?.abbreviation,
      stats: this.extractGameStats(g.stats, position)
    }));

    return stats;
  }

  /**
   * Parse NHL player stats
   */
  parseNHLStats(games, fullData) {
    const position = fullData.athlete?.position?.abbreviation || 'N/A';
    const isGoalie = position === 'G';

    const stats = {
      position,
      games_played: games.length,
      last_5_games: []
    };

    if (isGoalie) {
      stats.saves = this.calculateAverage(games, 'saves');
      stats.goals_against = this.calculateAverage(games, 'goalsAgainst');
      stats.save_pct = this.calculateAverage(games, 'savePercentage');
    } else {
      stats.goals = this.calculateAverage(games, 'goals');
      stats.assists = this.calculateAverage(games, 'assists');
      stats.points = this.calculateAverage(games, 'points');
      stats.shots = this.calculateAverage(games, 'shots');
    }

    stats.last_5_games = games.map(g => ({
      date: g.gameDate,
      opponent: g.opponent?.abbreviation,
      stats: this.extractGameStats(g.stats, position)
    }));

    return stats;
  }

  /**
   * Calculate average of a stat across games
   */
  calculateAverage(games, statKey) {
    const values = games
      .map(g => {
        const stat = g.stats?.find(s => s.name === statKey);
        return parseFloat(stat?.value) || 0;
      })
      .filter(v => v > 0);

    if (values.length === 0) return 0;
    return (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
  }

  /**
   * Extract game stats for last 5 games detail
   */
  extractGameStats(stats, position) {
    if (!stats) return {};
    
    const extracted = {};
    stats.forEach(stat => {
      extracted[stat.name] = stat.value;
    });
    return extracted;
  }

  /**
   * Cache stats in player_stats_cache table
   */
  async cacheStats(espnId, sport, stats) {
    try {
      await this.supabase
        .from('player_stats_cache')
        .upsert({
          espn_id: espnId,
          sport,
          stats: stats,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'espn_id,sport'
        });
      
      console.log(`✅ Cached stats for ESPN ID ${espnId}`);
    } catch (error) {
      console.error(`❌ Error caching stats:`, error.message);
    }
  }

  /**
   * Get cached stats from database
   */
  async getCachedStats(espnId, sport) {
    try {
      const { data, error } = await this.supabase
        .from('player_stats_cache')
        .select('stats, updated_at')
        .eq('espn_id', espnId)
        .eq('sport', sport)
        .single();

      if (error) return null;
      return data;

    } catch (error) {
      return null;
    }
  }

  /**
   * Check if cached data is still fresh
   */
  isCacheFresh(updatedAt) {
    const cacheAge = Date.now() - new Date(updatedAt).getTime();
    const maxAge = this.cacheHours * 60 * 60 * 1000;
    return cacheAge < maxAge;
  }

  /**
   * Get ESPN sport path
   */
  getSportPath(sport) {
    const paths = {
      'NFL': 'football/nfl',
      'NBA': 'basketball/nba',
      'MLB': 'baseball/mlb',
      'NHL': 'hockey/nhl'
    };
    return paths[sport] || 'football/nfl';
  }

  /**
   * Format stats for AI consumption
   */
  formatStatsForAI(playerName, stats, sport) {
    if (!stats) return '';

    const { position, games_played } = stats;
    let summary = `${playerName} (${position}): `;

    switch (sport) {
      case 'NFL':
        if (position === 'QB') {
          summary += `${stats.passing_yards} pass yds/game, ${stats.passing_tds} TDs/game (last ${games_played} games)`;
        } else if (['RB', 'FB'].includes(position)) {
          summary += `${stats.rushing_yards} rush yds/game, ${stats.receiving_yards} rec yds/game (last ${games_played} games)`;
        } else if (['WR', 'TE'].includes(position)) {
          summary += `${stats.receptions} rec/game, ${stats.receiving_yards} yds/game, ${stats.receiving_tds} TDs/game (last ${games_played} games)`;
        }
        break;
      
      case 'NBA':
        summary += `${stats.points} pts, ${stats.rebounds} reb, ${stats.assists} ast/game (last ${games_played} games)`;
        break;
      
      case 'MLB':
        if (stats.innings_pitched) {
          summary += `${stats.strikeouts} K/game, ${stats.earned_runs} ER/game (last ${games_played} games)`;
        } else {
          summary += `${stats.hits} H/game, ${stats.home_runs} HR/game, ${stats.batting_avg} AVG (last ${games_played} games)`;
        }
        break;
      
      case 'NHL':
        if (position === 'G') {
          summary += `${stats.saves} saves, ${stats.save_pct} SV% (last ${games_played} games)`;
        } else {
          summary += `${stats.goals} G, ${stats.assists} A/game (last ${games_played} games)`;
        }
        break;
    }

    return summary;
  }
}

module.exports = { ESPNPlayerStatsService };
