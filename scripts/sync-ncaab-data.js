const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

class NCAABSync {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.apiKey = process.env.APISPORTS_API_KEY;
    this.baseUrl = 'https://v1.basketball.api-sports.io';
    this.leagueId = 116; // NCAA Men's Basketball
    this.season = '2024-2025';
    this.callCount = 0;
  }

  async request(endpoint, params = {}) {
    this.callCount++;
    console.log(`API call ${this.callCount}: ${endpoint}`);
    
    const url = new URL(`${this.baseUrl}/${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    });

    const response = await fetch(url, {
      headers: { 'x-apisports-key': this.apiKey }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error ${response.status}: ${error}`);
    }

    return response.json();
  }

  async syncTeams() {
    console.log(`\n🏀 Syncing NCAAB teams for ${this.season}...`);
    
    const result = await this.request('teams', {
      league: this.leagueId,
      season: this.season
    });

    if (!result.response || result.response.length === 0) {
      console.log('❌ No teams found');
      return;
    }

    console.log(`Found ${result.response.length} teams`);
    
    let synced = 0;
    for (const team of result.response) {
      try {
        // Check if team exists
        const { data: existing } = await this.supabase
          .from('teams')
          .select('id')
          .eq('name', team.name)
          .maybeSingle();

        if (existing) {
          console.log(`✓ ${team.name} already exists`);
          continue;
        }

        // Insert new team
        const { error } = await this.supabase
          .from('teams')
          .insert({
            id: this.generateUUID(),
            name: team.name,
            sport: 'NCAAB',
            api_id: team.id.toString(),
            logo_url: team.logo,
            created_at: new Date().toISOString()
          });

        if (error) {
          console.error(`❌ Error inserting ${team.name}:`, error.message);
        } else {
          console.log(`✓ Inserted ${team.name}`);
          synced++;
        }
      } catch (err) {
        console.error(`❌ Error syncing ${team.name}:`, err.message);
      }

      // Rate limiting
      if (synced % 10 === 0) {
        await this.sleep(1000);
      }
    }

    console.log(`✅ Synced ${synced} new teams`);
    return synced;
  }

  async syncStandings() {
    console.log(`\n📊 Syncing NCAAB standings for ${this.season}...`);
    
    const result = await this.request('standings', {
      league: this.leagueId,
      season: this.season
    });

    if (!result.response || result.response.length === 0) {
      console.log('❌ No standings found');
      return;
    }

    console.log(`Found standings for ${result.response.length} teams`);
    
    let synced = 0;
    for (const standing of result.response) {
      try {
        // Find team in database
        const { data: team } = await this.supabase
          .from('teams')
          .select('id')
          .eq('api_id', standing.team.id.toString())
          .eq('sport', 'NCAAB')
          .maybeSingle();

        if (!team) {
          console.log(`⚠️ Team not found for ${standing.team.name}`);
          continue;
        }

        // Upsert standings
        const { error } = await this.supabase
          .from('standings')
          .upsert({
            team_id: team.id,
            season: 2025,
            conference: standing.conference?.name || null,
            division: standing.division?.name || null,
            wins: standing.games?.wins || 0,
            losses: standing.games?.losses || 0,
            ties: 0,
            points_for: standing.points?.for || 0,
            points_against: standing.points?.against || 0,
            point_differential: (standing.points?.for || 0) - (standing.points?.against || 0),
            streak: standing.form?.slice(-3) || null,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'team_id,season'
          });

        if (error) {
          console.error(`❌ Error inserting standings for ${standing.team.name}:`, error.message);
        } else {
          console.log(`✓ Standings: ${standing.team.name} ${standing.games?.wins}-${standing.games?.losses}`);
          synced++;
        }
      } catch (err) {
        console.error(`❌ Error syncing standings for ${standing.team.name}:`, err.message);
      }
    }

    console.log(`✅ Synced standings for ${synced} teams`);
    return synced;
  }

  async syncTeamStats() {
    console.log(`\n📈 Syncing NCAAB team statistics for ${this.season}...`);
    
    // Get all NCAAB teams from database
    const { data: teams, error } = await this.supabase
      .from('teams')
      .select('id, name, api_id')
      .eq('sport', 'NCAAB')
      .not('api_id', 'is', null);

    if (error || !teams) {
      console.error('❌ Error fetching teams:', error?.message);
      return;
    }

    console.log(`Found ${teams.length} NCAAB teams in database`);
    
    let synced = 0;
    for (const team of teams) {
      try {
        // Get team statistics from API
        const result = await this.request('statistics', {
          league: this.leagueId,
          season: this.season,
          team: team.api_id
        });

        if (!result.response || result.response.length === 0) {
          console.log(`⚠️ No stats found for ${team.name}`);
          continue;
        }

        const stats = result.response[0];
        
        // Upsert to team_stats_season
        const { error: upsertError } = await this.supabase
          .from('team_stats_season')
          .upsert({
            team_id: team.id,
            season: 2025,
            sport: 'NCAAB',
            team_name: team.name,
            metrics: {
              wins: stats.games?.wins || 0,
              losses: stats.games?.losses || 0,
              ties: 0,
              win_pct: stats.games?.win?.percentage || 0,
              points_for: stats.points?.for || 0,
              points_against: stats.points?.against || 0,
              point_differential: (stats.points?.for || 0) - (stats.points?.against || 0),
              avgPointsFor: stats.points?.for && stats.games?.played ? 
                (stats.points.for / stats.games.played).toFixed(2) : 0,
              avgPointsAgainst: stats.points?.against && stats.games?.played ? 
                (stats.points.against / stats.games.played).toFixed(2) : 0,
              gamesPlayed: stats.games?.played || 0,
              homeRecord: stats.games?.home?.win || 0,
              awayRecord: stats.games?.away?.win || 0,
              raw_stats: [
                { name: 'Points Per Game', type: 'avgPointsFor', value: stats.points?.for && stats.games?.played ? (stats.points.for / stats.games.played).toFixed(2) : 0 },
                { name: 'Points Allowed Per Game', type: 'avgPointsAgainst', value: stats.points?.against && stats.games?.played ? (stats.points.against / stats.games.played).toFixed(2) : 0 },
                { name: 'Point Differential', type: 'pointDifferential', value: (stats.points?.for || 0) - (stats.points?.against || 0) },
                { name: 'Games Played', type: 'gamesPlayed', value: stats.games?.played || 0 },
                { name: 'Wins', type: 'wins', value: stats.games?.wins || 0 },
                { name: 'Losses', type: 'losses', value: stats.games?.losses || 0 },
                { name: 'Win Percentage', type: 'winPct', value: stats.games?.win?.percentage || 0 }
              ]
            },
            data_quality: 'good',
            last_updated: new Date().toISOString()
          }, {
            onConflict: 'team_id,season'
          });

        if (upsertError) {
          console.error(`❌ Error inserting stats for ${team.name}:`, upsertError.message);
        } else {
          console.log(`✓ Stats: ${team.name} ${stats.games?.wins}-${stats.games?.losses}`);
          synced++;
        }
      } catch (err) {
        console.error(`❌ Error syncing stats for ${team.name}:`, err.message);
      }

      // Rate limiting
      if (synced % 10 === 0) {
        await this.sleep(1000);
      }
    }

    console.log(`✅ Synced stats for ${synced} teams`);
    return synced;
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async runFullSync() {
    console.log('🚀 Starting NCAAB full data sync...\n');
    
    try {
      const teamResults = await this.syncTeams();
      const standingsResults = await this.syncStandings();
      const statsResults = await this.syncTeamStats();
      
      console.log('\n🎉 NCAAB Sync Complete!');
      console.log(`Teams: ${teamResults || 0} new`);
      console.log(`Standings: ${standingsResults || 0} teams`);
      console.log(`Stats: ${statsResults || 0} teams`);
      console.log(`Total API calls: ${this.callCount}`);
      
    } catch (error) {
      console.error('❌ Sync failed:', error.message);
    }
  }
}

// Run the sync
const sync = new NCAABSync();
sync.runFullSync();
