const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkPlayerPropsInOddsCache() {
  console.log('🔍 Checking if player props are in odds cache...\n');

  // Check all market types
  const { data: marketTypes, error: marketError } = await supabase
    .from('odds_cache')
    .select('market_type')
    .then(response => {
      if (response.error) return response;
      
      const counts = {};
      response.data.forEach(row => {
        counts[row.market_type] = (counts[row.market_type] || 0) + 1;
      });
      
      return { data: Object.entries(counts).map(([market_type, count]) => ({ market_type, count })) };
    });

  if (marketError) {
    console.error('❌ Error fetching market types:', marketError);
    return;
  }

  console.log('📊 All market types in odds cache:');
  const sortedMarkets = marketTypes.sort((a, b) => b.count - a.count);
  sortedMarkets.forEach(market => {
    const isPlayerProp = market.market_type.startsWith('player_');
    const icon = isPlayerProp ? '🏈' : '📈';
    console.log(`${icon} ${market.market_type}: ${market.count} entries`);
  });

  // Check specifically for player props
  const playerProps = marketTypes.filter(m => m.market_type.startsWith('player_'));

  console.log('\n🎯 Player prop markets:');
  if (playerProps.length === 0) {
    console.log('❌ NO player props found in odds cache');
    console.log('   This means the enhanced odds refresh is not fetching prop markets yet');
  } else {
    console.log(`✅ Found ${playerProps.length} player prop market types:`);
    playerProps.forEach(prop => {
      console.log(`   🏈 ${prop.market_type}: ${prop.count || 0} entries`);
    });
  }

  // Check total odds cache entries
  const { count: totalEntries } = await supabase
    .from('odds_cache')
    .select('*', { count: 'exact', head: true });

  console.log(`\n📊 Total odds cache entries: ${totalEntries}`);

  // Check recent updates
  const { data: recentOdds } = await supabase
    .from('odds_cache')
    .select('market_type, last_updated')
    .order('last_updated', { ascending: false })
    .limit(5);

  console.log('\n🕐 Most recent odds updates:');
  recentOdds.forEach(odds => {
    console.log(`   ${odds.market_type} - ${new Date(odds.last_updated).toLocaleString()}`);
  });
}

checkPlayerPropsInOddsCache().catch(console.error);