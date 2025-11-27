// Quick test with teams that are actually in the DB
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { RSSResearchService } = require('./lib/services/rss-research');

async function quickTest() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const rssService = new RSSResearchService(supabase);
  
  console.log('🧪 Quick test with teams ACTUALLY in the database:\n');
  
  // These teams are in your current articles
  const testCases = [
    { home: 'Detroit Pistons', away: 'Boston Celtics', sport: 'NBA' },
    { home: 'New York Knicks', away: 'Philadelphia 76ers', sport: 'NBA' },
    { home: 'LA Clippers', away: 'Dallas Mavericks', sport: 'NBA' },
  ];
  
  for (const { home, away, sport } of testCases) {
    console.log(`\n🔍 ${away} @ ${home}`);
    const research = await rssService.getMatchupResearch(home, away, sport);
    
    if (research.facts.length > 0) {
      console.log(`   ✅ EXTRACTED ${research.facts.length} FACTS:`);
      research.facts.forEach(fact => console.log(`      - ${fact}`));
    } else {
      console.log(`   ⚠️  No facts extracted`);
    }
  }
  
  // Test specific player from your articles
  console.log('\n🏀 Testing Landry Shamet (from Knicks article):');
  const shametResearch = await rssService.getPlayerResearch('Landry Shamet', 'New York Knicks', 'NBA');
  if (shametResearch.facts.length > 0) {
    console.log(`   ✅ EXTRACTED ${shametResearch.facts.length} FACTS:`);
    shametResearch.facts.forEach(fact => console.log(`      - ${fact}`));
  } else {
    console.log(`   ⚠️  No facts - checking pattern manually...`);
    
    // Manual pattern test
    const testText = "Sources: Knicks' Shamet out at least four weeks";
    console.log(`   Testing pattern on: "${testText}"`);
    const manualFacts = rssService.extractFactBullets(testText, ['Knicks', 'New York Knicks'], ['Landry Shamet', 'Shamet']);
    console.log(`   Pattern result:`, manualFacts);
  }
}

quickTest().catch(console.error);
