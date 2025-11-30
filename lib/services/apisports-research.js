/**
 * API-Sports Research Helper
 * Fetches stats and injuries for pick analysis
 */

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../../shared/logger');

class ApiSportsResearch {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  /**
   * Get current injuries for teams in games
   */
  async getInjuriesForGames(games) {
    try {
      const teamNames = [...new Set(games.map(g => [g.home_team, g.away_team]).flat())];
      
      if (teamNames.length === 0) return {};

      const injuries = {};

      for (const teamName of teamNames) {
        const { data, error } = await this.supabase
          .from('current_injuries_by_team')
          .select('*')
          .ilike('team_name', `%${teamName}%`);

        if (error) {
          logger.error(`Error fetching injuries for ${teamName}:`, error);
          continue;
        }

        if (data && data.length > 0) {
          injuries[teamName] = data.map(inj => ({
            player: inj.player_name,
            position: inj.position,
            status: inj.status,
            injury: inj.injury_type,
            description: inj.description
          }));
        }
      }

      return injuries;

    } catch (error) {
      logger.error('Error fetching injuries:', error);
      return {};
    }
  }

  /**
   * Get team standings/records
   */
  async getTeamRecords(teamNames) {
    try {
      const records = {};

      for (const teamName of teamNames) {
        const { data, error } = await this.supabase
          .from('current_standings')
          .select('*')
          .ilike('team_name', `%${teamName}%`)
          .single();

        if (error) {
          logger.error(`Error fetching record for ${teamName}:`, error);
          continue;
        }

        if (data) {
          records[teamName] = {
            wins: data.wins,
            losses: data.losses,
            ties: data.ties || 0,
            record: `${data.wins}-${data.losses}${data.ties ? `-${data.ties}` : ''}`,
            winPercentage: data.win_percentage,
            pointDifferential: data.point_differential,
            streak: data.streak,
            divisionRank: data.division_rank,
            conference: data.conference,
            division: data.division
          };
        }
      }

      return records;

    } catch (error) {
      logger.error('Error fetching team records:', error);
      return {};
    }
  }

  /**
   * Get player recent performance (last 5 games)
   */
  async getPlayerRecentStats(playerName) {
    try {
      const { data, error } = await this.supabase
        .from('player_recent_performance')
        .select('*')
        .ilike('player_name', `%${playerName}%`)
        .order('game_date', { ascending: false })
        .limit(5);

      if (error) throw error;

      if (!data || data.length === 0) return null;

      // Calculate averages
      const stats = {
        player: data[0].player_name,
        position: data[0].position,
        team: data[0].team_name,
        gamesPlayed: data.length,
        recentGames: data.map(g => ({
          date: g.game_date,
          passingYards: g.passing_yards,
          rushingYards: g.rushing_yards,
          receivingYards: g.receiving_yards,
          totalTDs: g.total_tds
        })),
        averages: {
          passingYards: this.avg(data.map(d => d.passing_yards)),
          rushingYards: this.avg(data.map(d => d.rushing_yards)),
          receivingYards: this.avg(data.map(d => d.receiving_yards)),
          totalTDs: this.avg(data.map(d => d.total_tds))
        }
      };

      return stats;

    } catch (error) {
      logger.error(`Error fetching player stats for ${playerName}:`, error);
      return null;
    }
  }

  /**
   * Get team recent game stats (last 3 games)
   */
  async getTeamRecentStats(teamNames, numGames = 3) {
    try {
      const stats = {};

      for (const teamName of teamNames) {
        // Get team from database
        const { data: team } = await this.supabase
          .from('teams')
          .select('id')
          .ilike('name', `%${teamName}%`)
          .eq('apisports_league', 'nfl')
          .maybeSingle();

        if (!team) continue;

        // Get recent game stats
        const { data: gameStats } = await this.supabase
          .from('team_stats_detailed')
          .select('*')
          .eq('team_id', team.id)
          .order('week', { ascending: false })
          .limit(numGames);

        if (gameStats && gameStats.length > 0) {
          stats[teamName] = {
            recentGames: gameStats.map(g => ({
              week: g.week,
              points: g.points_per_game,
              totalYards: g.total_yards_per_game,
              passingYards: g.passing_yards_per_game,
              rushingYards: g.rushing_yards_per_game,
              turnovers: g.turnovers_lost
            })),
            averages: {
              points: this.avg(gameStats.map(g => g.points_per_game)),
              totalYards: this.avg(gameStats.map(g => g.total_yards_per_game)),
              passingYards: this.avg(gameStats.map(g => g.passing_yards_per_game)),
              rushingYards: this.avg(gameStats.map(g => g.rushing_yards_per_game)),
              turnovers: this.avg(gameStats.map(g => g.turnovers_lost))
            }
          };
        }
      }

      return stats;

    } catch (error) {
      logger.error('Error fetching team recent stats:', error);
      return {};
    }
  }

  /**
   * Get top performers for teams (passing/rushing/receiving leaders)
   */
  async getTopPerformers(teamNames) {
    try {
      const performers = {};

      for (const teamName of teamNames) {
        // Get team from database
        const { data: team } = await this.supabase
          .from('teams')
          .select('id')
          .ilike('name', `%${teamName}%`)
          .eq('apisports_league', 'nfl')
          .maybeSingle();

        if (!team) continue;

        // Get top passer
        const { data: topPasser } = await this.supabase
          .from('player_game_stats')
          .select('player_id, players!inner(name), passing_yards, passing_touchdowns')
          .eq('players.team_id', team.id)
          .not('passing_yards', 'is', null)
          .order('passing_yards', { ascending: false })
          .limit(1)
          .maybeSingle();

        // Get top rusher
        const { data: topRusher } = await this.supabase
          .from('player_game_stats')
          .select('player_id, players!inner(name), rushing_yards, rushing_touchdowns')
          .eq('players.team_id', team.id)
          .not('rushing_yards', 'is', null)
          .order('rushing_yards', { ascending: false })
          .limit(1)
          .maybeSingle();

        // Get top receiver
        const { data: topReceiver } = await this.supabase
          .from('player_game_stats')
          .select('player_id, players!inner(name), receiving_yards, receiving_touchdowns, receptions')
          .eq('players.team_id', team.id)
          .not('receiving_yards', 'is', null)
          .order('receiving_yards', { ascending: false })
          .limit(1)
          .maybeSingle();

        performers[teamName] = {
          topPasser: topPasser ? {
            name: topPasser.players.name,
            yards: topPasser.passing_yards,
            touchdowns: topPasser.passing_touchdowns
          } : null,
          topRusher: topRusher ? {
            name: topRusher.players.name,
            yards: topRusher.rushing_yards,
            touchdowns: topRusher.rushing_touchdowns
          } : null,
          topReceiver: topReceiver ? {
            name: topReceiver.players.name,
            yards: topReceiver.receiving_yards,
            touchdowns: topReceiver.receiving_touchdowns,
            receptions: topReceiver.receptions
          } : null
        };
      }

      return performers;

    } catch (error) {
      logger.error('Error fetching top performers:', error);
      return {};
    }
  }

  /**
   * Get comprehensive research for a game
   */
  async getGameResearch(homeTeam, awayTeam) {
    try {
      const research = {
        injuries: {},
        records: {},
        teamStats: {},
        topPerformers: {}
      };

      // Get injuries for both teams
      const injuries = await this.getInjuriesForGames([{ home_team: homeTeam, away_team: awayTeam }]);
      research.injuries = injuries;

      // Get records for both teams
      const records = await this.getTeamRecords([homeTeam, awayTeam]);
      research.records = records;

      // Get recent team stats (last 3 games)
      const teamStats = await this.getTeamRecentStats([homeTeam, awayTeam], 3);
      research.teamStats = teamStats;

      // Get top performers
      const performers = await this.getTopPerformers([homeTeam, awayTeam]);
      research.topPerformers = performers;

      return research;

    } catch (error) {
      logger.error('Error getting game research:', error);
      return { injuries: {}, records: {}, teamStats: {}, topPerformers: {} };
    }
  }

  /**
   * Format research data for AI prompt
   */
  formatResearchForPrompt(research) {
    let formatted = '';

    // Format injuries
    if (Object.keys(research.injuries).length > 0) {
      formatted += '\n**INJURY REPORTS** (Current):\n';
      Object.entries(research.injuries).forEach(([team, injuries]) => {
        formatted += `\n${team}:\n`;
        injuries.forEach(inj => {
          formatted += `  - ${inj.player} (${inj.position}): ${inj.status} - ${inj.injury}\n`;
        });
      });
    }

    // Format records
    if (Object.keys(research.records).length > 0) {
      formatted += '\n**TEAM RECORDS & STANDINGS**:\n';
      Object.entries(research.records).forEach(([team, record]) => {
        formatted += `- ${team}: ${record.record} (${(record.winPercentage * 100).toFixed(1)}%)`;
        formatted += ` | ${record.conference} ${record.division} (Rank: #${record.divisionRank})`;
        formatted += ` | Point Diff: ${record.pointDifferential > 0 ? '+' : ''}${record.pointDifferential}`;
        formatted += ` | Streak: ${record.streak}\n`;
      });
    }

    // Format recent team stats
    if (Object.keys(research.teamStats || {}).length > 0) {
      formatted += '\n**RECENT PERFORMANCE** (Last 3 Games):\n';
      Object.entries(research.teamStats).forEach(([team, stats]) => {
        formatted += `\n${team} - Averages:\n`;
        formatted += `  Points: ${stats.averages.points} | Total Yards: ${stats.averages.totalYards}\n`;
        formatted += `  Passing: ${stats.averages.passingYards} yds | Rushing: ${stats.averages.rushingYards} yds\n`;
        formatted += `  Turnovers: ${stats.averages.turnovers} per game\n`;
      });
    }

    // Format top performers
    if (Object.keys(research.topPerformers || {}).length > 0) {
      formatted += '\n**KEY PLAYERS**:\n';
      Object.entries(research.topPerformers).forEach(([team, performers]) => {
        formatted += `\n${team}:\n`;
        if (performers.topPasser) {
          formatted += `  QB: ${performers.topPasser.name} (${performers.topPasser.yards} yds, ${performers.topPasser.touchdowns} TDs)\n`;
        }
        if (performers.topRusher) {
          formatted += `  RB: ${performers.topRusher.name} (${performers.topRusher.yards} yds, ${performers.topRusher.touchdowns} TDs)\n`;
        }
        if (performers.topReceiver) {
          formatted += `  WR: ${performers.topReceiver.name} (${performers.topReceiver.receptions} rec, ${performers.topReceiver.yards} yds, ${performers.topReceiver.touchdowns} TDs)\n`;
        }
      });
    }

    return formatted;
  }

  /**
   * Helper: Calculate average
   */
  avg(arr) {
    const filtered = arr.filter(x => x !== null && x !== undefined);
    if (filtered.length === 0) return null;
    return Math.round(filtered.reduce((a, b) => a + b, 0) / filtered.length * 10) / 10;
  }
}

module.exports = ApiSportsResearch;
