/**
 * Test ESPN Player Stats Service
 * Fetches recent stats for a few test players to verify Phase 2 setup
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { ESPNPlayerStatsService } = require('./lib/services/espn-player-stats');

async function testPlayerStats() {
  console.log('🧪 Testing ESPN Player Stats Service\n');
  
  // Initialize Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  // Initialize stats service
  const statsService = new ESPNPlayerStatsService(supabase);
  
  // Test players across different sports
  const testPlayers = [
    { name: 'Lamar Jackson', sport: 'NFL' },
    { name: 'Patrick Mahomes', sport: 'NFL' },
    { name: 'LeBron James', sport: 'NBA' },
    { name: 'Stephen Curry', sport: 'NBA' }
  ];
  
  console.log('📊 Fetching stats for test players...\n');
  
  for (const player of testPlayers) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${player.name} (${player.sport})`);
    console.log('='.repeat(60));
    
    try {
      // Fetch stats
      const stats = await statsService.getPlayerStats(player.name, player.sport);
      
      if (stats) {
        console.log('✅ Stats fetched successfully!');
        console.log('\nStats Summary:');
        console.log(JSON.stringify(stats, null, 2));
        
        // Format for AI
        const aiFormatted = statsService.formatStatsForAI(player.name, stats, player.sport);
        console.log('\n📝 AI-Formatted:');
        console.log(aiFormatted);
        
      } else {
        console.log('❌ No stats found');
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
    }
  }
  
  // Check cache
  console.log('\n' + '='.repeat(60));
  console.log('📦 Checking player_stats_cache...');
  console.log('='.repeat(60));
  
  const { data: cachedStats, error } = await supabase
    .from('player_stats_cache')
    .select('espn_id, sport, updated_at')
    .order('updated_at', { ascending: false })
    .limit(10);
  
  if (error) {
    console.error('❌ Error querying cache:', error.message);
  } else {
    console.log(`\n✅ Cache contains ${cachedStats.length} entries`);
    if (cachedStats.length > 0) {
      console.log('\nMost recent cached stats:');
      cachedStats.forEach(stat => {
        console.log(`  - ESPN ID ${stat.espn_id} (${stat.sport}) - ${new Date(stat.updated_at).toLocaleString()}`);
      });
    }
  }
  
  console.log('\n✅ Test completed!');
  console.log('\n🎯 Next Steps:');
  console.log('   1. Run: database/phase2_player_stats.sql in Supabase');
  console.log('   2. Wire stats into suggest-picks.js');
  console.log('   3. Create Edge Function for daily updates');
}

testPlayerStats().catch(console.error);
