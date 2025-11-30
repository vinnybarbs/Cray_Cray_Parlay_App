require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function listTables() {
  console.log('\n📊 CHECKING DATABASE TABLES\n');
  
  // Query pg_tables to list all tables
  const { data, error } = await supabase
    .rpc('exec_sql', { 
      query: `
        SELECT schemaname, tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
        ORDER BY tablename;
      `
    });
    
  if (error) {
    console.error('Error (trying alternate method):', error.message);
    
    // Try a different approach - query information_schema
    const tablesToCheck = [
      'parlays',
      'parlay_legs',
      'teams',
      'players',
      'injuries',
      'news_articles',
      'odds_cache',
      'team_stats_detailed',
      'player_game_stats'
    ];
    
    console.log('\n🔍 Checking specific tables:\n');
    
    for (const table of tablesToCheck) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .limit(1);
        
      if (error) {
        console.log(`❌ ${table}: NOT FOUND (${error.code})`);
      } else {
        console.log(`✅ ${table}: EXISTS`);
        if (data && data.length > 0) {
          console.log(`   Sample columns: ${Object.keys(data[0]).slice(0, 10).join(', ')}...`);
        }
      }
    }
  } else {
    console.log('✅ Tables in public schema:\n');
    data.forEach(row => {
      console.log(`   - ${row.tablename}`);
    });
  }
}

listTables().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
