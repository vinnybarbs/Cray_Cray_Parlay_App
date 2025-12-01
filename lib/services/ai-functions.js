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
      
      // First, resolve the player in our DB by name (and optionally team)
      const player = await this.resolvePlayerByNameAndTeam(playerName, team);

      if (!player) {
        return { success: false, message: `Player not found: ${playerName}` };
      }

      console.log(`✓ Resolved player: ${player.name} (${player.position || 'N/A'}) [id=${player.id}]`);

      // Query player_game_stats by player_id
      const { data, error } = await this.supabase
        .from('player_game_stats')
        .select('*')
        .eq('player_id', player.id)
        .order('game_date', { ascending: false })
        .limit(lastNGames);

      if (error) throw error;

      if (!data || data.length === 0) {
        return { success: false, message: `No game stats found for ${player.name}` };
      }

      console.log(`✓ Found ${data.length} games for ${player.name}`);


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
   * Internal helper: resolve a player record from a fuzzy name (and optional team) as seen in odds feeds.
   * Prefers NFL players and supports aliases.
   */
  async resolvePlayerByNameAndTeam(playerName, team) {
    try {
      const normalizedName = (playerName || '').trim();
      const normalizedTeam = (team || '').trim();

      if (!normalizedName) {
        return null;
      }

      console.log(`🔎 Resolving player by name="${normalizedName}" team="${normalizedTeam}"`);

      // 1) Try alias table first (handles variations like initials, nicknames, etc.)
      const { data: aliasMatches, error: aliasError } = await this.supabase
        .from('player_aliases')
        .select('player_id')
        .ilike('sport', 'nfl')
        .ilike('alias', `%${normalizedName}%`);

      if (aliasError) {
        console.warn('⚠️  Error querying player_aliases:', aliasError.message);
      }

      if (aliasMatches && aliasMatches.length > 0) {
        const aliasIds = aliasMatches.map(a => a.player_id).filter(Boolean);
        if (aliasIds.length > 0) {
          const { data: aliasPlayers, error: aliasPlayersError } = await this.supabase
            .from('players')
            .select('id, name, position, league, sport')
            .in('id', aliasIds)
            .ilike('sport', 'nfl');

          if (!aliasPlayersError && aliasPlayers && aliasPlayers.length > 0) {
            // If team is provided, in the future we can refine selection by current_team_id / team_id.
            return aliasPlayers[0];
          }
        }
      }

      // 2) Fallback: fuzzy match on players.name within NFL
      const { data: players, error: playerError } = await this.supabase
        .from('players')
        .select('id, name, position, league, sport')
        .ilike('name', `%${normalizedName}%`)
        .ilike('sport', 'nfl')
        .limit(5);

      if (playerError) {
        console.warn('⚠️  Error querying players by name:', playerError.message);
        return null;
      }

      if (!players || players.length === 0) {
        console.log(`ℹ️  No players matched name="${normalizedName}" in players table`);
        return null;
      }

      if (players.length > 1) {
        console.log(`ℹ️  Multiple players matched "${normalizedName}", choosing first:`, players.map(p => p.name));
      }

      return players[0];
    } catch (err) {
      console.error('Error in resolvePlayerByNameAndTeam:', err);
      return null;
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

      let wins = 0;
      let losses = 0;
      let ties = 0;
      let recordStr = '';

      // 1) Try to get true current record from API-Sports-backed standings (canonical source)
      const { data: standing, error: standingError } = await this.supabase
        .from('current_standings')
        .select('*')
        .ilike('team_name', `%${teamName}%`)
        .maybeSingle();

      if (standing) {
        wins = standing.wins ?? 0;
        losses = standing.losses ?? 0;
        ties = standing.ties ?? 0;
        recordStr = `${wins}-${losses}${ties ? `-${ties}` : ''}`;
        console.log(`✓ Found standings for ${teamName}: ${recordStr}`);
      } else {
        console.warn(`⚠️ No standings found for ${teamName} in current_standings (error: ${standingError?.message || 'none'})`);
      }

      // 2) Get season-level efficiency stats from team_stats_season
      // First get team_id from teams table, then query stats by ID
      const { data: teamRecord, error: teamError } = await this.supabase
        .from('teams')
        .select('id, name')
        .ilike('name', `%${teamName}%`)
        .maybeSingle();

      let metrics = null;
      let raw = [];
      
      if (teamRecord && teamRecord.id) {
        const { data: seasonStat, error: statError } = await this.supabase
          .from('team_stats_season')
          .select('*')
          .eq('team_id', teamRecord.id)
          .eq('season', 2025)
          .maybeSingle();

        if (seasonStat && seasonStat.metrics) {
          metrics = seasonStat.metrics;
          raw = metrics.raw_stats || [];
          console.log(`✓ Found team_stats_season for ${teamName} (${teamRecord.id})`);
          
          // Fallback: if no standings data, try to extract from team_stats_season
          if (!recordStr && metrics.wins !== undefined && metrics.losses !== undefined) {
            wins = metrics.wins;
            losses = metrics.losses;
            recordStr = `${wins}-${losses}`;
            console.log(`✓ Using fallback record from team_stats_season for ${teamName}: ${recordStr}`);
          }
        } else {
          console.warn(`⚠️ No team_stats_season found for ${teamName} (${teamRecord.id})`);
        }
      } else {
        console.warn(`⚠️ Team not found in teams table: ${teamName}`);
      }
      
      // If we still have no record, return a minimal response
      if (!recordStr) {
        console.warn(`⚠️ No record found for ${teamName} in any source, using placeholder`);
        recordStr = 'N/A';
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
          pointsPerGame: Number.isFinite(ppg) && ppg > 0 ? ppg.toFixed(1) : null,
          pointsAllowedPerGame: Number.isFinite(papg) && papg > 0 ? papg.toFixed(1) : null,
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
