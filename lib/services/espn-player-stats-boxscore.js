/**
 * ESPN Player Stats via Box Scores
 * Works around ESPN's missing gamelog endpoint by:
 * 1. Fetching recent scoreboard (last 7 days)
 * 2. Getting box score for each game
 * 3. Extracting player stats from box scores
 * 4. ONLY polls players that appear in active prop odds (efficient!)
 */

class ESPNPlayerStatsBoxScore {
  constructor(supabase) {
    this.supabase = supabase;
    this.baseUrl = 'http://site.api.espn.com/apis/site/v2/sports';
    this.cacheHours = 12;
  }

  /**
   * Get stats for specific players (from prop odds)
   * @param {Array} playerNames - Array of player names from props
   * @param {string} sport - NFL, NBA, MLB, NHL
   */
  async getStatsForPlayers(playerNames, sport) {
    console.log(`📊 Fetching stats for ${playerNames.length} players with active props`);
    
    try {
      // 1. Get recent games (last 7 days)
      const recentGames = await this.getRecentGames(sport, 7);
      console.log(`✅ Found ${recentGames.length} recent ${sport} games`);
      
      if (recentGames.length === 0) {
        console.log('⚠️ No recent games found');
        return {};
      }
      
      // 2. Fetch box scores for games (with rate limiting)
      const playerStats = {};
      let gamesProcessed = 0;
      
      for (const game of recentGames.slice(0, 20)) { // Limit to 20 most recent
        try {
          const boxScore = await this.getBoxScore(game.id, sport);
          
          if (boxScore) {
            // Extract stats for players we care about
            this.extractPlayerStatsFromBoxScore(boxScore, playerNames, playerStats, sport);
            gamesProcessed++;
          }
          
          // Rate limiting: 500ms between requests
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.log(`⚠️ Error getting box score for game ${game.id}: ${error.message}`);
        }
      }
      
      console.log(`✅ Processed ${gamesProcessed} box scores, found stats for ${Object.keys(playerStats).length} players`);
      
      // 3. Calculate averages and format
      const formattedStats = {};
      for (const [playerName, games] of Object.entries(playerStats)) {
        formattedStats[playerName] = this.calculateAverages(games, sport);
      }
      
      // 4. Cache results
      await this.cachePlayerStats(formattedStats, sport);
      
      return formattedStats;
      
    } catch (error) {
      console.error(`❌ Error fetching player stats: ${error.message}`);
      return {};
    }
  }

  /**
   * Get recent games from ESPN scoreboard
   */
  async getRecentGames(sport, days = 7) {
    const sportPath = this.getSportPath(sport);
    const games = [];
    
    // Fetch scoreboards for last N days
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
      
      try {
        const url = `${this.baseUrl}/${sportPath}/scoreboard?dates=${dateStr}`;
        const response = await fetch(url);
        
        if (!response.ok) continue;
        
        const data = await response.json();
        
        // Only include completed games
        if (data.events) {
          for (const event of data.events) {
            if (event.status?.type?.state === 'post') {
              games.push({
                id: event.id,
                date: event.date,
                name: event.name
              });
            }
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        console.log(`⚠️ Error fetching scoreboard for ${dateStr}: ${error.message}`);
      }
    }
    
    return games;
  }

  /**
   * Get box score for a specific game
   */
  async getBoxScore(gameId, sport) {
    try {
      const sportPath = this.getSportPath(sport);
      const url = `${this.baseUrl}/${sportPath}/summary?event=${gameId}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        console.log(`⚠️ Box score ${response.status} for game ${gameId}`);
        return null;
      }
      
      const data = await response.json();
      return data;
      
    } catch (error) {
      console.error(`❌ Error fetching box score: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract player stats from box score
   */
  extractPlayerStatsFromBoxScore(boxScore, targetPlayers, playerStats, sport) {
    if (!boxScore.boxscore?.players) return;
    
    // Create normalized name map for matching
    const targetMap = new Map();
    targetPlayers.forEach(name => {
      targetMap.set(this.normalizeName(name), name);
    });
    
    // Parse box score structure
    for (const team of boxScore.boxscore.players) {
      if (!team.statistics) continue;
      
      for (const statGroup of team.statistics) {
        if (!statGroup.athletes) continue;
        
        for (const athlete of statGroup.athletes) {
          const playerName = athlete.athlete?.displayName || athlete.athlete?.name;
          if (!playerName) continue;
          
          const normalizedName = this.normalizeName(playerName);
          const targetName = targetMap.get(normalizedName);
          
          if (targetName) {
            // Found a player we're tracking!
            if (!playerStats[targetName]) {
              playerStats[targetName] = [];
            }
            
            // Extract stats based on sport
            const gameStats = this.parseAthleteStats(athlete, statGroup, sport);
            if (gameStats) {
              gameStats.gameDate = boxScore.header?.competitions?.[0]?.date;
              gameStats.opponent = this.getOpponent(boxScore, team.team?.id);
              playerStats[targetName].push(gameStats);
            }
          }
        }
      }
    }
  }

  /**
   * Parse athlete stats from box score
   */
  parseAthleteStats(athlete, statGroup, sport) {
    const stats = {};
    const statLabels = statGroup.labels || [];
    const statValues = athlete.stats || [];
    
    // Map labels to values
    statLabels.forEach((label, index) => {
      if (statValues[index] !== undefined) {
        stats[label.toLowerCase().replace(/\s+/g, '_')] = statValues[index];
      }
    });
    
    // Sport-specific parsing
    switch (sport) {
      case 'NFL':
        return this.parseNFLStats(stats);
      case 'NBA':
        return this.parseNBAStats(stats);
      case 'MLB':
        return this.parseMLBStats(stats);
      case 'NHL':
        return this.parseNHLStats(stats);
      default:
        return stats;
    }
  }

  parseNFLStats(stats) {
    return {
      passing_yards: parseFloat(stats.pass_yds || stats.yds || 0),
      passing_tds: parseInt(stats.pass_td || stats.td || 0),
      interceptions: parseInt(stats.int || 0),
      rushing_yards: parseFloat(stats.rush_yds || 0),
      rushing_tds: parseInt(stats.rush_td || 0),
      receptions: parseInt(stats.rec || 0),
      receiving_yards: parseFloat(stats.rec_yds || 0),
      receiving_tds: parseInt(stats.rec_td || 0),
      targets: parseInt(stats.tgt || 0)
    };
  }

  parseNBAStats(stats) {
    return {
      points: parseInt(stats.pts || 0),
      rebounds: parseInt(stats.reb || 0),
      assists: parseInt(stats.ast || 0),
      threes_made: parseInt(stats['3pt'] || stats.fg3m || 0),
      minutes: parseFloat(stats.min || 0)
    };
  }

  parseMLBStats(stats) {
    return {
      hits: parseInt(stats.h || 0),
      home_runs: parseInt(stats.hr || 0),
      rbis: parseInt(stats.rbi || 0),
      strikeouts: parseInt(stats.so || stats.k || 0),
      innings_pitched: parseFloat(stats.ip || 0),
      earned_runs: parseInt(stats.er || 0)
    };
  }

  parseNHLStats(stats) {
    return {
      goals: parseInt(stats.g || 0),
      assists: parseInt(stats.a || 0),
      points: parseInt(stats.pts || 0),
      shots: parseInt(stats.sog || 0),
      saves: parseInt(stats.sv || 0),
      goals_against: parseInt(stats.ga || 0)
    };
  }

  /**
   * Calculate averages from game stats
   */
  calculateAverages(games, sport) {
    if (games.length === 0) return null;
    
    const avgStats = {
      games_played: games.length,
      last_5_games: games.slice(-5)
    };
    
    // Get all stat keys from first game
    const statKeys = Object.keys(games[0]).filter(k => k !== 'gameDate' && k !== 'opponent');
    
    // Calculate averages
    statKeys.forEach(key => {
      const values = games.map(g => parseFloat(g[key]) || 0);
      const sum = values.reduce((a, b) => a + b, 0);
      avgStats[key] = (sum / games.length).toFixed(1);
    });
    
    return avgStats;
  }

  /**
   * Get opponent team name from box score
   */
  getOpponent(boxScore, teamId) {
    const teams = boxScore.boxscore?.teams || [];
    for (const team of teams) {
      if (team.team?.id !== teamId) {
        return team.team?.abbreviation || team.team?.displayName;
      }
    }
    return 'Unknown';
  }

  /**
   * Cache player stats in database
   */
  async cachePlayerStats(playerStats, sport) {
    try {
      for (const [playerName, stats] of Object.entries(playerStats)) {
        if (!stats) continue;
        
        // Find player in database
        const { data: player } = await this.supabase
          .from('players')
          .select('espn_id')
          .eq('sport', sport)
          .ilike('name', playerName)
          .single();
        
        if (player && player.espn_id) {
          await this.supabase
            .from('player_stats_cache')
            .upsert({
              espn_id: player.espn_id,
              sport,
              stats,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'espn_id,sport'
            });
        }
      }
      
      console.log(`✅ Cached stats for ${Object.keys(playerStats).length} players`);
      
    } catch (error) {
      console.error(`❌ Error caching stats: ${error.message}`);
    }
  }

  /**
   * Normalize player name for matching
   */
  normalizeName(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
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
    
    const { games_played } = stats;
    let summary = `${playerName}: `;
    
    switch (sport) {
      case 'NFL':
        if (stats.passing_yards > 0) {
          summary += `${stats.passing_yards} pass yds/game, ${stats.passing_tds} pass TDs/game`;
        } else if (stats.rushing_yards > 0) {
          summary += `${stats.rushing_yards} rush yds/game, ${stats.receiving_yards} rec yds/game`;
        } else if (stats.receiving_yards > 0) {
          summary += `${stats.receptions} rec/game, ${stats.receiving_yards} rec yds/game, ${stats.receiving_tds} TDs/game`;
        }
        break;
      
      case 'NBA':
        summary += `${stats.points} pts, ${stats.rebounds} reb, ${stats.assists} ast/game`;
        break;
      
      case 'MLB':
        if (stats.innings_pitched > 0) {
          summary += `${stats.strikeouts} K/game, ${stats.earned_runs} ER/game`;
        } else {
          summary += `${stats.hits} H/game, ${stats.home_runs} HR/game`;
        }
        break;
      
      case 'NHL':
        if (stats.saves > 0) {
          summary += `${stats.saves} saves/game`;
        } else {
          summary += `${stats.goals} G, ${stats.assists} A/game`;
        }
        break;
    }
    
    summary += ` (last ${games_played} games)`;
    return summary;
  }
}

module.exports = { ESPNPlayerStatsBoxScore };
