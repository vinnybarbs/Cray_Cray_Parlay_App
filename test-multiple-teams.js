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

      if (standing) {
        wins = standing.wins ?? 0;
        losses = standing.losses ?? 0;
        ties = standing.ties ?? 0;
        recordStr = `${wins}-${losses}${ties ? `-${ties}` : ''}`;
        console.log(`✓ Found standings for ${teamName}: ${recordStr}`);
      } else {
        console.warn(`⚠️ No standings found for ${teamName} (error: ${standingError?.message || 'none'})`);
      }

      return {
        success: true,
        team: teamName,
        record: recordStr || 'N/A',
        stats: {
          wins,
          losses,
          pointsPerGame: null,
          pointsAllowedPerGame: null,
          pointDifferential: 0,
          winPct: wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) + '%' : null
        }
      };
    } catch (error) {
      console.error('Error in getTeamStats:', error);
      return { success: false, error: error.message };
    }
  }
}

async function testMultipleTeams() {
  const tester = new TestAIFunction();
  const teams = ['UConn Huskies', 'Houston Cougars', 'Arizona Wildcats'];
  
  for (const team of teams) {
    const result = await tester.getTeamStats(team);
    console.log(`${team}: ${result.record} (${result.stats.winPct})\n`);
  }
}

testMultipleTeams();
