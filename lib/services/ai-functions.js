/**
 * AI Functions - Database query functions for OpenAI Function Calling
 * Allows AI to dynamically query specific data instead of receiving everything upfront
 */

class AIFunctions {
  constructor(supabase) {
    this.supabase = supabase;
  }

  /**
   * Get player stats for a specific player
   * @param {string} playerName - Player's full name
   * @param {string} team - Team name
   * @param {string} statType - 'passing', 'rushing', 'receiving'
   * @param {number} lastNGames - Number of recent games to analyze (default 5)
   */
  async getPlayerStats(playerName, team, statType = 'passing', lastNGames = 5) {
    try {
      console.log(`📊 AI Function: getPlayerStats("${playerName}", "${team}", "${statType}", ${lastNGames})`);
      
      // Query player_game_stats table
      const { data, error } = await this.supabase
        .from('player_game_stats')
        .select('*')
        .ilike('player_name', `%${playerName}%`)
        .order('game_date', { ascending: false })
        .limit(lastNGames);

      if (error) throw error;

      if (!data || data.length === 0) {
        return { success: false, message: `No stats found for ${playerName}` };
      }

      // Calculate averages based on stat type
      let stats = {};
      if (statType === 'passing') {
        const totalYards = data.reduce((sum, g) => sum + (g.passing_yards || 0), 0);
        const totalTDs = data.reduce((sum, g) => sum + (g.passing_tds || 0), 0);
        const totalCompletions = data.reduce((sum, g) => sum + (g.passing_completions || 0), 0);
        stats = {
          avgYards: (totalYards / data.length).toFixed(1),
          avgTDs: (totalTDs / data.length).toFixed(1),
          avgCompletions: (totalCompletions / data.length).toFixed(1),
          games: data.length
        };
      } else if (statType === 'rushing') {
        const totalYards = data.reduce((sum, g) => sum + (g.rushing_yards || 0), 0);
        const totalTDs = data.reduce((sum, g) => sum + (g.rushing_tds || 0), 0);
        stats = {
          avgYards: (totalYards / data.length).toFixed(1),
          avgTDs: (totalTDs / data.length).toFixed(1),
          games: data.length
        };
      } else if (statType === 'receiving') {
        const totalYards = data.reduce((sum, g) => sum + (g.receiving_yards || 0), 0);
        const totalReceptions = data.reduce((sum, g) => sum + (g.receptions || 0), 0);
        const totalTDs = data.reduce((sum, g) => sum + (g.receiving_tds || 0), 0);
        stats = {
          avgYards: (totalYards / data.length).toFixed(1),
          avgReceptions: (totalReceptions / data.length).toFixed(1),
          avgTDs: (totalTDs / data.length).toFixed(1),
          games: data.length
        };
      }

      return {
        success: true,
        player: playerName,
        team,
        statType,
        lastNGames,
        stats
      };
    } catch (error) {
      console.error('Error in getPlayerStats:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get team stats for recent games
   * @param {string} teamName - Team name
   * @param {number} lastNGames - Number of recent games (default 3)
   */
  async getTeamStats(teamName, lastNGames = 3) {
    try {
      console.log(`📊 AI Function: getTeamStats("${teamName}", ${lastNGames})`);

      // 1) Get true current record from API-Sports-backed standings (canonical source)
      const { data: standing, error: standingError } = await this.supabase
        .from('current_standings')
        .select('*')
        .ilike('team_name', `%${teamName}%`)
        .maybeSingle();

      if (standingError || !standing) {
        return { success: false, message: `No standings found for ${teamName}` };
      }

      const wins = standing.wins ?? 0;
      const losses = standing.losses ?? 0;
      const recordStr = `${wins}-${losses}${standing.ties ? `-${standing.ties}` : ''}`;

      // 2) Get season-level efficiency stats from team_stats_season (optional)
      const { data: allStats, error } = await this.supabase
        .from('team_stats_season')
        .select('*')
        .eq('season', 2025);

      let metrics = null;
      let raw = [];
      if (!error && Array.isArray(allStats) && allStats.length > 0) {
        const candidate = allStats.find(stat => stat.team_name && stat.team_name.toLowerCase().includes(teamName.toLowerCase()));
        if (candidate && candidate.metrics) {
          metrics = candidate.metrics;
          raw = metrics.raw_stats || [];
        }
      }
      
      // Extract stats from raw_stats array
      const getStat = (name) => {
        const stat = raw.find(s => s.name === name || s.type === name);
        return stat ? parseFloat(stat.value) : 0;
      };
      
      const ppg = getStat('avgPointsFor');
      const papg = getStat('avgPointsAgainst');
      const diff = getStat('pointDifferential');

      return {
        success: true,
        team: teamName,
        record: recordStr,
        stats: {
          wins,
          losses,
          pointsPerGame: Number.isFinite(ppg) ? ppg.toFixed(1) : null,
          pointsAllowedPerGame: Number.isFinite(papg) ? papg.toFixed(1) : null,
          pointDifferential: Number.isFinite(diff) ? diff : null,
          winPct: wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) + '%' : null
        }
      };
    } catch (error) {
      console.error('Error in getTeamStats:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get team record and standings
   * @param {string} teamName - Team name
   */
  async getTeamRecord(teamName) {
    try {
      console.log(`📊 AI Function: getTeamRecord("${teamName}")`);

      const { data: teams, error: teamError } = await this.supabase
        .from('teams')
        .select('id, name, wins, losses, record')
        .ilike('name', `%${teamName}%`)
        .limit(1);

      if (teamError || !teams || teams.length === 0) {
        return { success: false, message: `Team not found: ${teamName}` };
      }

      const team = teams[0];
      const winPct = team.wins + team.losses > 0 
        ? ((team.wins / (team.wins + team.losses)) * 100).toFixed(1) 
        : '0.0';

      return {
        success: true,
        team: team.name,
        record: team.record || `${team.wins}-${team.losses}`,
        wins: team.wins,
        losses: team.losses,
        winPercentage: winPct
      };
    } catch (error) {
      console.error('Error in getTeamRecord:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get current injuries for a team
   * @param {string} teamName - Team name
   */
  async getInjuries(teamName) {
    try {
      console.log(`📊 AI Function: getInjuries("${teamName}")`);

      const { data, error } = await this.supabase
        .from('injuries')
        .select('*')
        .ilike('team', `%${teamName}%`)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      if (!data || data.length === 0) {
        return { 
          success: true, 
          team: teamName,
          injuries: [],
          message: 'No injuries reported'
        };
      }

      const injuries = data.map(inj => ({
        player: inj.player,
        position: inj.position,
        status: inj.status,
        injury: inj.injury
      }));

      return {
        success: true,
        team: teamName,
        injuries,
        count: injuries.length
      };
    } catch (error) {
      console.error('Error in getInjuries:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get head-to-head history between two teams
   * @param {string} team1 - First team name
   * @param {string} team2 - Second team name
   * @param {number} lastNGames - Number of recent matchups (default 3)
   */
  async getHeadToHead(team1, team2, lastNGames = 3) {
    try {
      console.log(`📊 AI Function: getHeadToHead("${team1}", "${team2}", ${lastNGames})`);

      // This would query a games/matchups table if we had one
      // For now, return placeholder
      return {
        success: true,
        team1,
        team2,
        message: 'Head-to-head data not yet available in database',
        lastNGames: 0
      };
    } catch (error) {
      console.error('Error in getHeadToHead:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get news insights for a team
   * @param {string} teamName - Team name
   */
  async getNewsInsights(teamName) {
    try {
      console.log(`📊 AI Function: getNewsInsights("${teamName}")`);

      const { data, error } = await this.supabase
        .from('news_articles')
        .select('*')
        .ilike('team', `%${teamName}%`)
        .not('summary', 'is', null)
        .order('published_at', { ascending: false })
        .limit(5);

      if (error) throw error;

      if (!data || data.length === 0) {
        return {
          success: true,
          team: teamName,
          insights: [],
          message: 'No recent news'
        };
      }

      const insights = data.map(article => ({
        headline: article.title,
        insights: article.summary?.insights || [],
        sentiment: article.summary?.sentiment || 'neutral',
        date: article.published_at
      }));

      return {
        success: true,
        team: teamName,
        insights,
        count: insights.length
      };
    } catch (error) {
      console.error('Error in getNewsInsights:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = { AIFunctions };
