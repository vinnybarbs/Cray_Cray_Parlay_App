const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

class OddsDrivenStatsSync {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    this.oddsApiKey = process.env.ODDS_API_KEY;
    this.baseOddsUrl = 'https://api.the-odds-api.com/v4';
    
    // Sports with player props (current focus: NFL & NBA, 2025 season)
    this.sportsMap = {
      'americanfootball_nfl': { name: 'NFL', espnPath: 'football/nfl', season: 2025 },
      'basketball_nba': { name: 'NBA', espnPath: 'basketball/nba', season: 2025 }
    };
  }

  /**
   * Main function: Get player props from odds, then update only those players' stats
   */
  async syncStatsForActiveProps() {
    console.log('🎯 Smart Stats Sync: Only Players with Active Props\n');
    
    const results = {
      total_active_players: 0,
      players_updated: 0,
      sports_processed: 0,
      errors: []
    };

    for (const [oddsApiSport, config] of Object.entries(this.sportsMap)) {
      try {
        console.log(`📊 Processing ${config.name} player props...`);
        
        // Step 1: Get player props from Odds API
        const activeProps = await this.getPlayerPropsFromOdds(oddsApiSport);
        console.log(`  📋 Found ${activeProps.length} active player props`);
        
        if (activeProps.length === 0) {
          console.log(`  ⚠️ No active props for ${config.name}, skipping stats sync\n`);
          continue;
        }
        
        // Step 2: Match props to our cached players
        const matchedPlayers = await this.matchPropsToPlayers(activeProps, config.name);
        console.log(`  🔗 Matched ${matchedPlayers.length} players in our database`);
        
        // Step 3: Update stats only for matched players
        const updated = await this.updateStatsForPlayers(matchedPlayers, config);
        
        results.total_active_players += matchedPlayers.length;
        results.players_updated += updated;
        results.sports_processed += 1;
        
        console.log(`  ✅ ${config.name}: Updated ${updated}/${matchedPlayers.length} players\n`);
        
        // Rate limiting between sports
        await this.sleep(2000);
        
      } catch (error) {
        console.error(`❌ Error processing ${config.name}:`, error.message);
        results.errors.push(`${config.name}: ${error.message}`);
      }
    }

    console.log('🎯 Odds-driven stats sync completed:', results);
    return results;
  }

  /**
   * Get player props from Odds API
   */
  async getPlayerPropsFromOdds(sport) {
    try {
      // Get player props markets for this sport
      const url = `${this.baseOddsUrl}/sports/${sport}/odds?apiKey=${this.oddsApiKey}&regions=us&markets=player_pass_tds,player_pass_yds,player_rush_yds,player_receptions,player_reception_yds,player_points,player_rebounds,player_assists&oddsFormat=american`;
      
      console.log(`  📡 Fetching odds from: ${url.split('?')[0]}`);

      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Odds API request failed: ${response.status} ${response.statusText}`);
      }

      const games = await response.json();
      
      // Extract unique players from all bookmaker odds
      const activePlayers = new Set();
      
      games.forEach(game => {
        if (game.bookmakers) {
          game.bookmakers.forEach(bookmaker => {
            if (bookmaker.markets) {
              bookmaker.markets.forEach(market => {
                if (market.outcomes) {
                  market.outcomes.forEach(outcome => {
                    if (outcome.description) {
                      // Extract player name from outcome description
                      // Format: "Player Name Over/Under X.5"
                      const playerName = this.extractPlayerName(outcome.description);
                      if (playerName) {
                        activePlayers.add(playerName);
                      }
                    }
                  });
                }
              });
            }
          });
        }
      });

      return Array.from(activePlayers).map(name => ({ name, sport }));

    } catch (error) {
      console.error(`Error fetching player props for ${sport}:`, error);
      return [];
    }
  }

  /**
   * Extract player name from odds API outcome description
   */
  extractPlayerName(description) {
    try {
      // Common formats:
      // "Josh Allen Over 1.5 Passing Touchdowns"
      // "LeBron James Under 25.5 Points"
      // "Ronald Acuna Jr Over 1.5 Hits"
      
      // Remove common suffixes and prefixes
      let playerName = description
        .replace(/\s+(Over|Under)\s+[\d.]+.*$/i, '') // Remove "Over/Under X.5 ..."
        .replace(/^\s+|\s+$/g, '') // Trim whitespace
        .replace(/\s+/g, ' '); // Normalize spaces

      // Basic validation - should have at least first and last name
      if (playerName.split(' ').length >= 2 && playerName.length > 3) {
        return playerName;
      }
      
      return null;
      
    } catch (error) {
      console.error('Error extracting player name:', error);
      return null;
    }
  }

  /**
   * Match prop players to our cached players database
   */
  async matchPropsToPlayers(activeProps, sport) {
    try {
      if (activeProps.length === 0) return [];
      
      const playerNames = activeProps.map(prop => prop.name);
      
      // Query our players database with fuzzy matching
      const { data: cachedPlayers, error } = await this.supabase
        .from('players')
        .select('id, name, provider_ids')
        .eq('sport', sport.toLowerCase())
        .in('name', playerNames); // Start with exact matches

      if (error) throw error;

      // For unmatched players, try fuzzy matching
      const matchedNames = new Set(cachedPlayers.map(p => p.name));
      const unmatchedProps = activeProps.filter(prop => !matchedNames.has(prop.name));

      if (unmatchedProps.length > 0) {
        console.log(`    🔍 Trying fuzzy matching for ${unmatchedProps.length} unmatched players...`);
        
        // Get all players for this sport for fuzzy matching
        const { data: allPlayers, error: allError } = await this.supabase
          .from('players')
          .select('id, name, provider_ids')
          .eq('sport', sport.toLowerCase());

        if (!allError && allPlayers) {
          unmatchedProps.forEach(prop => {
            const fuzzyMatch = this.findBestPlayerMatch(prop.name, allPlayers);
            if (fuzzyMatch) {
              cachedPlayers.push(fuzzyMatch);
              console.log(`      🎯 Fuzzy matched "${prop.name}" → "${fuzzyMatch.name}"`);
            }
          });
        }
      }

      return cachedPlayers;

    } catch (error) {
      console.error('Error matching props to players:', error);
      return [];
    }
  }

  /**
   * Find best player match using simple string similarity
   */
  findBestPlayerMatch(propPlayerName, cachedPlayers) {
    let bestMatch = null;
    let bestScore = 0;

    const propWords = propPlayerName.toLowerCase().split(' ');

    cachedPlayers.forEach(player => {
      const playerWords = player.name.toLowerCase().split(' ');
      
      // Count matching words
      let matchingWords = 0;
      propWords.forEach(propWord => {
        if (playerWords.some(playerWord => 
          playerWord.includes(propWord) || propWord.includes(playerWord)
        )) {
          matchingWords++;
        }
      });

      const score = matchingWords / Math.max(propWords.length, playerWords.length);
      
      // Require at least 60% word match
      if (score > 0.6 && score > bestScore) {
        bestScore = score;
        bestMatch = player;
      }
    });

    return bestMatch;
  }

  /**
   * Update ESPN stats for specific players
   */
  async updateStatsForPlayers(players, sportConfig) {
    let updated = 0;

    for (const player of players) {
      try {
        const espnData = JSON.parse(player.provider_ids || '{}');
        const espnPlayerId = espnData.espn_id;
        
        if (!espnPlayerId) {
          console.log(`    ⚠️ No ESPN ID for ${player.name}`);
          continue;
        }

        console.log(`    📊 Updating stats for ${player.name}...`);
        
        const stats = await this.fetchESPNPlayerStats(espnPlayerId, sportConfig);
        
        if (stats && Object.keys(stats).length > 2) { // More than just metadata
          await this.updatePlayerInDatabase(player.id, stats);
          updated++;
          console.log(`      ✅ Updated ${player.name}`);
        } else {
          console.log(`      ⚠️ No stats available for ${player.name}`);
        }
        
        // Rate limiting per player
        await this.sleep(600);
        
      } catch (error) {
        console.error(`    ❌ Error updating ${player.name}:`, error.message);
      }
    }

    return updated;
  }

  /**
   * Fetch ESPN player stats (simplified version)
   */
  async fetchESPNPlayerStats(playerId, sportConfig) {
    try {
      const sportKey = sportConfig.espnPath.split('/')[0];
      const leagueKey = sportConfig.espnPath.split('/')[1];
      const season = sportConfig.season;

      // 1) Fetch the season-specific athlete resource to discover the stats URL
      const athleteUrl = `https://sports.core.api.espn.com/v2/sports/${sportKey}/leagues/${leagueKey}/seasons/${season}/athletes/${playerId}`;
      console.log(`      📡 Fetching athlete from ESPN: ${athleteUrl}`);

      const athleteResponse = await fetch(athleteUrl);

      if (!athleteResponse.ok) {
        if (athleteResponse.status === 404) return null;
        throw new Error(`ESPN athlete API failed: ${athleteResponse.status}`);
      }

      const athleteData = await athleteResponse.json();
      const statsRef = athleteData.statistics && athleteData.statistics.$ref;

      if (!statsRef) {
        console.log(`      ℹ️ No stats reference found for player ${playerId}`);
        return null;
      }

      // 2) Follow statistics.$ref to get stats resource
      console.log(`      📡 Fetching stats from ESPN: ${statsRef}`);
      const statsResponse = await fetch(statsRef);

      if (!statsResponse.ok) {
        if (statsResponse.status === 404) return null;
        throw new Error(`ESPN stats API failed: ${statsResponse.status}`);
      }

      let statsData = await statsResponse.json();

      // 3) Some stats resources expose splits via a nested $ref; follow it if present
      if (statsData && statsData.splits && statsData.splits.$ref) {
        const splitsUrl = statsData.splits.$ref;
        console.log(`      📡 Fetching stats splits from ESPN: ${splitsUrl}`);
        const splitsResponse = await fetch(splitsUrl);
        if (splitsResponse.ok) {
          const splitsData = await splitsResponse.json();
          if (Array.isArray(splitsData.splits)) {
            statsData = splitsData;
          } else if (Array.isArray(splitsData.items)) {
            statsData = { splits: splitsData.items };
          }
        }
      }

      return {
        last_updated: new Date().toISOString(),
        api_source: 'espn',
        raw_stats: statsData,
        prop_relevant_stats: this.extractPropRelevantStats(statsData, sportConfig.name)
      };

    } catch (error) {
      console.error('ESPN stats fetch error:', error);
      return null;
    }
  }

  /**
   * Extract the most important stats for prop betting
   */
  extractPropRelevantStats(apiData, sport) {
    const stats = {};
    
    try {
      if (!apiData?.splits) return stats;

      const seasonStats = apiData.splits.find(split => 
        split.name === 'Total' || split.name === 'Regular Season'
      );

      if (!seasonStats?.stats) return stats;

      const raw = seasonStats.stats;

      switch (sport) {
        case 'NFL':
          return {
            passing_yards: raw.passingYards || 0,
            passing_tds: raw.passingTouchdowns || 0,
            rushing_yards: raw.rushingYards || 0,
            rushing_tds: raw.rushingTouchdowns || 0,
            receptions: raw.receptions || 0,
            receiving_yards: raw.receivingYards || 0,
            receiving_tds: raw.receivingTouchdowns || 0,
            games: raw.gamesPlayed || 0
          };

        case 'NBA':
          return {
            points: raw.points || 0,
            rebounds: raw.totalRebounds || 0,
            assists: raw.assists || 0,
            threes_made: raw.threePointFieldGoalsMade || 0,
            games: raw.gamesPlayed || 0,
            ppg: raw.avgPoints || 0,
            rpg: raw.avgRebounds || 0,
            apg: raw.avgAssists || 0
          };

        case 'MLB':
          return {
            hits: raw.hits || 0,
            home_runs: raw.homeRuns || 0,
            rbis: raw.RBIs || 0,
            runs: raw.runs || 0,
            stolen_bases: raw.stolenBases || 0,
            avg: raw.battingAverage || 0,
            games: raw.gamesPlayed || 0
          };
      }

    } catch (error) {
      console.error('Error extracting prop stats:', error);
    }

    return stats;
  }

  /**
   * Update player in database with new stats
   */
  async updatePlayerInDatabase(playerId, stats) {
    try {
      // Get existing provider_ids
      const { data: existing, error: fetchError } = await this.supabase
        .from('players')
        .select('provider_ids')
        .eq('id', playerId)
        .single();

      if (fetchError) throw fetchError;

      // Merge new stats with existing data
      const existingData = JSON.parse(existing.provider_ids || '{}');
      existingData.current_season_stats = stats;

      // Update the record
      const { error: updateError } = await this.supabase
        .from('players')
        .update({
          provider_ids: JSON.stringify(existingData)
        })
        .eq('id', playerId);

      if (updateError) throw updateError;

      return true;

    } catch (error) {
      console.error('Database update error:', error);
      return false;
    }
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Main execution
async function main() {
  const sync = new OddsDrivenStatsSync();
  
  console.log('🚀 Starting Odds-Driven Player Stats Sync\n');
  
  try {
    const results = await sync.syncStatsForActiveProps();
    
    console.log('\n🎯 Final Results:');
    console.log(`📊 Active Players Found: ${results.total_active_players}`);
    console.log(`✅ Players Updated: ${results.players_updated}`);
    console.log(`🏆 Sports Processed: ${results.sports_processed}`);
    
    if (results.errors.length > 0) {
      console.log('❌ Errors:', results.errors);
    }
    
    console.log('\n💡 This approach is much more efficient!');
    console.log('🎯 Only updating stats for players with active prop markets');
    
  } catch (error) {
    console.error('❌ Sync failed:', error);
  }
}

if (require.main === module) {
  main();
}

module.exports = { OddsDrivenStatsSync, main };