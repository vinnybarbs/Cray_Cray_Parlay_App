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
   * Get comprehensive research for a game
   */
  async getGameResearch(homeTeam, awayTeam) {
    try {
      const research = {
        injuries: {},
        records: {},
        stats: {}
      };

      // Get injuries for both teams
      const injuries = await this.getInjuriesForGames([{ home_team: homeTeam, away_team: awayTeam }]);
      research.injuries = injuries;

      // Get records for both teams
      const records = await this.getTeamRecords([homeTeam, awayTeam]);
      research.records = records;

      return research;

    } catch (error) {
      logger.error('Error getting game research:', error);
      return { injuries: {}, records: {}, stats: {} };
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
