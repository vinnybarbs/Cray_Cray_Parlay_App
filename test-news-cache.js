const { createClient } = require('@supabase/supabase-js');

// Load environment from .env.local (which server.js also uses)
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testNewsCache() {
  console.log('🔍 Testing news_cache table access...');
  
  try {
    // First, check if we can read from the table
    const { data: existingData, error: readError } = await supabase
      .from('news_cache')
      .select('*')
      .limit(3);
    
    if (readError) {
      console.error('❌ Error reading news_cache:', readError);
      return;
    }
    
    console.log('✅ Successfully read from news_cache');
    console.log(`📊 Current rows: ${existingData?.length || 0}`);
    
    if (existingData && existingData.length > 0) {
      console.log('📝 Sample data:', JSON.stringify(existingData[0], null, 2));
    }
    
    // Try to insert a test row
    const testData = {
      sport: 'NFL',
      search_type: 'test',
      team_name: 'Test Team',
      search_query: 'test query',
      articles: JSON.stringify([{
        title: 'Test Article',
        link: 'https://example.com',
        snippet: 'Test snippet',
        source: 'Test Source'
      }]),
      summary: 'Test summary for news cache functionality',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
    };
    
    const { data: insertData, error: insertError } = await supabase
      .from('news_cache')
      .insert(testData)
      .select();
    
    if (insertError) {
      console.error('❌ Error inserting test data:', insertError);
      return;
    }
    
    console.log('✅ Successfully inserted test data');
    console.log('📝 Inserted:', JSON.stringify(insertData[0], null, 2));
    
    // Clean up the test data
    const { error: deleteError } = await supabase
      .from('news_cache')
      .delete()
      .eq('search_type', 'test');
    
    if (deleteError) {
      console.warn('⚠️ Warning: Could not clean up test data:', deleteError);
    } else {
      console.log('🧹 Test data cleaned up');
    }
    
  } catch (error) {
    console.error('💥 Unexpected error:', error);
  }
}

async function testSerperAPI() {
  console.log('\n🌐 Testing Serper API access...');
  
  // This would need the actual API key to work
  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) {
    console.log('⚠️ SERPER_API_KEY not set in environment - skipping API test');
    return;
  }
  
  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': serperKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: 'NFL injury report',
        num: 3
      })
    });

    if (!response.ok) {
      console.error('❌ Serper API error:', response.status, response.statusText);
      return;
    }

    const data = await response.json();
    console.log('✅ Serper API working');
    console.log(`📊 Found ${data.organic?.length || 0} results`);
    
  } catch (error) {
    console.error('💥 Serper API error:', error.message);
  }
}

// Run the tests
async function runTests() {
  await testNewsCache();
  await testSerperAPI();
}

runTests().then(() => {
  console.log('\n✨ Tests completed');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Test suite failed:', error);
  process.exit(1);
});