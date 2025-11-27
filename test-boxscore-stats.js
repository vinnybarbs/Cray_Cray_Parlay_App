/**
 * Test ESPN Box Score Stats Fetching
 * Uses actual ESPN endpoints that work (scoreboards + box scores)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { ESPNPlayerStatsBoxScore } = require('./lib/services/espn-player-stats-boxscore');

async function testBoxScoreStats() {
  console.log('🧪 Testing ESPN Box Score Stats Service\n');
  
  // Initialize Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  // Initialize stats service
  const statsService = new ESPNPlayerStatsBoxScore(supabase);
  
  // Simulate players from prop odds
  const testPlayers = [
    'Lamar Jackson',
    'Patrick Mahomes', 
    'Tyreek Hill',
    'Travis Kelce',
    'Derrick Henry'
  ];
  
  console.log(`📊 Fetching stats for ${testPlayers.length} players with active props...\n`);
  
  try {
    console.log('📍 Debug: Starting stats fetch...\n');
    
    // Fetch stats using box score approach
    const playerStats = await statsService.getStatsForPlayers(testPlayers, 'NFL');
    
    console.log('\n' + '='.repeat(60));
    console.log('📈 RESULTS');
    console.log('='.repeat(60));
    
    if (Object.keys(playerStats).length === 0) {
      console.log('❌ No stats found. This could mean:');
      console.log('   - No recent NFL games (check date/season)');
      console.log('   - Player names don\'t match ESPN format');
      console.log('   - Box score structure changed');
    } else {
      console.log(`\n✅ Found stats for ${Object.keys(playerStats).length} players:\n`);
      
      for (const [playerName, stats] of Object.entries(playerStats)) {
        console.log(`\n${playerName}:`);
        console.log(JSON.stringify(stats, null, 2));
        
        const aiFormatted = statsService.formatStatsForAI(playerName, stats, 'NFL');
        console.log(`\n📝 AI Format: ${aiFormatted}`);
        console.log('-'.repeat(60));
      }
    }
    
    // Check cache
    console.log('\n' + '='.repeat(60));
    console.log('📦 Checking player_stats_cache...');
    console.log('='.repeat(60));
    
    const { data: cachedStats, error } = await supabase
      .from('player_stats_cache')
      .select('*')
      .eq('sport', 'NFL')
      .order('updated_at', { ascending: false })
      .limit(5);
    
    if (error) {
      console.error(`❌ Error: ${error.message}`);
      console.log('\n💡 Run database/phase2_player_stats.sql first!');
    } else if (cachedStats.length > 0) {
      console.log(`\n✅ Cache has ${cachedStats.length} entries`);
      cachedStats.forEach(stat => {
        console.log(`  - ESPN ID ${stat.espn_id}: ${stat.stats?.games_played || 0} games`);
      });
    } else {
      console.log('\n⚠️ Cache is empty');
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
  }
  
  console.log('\n✅ Test completed!');
}

testBoxScoreStats().catch(console.error);
