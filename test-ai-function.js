const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

class TestAIFunction {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  async getTeamStats(teamName, lastNGames = 3) {
    try {
      console.log(`📊 Testing getTeamStats for "${teamName}"...`);

      
      let wins = 0;
      let losses = 0;
      let ties = 0;
      let recordStr = '';

      // 1) Try to get true current record from API-Sports-backed standings (canonical source)
      const { data: standing, error: standingError } = await this.supabase
        .from('standings')
        .select(`
          *,
          teams!inner(name, sport)
        `)
        .eq('season', 2026)
        .ilike('teams.name', `%${teamName}%`)
        .maybeSingle();

      console.log('Standing query result:', standing, standingError);

      if (standing) {
        wins = standing.wins ?? 0;
        losses = standing.losses ?? 0;
        ties = standing.ties ?? 0;
        recordStr = `${wins}-${losses}${ties ? `-${ties}` : ''}`;
        console.log(`✓ Found standings for ${teamName}: ${recordStr}`);
      } else {
        console.warn(`⚠️ No standings found for ${teamName} (error: ${standingError?.message || 'none'})`);
      }

      // 2) Get season-level efficiency stats from team_stats_season
      // First get team_id from teams table, then query stats by ID
      const { data: teamRecord, error: teamError } = await this.supabase
        .from('teams')
        .select('id, name, sport')
        .ilike('name', `%${teamName}%`)
        .maybeSingle();

      console.log('Team record:', teamRecord, teamError);

      let metrics = null;
      let raw = [];
      
      if (teamRecord && teamRecord.id) {
        const { data: seasonStat, error: statError } = await this.supabase
          .from('team_stats_season')
          .select('*')
          .eq('team_id', teamRecord.id)
          .eq('season', 2026)
          .maybeSingle();

        console.log('Season stat:', seasonStat, statError);

        if (seasonStat && seasonStat.metrics) {
          metrics = seasonStat.metrics;
          raw = metrics.raw_stats || [];
        }
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
}

// Test with Duke
const test = new TestAIFunction();
test.getTeamStats('Duke Blue Devils').then(result => {
  console.log('\nFinal result:', JSON.stringify(result, null, 2));
});
