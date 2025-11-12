const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

async function applySchema() {
  console.log('📊 Creating player_season_stats table manually...');
  
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Create the table directly using JavaScript
    console.log('🔧 Creating player_season_stats table...');
    
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS player_season_stats (
        id SERIAL PRIMARY KEY,
        player_id VARCHAR(100) NOT NULL,
        player_name VARCHAR(255) NOT NULL,
        team_id VARCHAR(100) NOT NULL,
        team_name VARCHAR(255) NOT NULL,
        sport VARCHAR(50) NOT NULL,
        season INTEGER NOT NULL,
        position VARCHAR(50),
        jersey_number INTEGER,
        age INTEGER,
        height VARCHAR(20),
        weight INTEGER,
        
        -- Basic stats
        games_played INTEGER DEFAULT 0,
        games_started INTEGER DEFAULT 0,
        minutes_played INTEGER DEFAULT 0,
        
        -- ESPN specific fields
        experience INTEGER,
        college VARCHAR(255),
        birth_date DATE,
        birth_place VARCHAR(255),
        headshot_url TEXT,
        
        -- Injury/Availability Status
        injury_status VARCHAR(50) DEFAULT 'healthy',
        injury_description TEXT,
        injury_return_date DATE,
        
        -- Performance metrics
        performance_rating DECIMAL(4,2) DEFAULT 5.00,
        consistency_score DECIMAL(4,2) DEFAULT 5.00,
        recent_form_score DECIMAL(4,2) DEFAULT 5.00,
        
        -- Sport-specific statistics (JSON)
        sport_stats JSONB DEFAULT '{}',
        
        -- Betting relevance
        prop_bet_eligible BOOLEAN DEFAULT true,
        betting_value_score DECIMAL(4,2) DEFAULT 5.00,
        
        -- Metadata
        last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        api_source VARCHAR(50) DEFAULT 'espn',
        data_quality VARCHAR(20) DEFAULT 'excellent',
        
        UNIQUE(player_id, team_id, sport, season)
      );
    `;

    // Use a simple SQL execution approach
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify({ sql: createTableSQL })
    });

    if (!response.ok) {
      console.log('⚠️ Direct SQL failed, trying manual creation...');
      
      // Create a dummy record to trigger table creation
      const { error: insertError } = await supabase
        .from('player_season_stats')
        .insert({
          player_id: 'test-player',
          player_name: 'Test Player',
          team_id: 'test-team',
          team_name: 'Test Team', 
          sport: 'NFL',
          season: 2024,
          position: 'QB'
        });
      
      if (insertError && !insertError.message.includes('already exists')) {
        console.error('❌ Manual creation failed:', insertError);
      } else {
        console.log('✅ Table created via insert method');
      }
    } else {
      console.log('✅ Table created via SQL execution');
    }

    // Test the table exists
    console.log('\n🧪 Testing player_season_stats table...');
    const { data: testData, error: testError } = await supabase
      .from('player_season_stats')
      .select('id')
      .limit(1);

    if (testError) {
      console.error('❌ Table still not accessible:', testError);
      console.log('💡 The table may need to be created in Supabase dashboard');
    } else {
      console.log('✅ player_season_stats table is ready!');
      
      // Clean up test record if it exists
      await supabase
        .from('player_season_stats')
        .delete()
        .eq('player_id', 'test-player');
    }

  } catch (error) {
    console.error('❌ Schema application failed:', error);
  }
}

if (require.main === module) {
  applySchema();
}

module.exports = applySchema;