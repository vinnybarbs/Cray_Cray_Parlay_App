const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

class ESPN_NCAAB_Sync {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.baseUrl = 'https://site.web.api.espn.com/apis/basketball/2.0';
    this.season = 2025;
  }

  async request(endpoint, params = {}) {
    const url = new URL(`${this.baseUrl}/${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    });

    console.log(`📡 ESPN API: ${endpoint}`);
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ESPN API error ${response.status}: ${error}`);
    }

    return response.json();
  }

  async syncTeamsAndStandings() {
    console.log(`\n🏀 Syncing NCAAB teams and standings for ${this.season-1}-${this.season} season...`);
    
    try {
      // Get standings data which includes teams
      const data = await this.request('standings', {
        season: this.season,
        division: 1 // Division 1
      });

      if (!data.standings || data.standings.length === 0) {
        console.log('❌ No standings found');
        return 0;
      }

      console.log(`Found ${data.standings.length} teams in standings`);
      
      let synced = 0;
      for (const standing of data.standings) {
        try {
          // Extract team info
          const teamName = standing.name;
          const stats = standing.stats || [];
          
          // Find key stats
          const winsStat = stats.find(s => s.name === 'wins') || {};
          const lossesStat = stats.find(s => s.name === 'losses') || {};
          const ppgStat = stats.find(s => s.name === 'pointsPerGame') || {};
          const papgStat = stats.find(s => s.name === 'pointsAllowedPerGame') || {};
          
          const wins = winsStat.value || 0;
          const losses = lossesStat.value || 0;
          const ppg = ppgStat.value || 0;
          const papg = papgStat.value || 0;

          // Check if team exists
          const { data: existing } = await this.supabase
            .from('teams')
            .select('id')
            .eq('name', teamName)
            .eq('sport', 'NCAAB')
            .maybeSingle();

          let teamId;
          if (existing) {
            teamId = existing.id;
            console.log(`✓ ${teamName} exists`);
          } else {
            // Create new team
            const { data: newTeam, error: createError } = await this.supabase
              .from('teams')
              .insert({
                id: this.generateUUID(),
                name: teamName,
                sport: 'NCAAB',
                created_at: new Date().toISOString()
              })
              .select('id')
              .single();

            if (createError) {
              console.error(`❌ Error creating team ${teamName}:`, createError.message);
              continue;
            }
            teamId = newTeam.id;
            console.log(`✓ Created ${teamName}`);
          }

          // Update standings
          const { error: standingsError } = await this.supabase
            .from('standings')
            .upsert({
              team_id: teamId,
              season: this.season,
              conference: standing.conference || null,
              division: standing.division || null,
              wins: wins,
              losses: losses,
              ties: 0,
              points_for: Math.round(ppg * (wins + losses)),
              points_against: Math.round(papg * (wins + losses)),
              point_differential: Math.round((ppg - papg) * (wins + losses)),
              streak: standing.streak || null,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'team_id,season'
            });

          if (standingsError) {
            console.error(`❌ Error updating standings for ${teamName}:`, standingsError.message);
          } else {
            // Update team_stats_season
            const { error: statsError } = await this.supabase
              .from('team_stats_season')
              .upsert({
                team_id: teamId,
                season: this.season,
                sport: 'NCAAB',
                team_name: teamName,
                metrics: {
                  wins: wins,
                  losses: losses,
                  ties: 0,
                  win_pct: wins + losses > 0 ? (wins / (wins + losses)) : 0,
                  points_for: Math.round(ppg * (wins + losses)),
                  points_against: Math.round(papg * (wins + losses)),
                  point_differential: Math.round((ppg - papg) * (wins + losses)),
                  avgPointsFor: ppg,
                  avgPointsAgainst: papg,
                  gamesPlayed: wins + losses,
                  homeRecord: null, // ESPN doesn't provide this in standings
                  awayRecord: null,
                  raw_stats: [
                    { name: 'Points Per Game', type: 'avgPointsFor', value: ppg },
                    { name: 'Points Allowed Per Game', type: 'avgPointsAgainst', value: papg },
                    { name: 'Point Differential', type: 'pointDifferential', value: Math.round((ppg - papg) * (wins + losses)) },
                    { name: 'Games Played', type: 'gamesPlayed', value: wins + losses },
                    { name: 'Wins', type: 'wins', value: wins },
                    { name: 'Losses', type: 'losses', value: losses },
                    { name: 'Win Percentage', type: 'winPct', value: wins + losses > 0 ? (wins / (wins + losses)) : 0 }
                  ]
                },
                data_quality: 'good',
                last_updated: new Date().toISOString()
              }, {
                onConflict: 'team_id,season'
              });

            if (statsError) {
              console.error(`❌ Error updating stats for ${teamName}:`, statsError.message);
            } else {
              console.log(`✓ ${teamName}: ${wins}-${losses}, ${ppg} PPG`);
              synced++;
            }
          }
        } catch (err) {
          console.error(`❌ Error processing ${standing?.name}:`, err.message);
        }
      }

      console.log(`✅ Synced ${synced} teams`);
      return synced;
      
    } catch (error) {
      console.error('❌ Sync failed:', error.message);
      return 0;
    }
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async runFullSync() {
    console.log('🚀 Starting ESPN NCAAB Data Sync...\n');
    
    const results = await this.syncTeamsAndStandings();
    
    console.log('\n🎉 NCAAB Sync Complete!');
    console.log(`Teams synced: ${results}`);
  }
}

// Run the sync
const sync = new ESPN_NCAAB_Sync();
sync.runFullSync();
