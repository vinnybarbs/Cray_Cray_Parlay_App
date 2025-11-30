require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStats() {
  console.log('\n📊 CHECKING STATS TABLES\n');
  
  const tables = [
    'team_stats_detailed',
    'player_game_stats',
    'team_stats_season',
    'injuries',
    'news_articles'
  ];
  
  for (const table of tables) {
    const { data, error, count } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: false })
      .limit(3);
      
    if (error) {
      console.log(`❌ ${table}: ERROR - ${error.message}`);
    } else {
      console.log(`✅ ${table}: ${count || 0} rows`);
      if (data && data.length > 0) {
        console.log(`   Sample: ${JSON.stringify(data[0]).substring(0, 150)}...`);
      }
    }
    console.log('');
  }
}

checkStats().then(() => {
  console.log('✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
