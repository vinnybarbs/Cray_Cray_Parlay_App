// Test script for RSS Research Service
// Run this to verify RSS research is working before wiring into research agent

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { RSSResearchService } = require('./lib/services/rss-research');

async function testRSSResearch() {
  console.log('🧪 Testing RSS Research Service\n');
  
  // Initialize Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  const rssService = new RSSResearchService(supabase);
  
  // Test 1: Check if we have articles in the database
  console.log('📊 Test 1: Checking news_articles table...');
  const { data: articles, error: articlesError } = await supabase
    .from('news_articles')
    .select('id, title, published_at, news_sources(name)')
    .order('published_at', { ascending: false })
    .limit(5);
  
  if (articlesError) {
    console.error('❌ Error querying articles:', articlesError);
    process.exit(1);
  }
  
  if (!articles || articles.length === 0) {
    console.log('⚠️  No articles in database yet. Wait for RSS ingestion to run (every 3 hours).');
    console.log('   Or manually trigger: curl -X POST "https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/ingest-news-lite" ...');
    return;
  }
  
  console.log(`✅ Found ${articles.length} recent articles:`);
  articles.forEach((a, idx) => {
    console.log(`   ${idx + 1}. ${a.news_sources?.name}: "${a.title.substring(0, 60)}..."`);
  });
  
  // Test 2: Try matchup research with popular teams
  console.log('\n📊 Test 2: Testing matchup research...');
  
  const testMatchups = [
    { home: 'Los Angeles Lakers', away: 'Boston Celtics', sport: 'NBA' },
    { home: 'Kansas City Chiefs', away: 'Dallas Cowboys', sport: 'NFL' },
    { home: 'Golden State Warriors', away: 'Miami Heat', sport: 'NBA' },
  ];
  
  for (const matchup of testMatchups) {
    console.log(`\n🔍 ${matchup.away} @ ${matchup.home} (${matchup.sport})`);
    
    try {
      const research = await rssService.getMatchupResearch(
        matchup.home,
        matchup.away,
        matchup.sport
      );
      
      if (research.facts.length > 0) {
        console.log(`   ✅ Found ${research.facts.length} facts:`);
        research.facts.forEach((fact, idx) => {
          console.log(`      ${idx + 1}. ${fact}`);
        });
        
        if (research.sources.length > 0) {
          console.log(`   📰 Sources:`);
          research.sources.forEach((source, idx) => {
            console.log(`      ${idx + 1}. ${source.source}: "${source.title}"`);
          });
        }
      } else {
        console.log(`   ⚠️  No facts extracted (no recent articles mentioning these teams)`);
      }
    } catch (error) {
      console.error(`   ❌ Error:`, error.message);
    }
  }
  
  // Test 3: Try player research
  console.log('\n📊 Test 3: Testing player research...');
  
  const testPlayers = [
    { name: 'LeBron James', team: 'Los Angeles Lakers', sport: 'NBA' },
    { name: 'Patrick Mahomes', team: 'Kansas City Chiefs', sport: 'NFL' },
    { name: 'Stephen Curry', team: 'Golden State Warriors', sport: 'NBA' },
  ];
  
  for (const player of testPlayers) {
    console.log(`\n🏀 ${player.name} (${player.team})`);
    
    try {
      const research = await rssService.getPlayerResearch(
        player.name,
        player.team,
        player.sport
      );
      
      if (research.facts.length > 0) {
        console.log(`   ✅ Found ${research.facts.length} facts:`);
        research.facts.forEach((fact, idx) => {
          console.log(`      ${idx + 1}. ${fact}`);
        });
      } else {
        console.log(`   ⚠️  No facts extracted (no recent articles mentioning ${player.name})`);
      }
    } catch (error) {
      console.error(`   ❌ Error:`, error.message);
    }
  }
  
  // Test 4: Format for AI
  console.log('\n📊 Test 4: Testing AI formatting...');
  
  try {
    const sampleResearch = await rssService.getMatchupResearch('Lakers', 'Celtics', 'NBA');
    
    if (sampleResearch.facts.length > 0) {
      const formatted = rssService.formatForAI(sampleResearch);
      console.log('\n✅ AI-formatted research:');
      console.log('---');
      console.log(formatted);
      console.log('---');
    } else {
      console.log('⚠️  No research available to format');
    }
  } catch (error) {
    console.error('❌ Error formatting:', error.message);
  }
  
  console.log('\n✅ RSS Research Service tests complete!');
  console.log('\nNext steps:');
  console.log('1. If articles are sparse, wait for next RSS ingestion (every 3 hours)');
  console.log('2. Wire RSSResearchService into research-agent.js');
  console.log('3. Test with real parlay generation');
}

// Run tests
testRSSResearch().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
