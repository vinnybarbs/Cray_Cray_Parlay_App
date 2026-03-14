const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

class NCAABDataSync {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.espnBase = 'http://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';
  }

  async fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN API ${res.status}: ${url}`);
    return res.json();
  }

  async syncGames() {
    console.log('\n🏀 Syncing NCAAB games and team data...');
    
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    let totalGames = 0;
    let teamsSynced = 0;
    
    for (const date of [yesterday, today]) {
      const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
      console.log(`\n📅 Fetching ${date.toDateString()}...`);
      
      try {
        const data = await this.fetchJSON(`${this.espnBase}/scoreboard?dates=${dateStr}&limit=100`);
        
        if (!data.events || data.events.length === 0) {
          console.log('  No games found');
          continue;
        }
        
        console.log(`  Found ${data.events.length} games`);
        
        for (const event of data.events) {
          const comp = event.competitions?.[0];
          if (!comp) continue;
          
          const home = comp.competitors?.find(c => c.homeAway === 'home');
          const away = comp.competitors?.find(c => c.homeAway === 'away');
          if (!home || !away) continue;
          
          const eventDate = new Date(event.date);
          const dateOnly = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;
          
          // Determine season
          const yr = eventDate.getFullYear();
          const mo = eventDate.getMonth() + 1;
          const season = mo >= 9 ? `${yr}-${yr + 1}` : `${yr - 1}-${yr}`;
          
          // Sync teams
          for (const competitor of [home, away]) {
            const teamName = competitor.team.displayName;
            
            // Check if team exists
            const { data: existing } = await this.supabase
              .from('teams')
              .select('id')
              .eq('name', teamName)
              .eq('sport', 'NCAAB')
              .maybeSingle();
            
            if (!existing) {
              // Create team
              const { error: createError } = await this.supabase
                .from('teams')
                .insert({
                  id: this.generateUUID(),
                  name: teamName,
                  sport: 'NCAAB',
                  api_id: competitor.team.id?.toString() || null,
                  logo_url: competitor.team.logo || null,
                  created_at: new Date().toISOString()
                });
              
              if (!createError) {
                teamsSynced++;
                console.log(`    ✓ Created team: ${teamName}`);
              }
            }
          }
          
          // Store game
          const { error: gameError } = await this.supabase
            .from('game_results')
            .upsert({
              espn_event_id: event.id,
              sport: 'NCAAB',
              season,
              date: dateOnly,
              home_team_name: home.team.displayName,
              away_team_name: away.team.displayName,
              home_score: home.score ? parseInt(home.score, 10) : null,
              away_score: away.score ? parseInt(away.score, 10) : null,
              status: event.status?.type?.name === 'STATUS_FINAL' ? 'final'
                : event.status?.type?.name === 'STATUS_SCHEDULED' ? 'scheduled'
                : event.status?.type?.name || 'unknown',
              metadata: {
                event_name: event.name,
                venue: comp.venue?.fullName,
                home_record: home.records?.[0]?.summary,
                away_record: away.records?.[0]?.summary,
                home_seed: home.curatedRank?.current,
                away_seed: away.curatedRank?.current
              }
            }, {
              onConflict: 'espn_event_id'
            });
          
          if (!gameError) {
            totalGames++;
          }
        }
        
      } catch (error) {
        console.error(`  ❌ Error: ${error.message}`);
      }
    }
    
    console.log(`\n✅ Sync complete: ${teamsSynced} new teams, ${totalGames} games`);
    return { teamsSynced, totalGames };
  }

  async syncTeamStandings() {
    console.log('\n📊 Syncing NCAAB team standings...');
    
    try {
      // Get current date and determine appropriate season
      const now = new Date();
      const yr = now.getFullYear();
      const mo = now.getMonth() + 1;
      const season = mo >= 9 ? `${yr}-${yr + 1}` : `${yr - 1}-${yr}`;
      
      // Try to get rankings/standings
      const data = await this.fetchJSON(`${this.espnBase}/scoreboard`);
      
      if (!data.leagues || data.leagues.length === 0) {
        console.log('  No league data found');
        return 0;
      }
      
      let standingsSynced = 0;
      
      // Process teams from recent games to extract records
      const recentGames = data.events || [];
      const teamRecords = new Map();
      
      for (const event of recentGames) {
        const comp = event.competitions?.[0];
        if (!comp) continue;
        
        for (const competitor of comp.competitors || []) {
          const teamName = competitor.team.displayName;
          const record = competitor.records?.[0];
          
          if (record && record.summary) {
            // Parse record like "20-10" or "20-10-5"
            const parts = record.summary.split('-');
            const wins = parseInt(parts[0]) || 0;
            const losses = parseInt(parts[1]) || 0;
            const ties = parseInt(parts[2]) || 0;
            
            teamRecords.set(teamName, { wins, losses, ties });
          }
        }
      }
      
      // Update standings for teams with records
      for (const [teamName, record] of teamRecords) {
        // Find team in database
        const { data: team } = await this.supabase
          .from('teams')
          .select('id')
          .eq('name', teamName)
          .eq('sport', 'NCAAB')
          .maybeSingle();
        
        if (team) {
          const { error } = await this.supabase
            .from('standings')
            .upsert({
              team_id: team.id,
              season: parseInt(yr),
              wins: record.wins,
              losses: record.losses,
              ties: record.ties,
              points_for: null,
              points_against: null,
              point_differential: null,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'team_id,season'
            });
          
          if (!error) {
            standingsSynced++;
            console.log(`  ✓ ${teamName}: ${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ''}`);
          }
        }
      }
      
      console.log(`✅ Standings synced for ${standingsSynced} teams`);
      return standingsSynced;
      
    } catch (error) {
      console.error('❌ Error syncing standings:', error.message);
      return 0;
    }
  }

  async syncTeamStats() {
    console.log('\n📈 Syncing NCAAB team stats...');
    
    // Get all NCAAB teams with recent game data
    const { data: teams, error } = await this.supabase
      .from('teams')
      .select('id, name')
      .eq('sport', 'NCAAB');
    
    if (error || !teams) {
      console.error('❌ Error fetching teams:', error?.message);
      return 0;
    }
    
    let statsSynced = 0;
    const currentYear = new Date().getFullYear();
    
    for (const team of teams) {
      try {
        // Get recent games for this team to calculate stats
        const { data: games } = await this.supabase
          .from('game_results')
          .select('*')
          .or(`home_team_name.eq.${team.name},away_team_name.eq.${team.name}`)
          .eq('sport', 'NCAAB')
          .eq('status', 'final')
          .order('date', { ascending: false })
          .limit(10);
        
        if (!games || games.length === 0) {
          continue;
        }
        
        // Calculate stats from games
        let wins = 0;
        let losses = 0;
        let pointsFor = 0;
        let pointsAgainst = 0;
        let gamesPlayed = 0;
        
        for (const game of games) {
          const isHome = game.home_team_name === team.name;
          const teamScore = isHome ? game.home_score : game.away_score;
          const oppScore = isHome ? game.away_score : game.home_score;
          
          if (teamScore !== null && oppScore !== null) {
            gamesPlayed++;
            pointsFor += teamScore;
            pointsAgainst += oppScore;
            
            if (teamScore > oppScore) {
              wins++;
            } else {
              losses++;
            }
          }
        }
        
        if (gamesPlayed > 0) {
          const avgPointsFor = (pointsFor / gamesPlayed).toFixed(1);
          const avgPointsAgainst = (pointsAgainst / gamesPlayed).toFixed(1);
          const pointDifferential = pointsFor - pointsAgainst;
          
          // Update team_stats_season
          const { error: upsertError } = await this.supabase
            .from('team_stats_season')
            .upsert({
              team_id: team.id,
              season: currentYear,
              sport: 'NCAAB',
              team_name: team.name,
              metrics: {
                wins,
                losses,
                ties: 0,
                win_pct: gamesPlayed > 0 ? (wins / gamesPlayed) : 0,
                points_for: pointsFor,
                points_against: pointsAgainst,
                point_differential: pointDifferential,
                avgPointsFor: parseFloat(avgPointsFor),
                avgPointsAgainst: parseFloat(avgPointsAgainst),
                gamesPlayed,
                raw_stats: [
                  { name: 'Points Per Game', type: 'avgPointsFor', value: parseFloat(avgPointsFor) },
                  { name: 'Points Allowed Per Game', type: 'avgPointsAgainst', value: parseFloat(avgPointsAgainst) },
                  { name: 'Point Differential', type: 'pointDifferential', value: pointDifferential },
                  { name: 'Games Played', type: 'gamesPlayed', value: gamesPlayed },
                  { name: 'Wins', type: 'wins', value: wins },
                  { name: 'Losses', type: 'losses', value: losses },
                  { name: 'Win Percentage', type: 'winPct', value: gamesPlayed > 0 ? (wins / gamesPlayed) : 0 }
                ]
              },
              data_quality: 'good',
              last_updated: new Date().toISOString()
            }, {
              onConflict: 'team_id,season'
            });
          
          if (!upsertError) {
            statsSynced++;
            console.log(`  ✓ ${team.name}: ${wins}-${losses}, ${avgPointsFor} PPG`);
          }
        }
      } catch (err) {
        console.error(`  ❌ Error syncing ${team.name}:`, err.message);
      }
    }
    
    console.log(`✅ Stats synced for ${statsSynced} teams`);
    return statsSynced;
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async runFullSync() {
    console.log('🚀 Starting NCAAB Full Data Sync...\n');
    
    const gameResults = await this.syncGames();
    const standingsResults = await this.syncTeamStandings();
    const statsResults = await this.syncTeamStats();
    
    console.log('\n🎉 NCAAB Sync Complete!');
    console.log(`Teams: ${gameResults.teamsSynced}`);
    console.log(`Games: ${gameResults.totalGames}`);
    console.log(`Standings: ${standingsResults}`);
    console.log(`Stats: ${statsResults}`);
  }
}

// Run the sync
const sync = new NCAABDataSync();
sync.runFullSync();
