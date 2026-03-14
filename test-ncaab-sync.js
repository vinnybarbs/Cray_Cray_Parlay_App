const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ESPN_BASE = 'http://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN API ${res.status}: ${url}`);
  return res.json();
}

async function testNCAABSync() {
  console.log('🏀 Testing NCAAB data sync...');
  
  try {
    // Test scoreboard endpoint
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    console.log(`Fetching scoreboard for ${dateStr}...`);
    
    const data = await fetchJSON(`${ESPN_BASE}/scoreboard?dates=${dateStr}&limit=100`);
    
    console.log('Response keys:', Object.keys(data));
    console.log('Events found:', data.events?.length || 0);
    
    if (data.events && data.events.length > 0) {
      const event = data.events[0];
      console.log('Sample event:');
      console.log('  Name:', event.name);
      console.log('  Date:', event.date);
      console.log('  Competitions:', event.competitions?.length || 0);
      
      if (event.competitions && event.competitions[0]) {
        const comp = event.competitions[0];
        console.log('  Teams in competition:', comp.competitors?.length || 0);
        if (comp.competitors) {
          comp.competitors.forEach(c => {
            console.log(`    ${c.homeAway}: ${c.team.displayName} (Score: ${c.score || 'TBD'})`);
          });
        }
      }
    }
    
    console.log('\n✅ ESPN API test successful');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testNCAABSync();
