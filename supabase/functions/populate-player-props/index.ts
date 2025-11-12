import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PlayerData {
  id: number;
  name: string;
  position: string;
  team: string;
  teamId: number;
  jerseyNumber?: number;
  age?: number;
  height?: string;
  weight?: string;
}

interface PlayerStats {
  playerId: number;
  playerName: string;
  position: string;
  team: string;
  // Passing stats
  passingYards?: number;
  passingTDs?: number;
  passingAttempts?: number;
  passingCompletions?: number;
  interceptions?: number;
  // Rushing stats
  rushingYards?: number;
  rushingTDs?: number;
  rushingAttempts?: number;
  // Receiving stats
  receptions?: number;
  receivingYards?: number;
  receivingTDs?: number;
  targets?: number;
  // Season averages for props
  avgPassingYards?: number;
  avgRushingYards?: number;
  avgReceptions?: number;
  avgReceivingYards?: number;
}

interface APIResponse {
  success: boolean;
  message: string;
  players_created: number;
  stats_updated: number;
  errors: string[];
}

async function fetchNFLPlayers(apiKey: string): Promise<PlayerData[]> {
  const baseUrl = 'https://v1.american-football.api-sports.io';
  const currentSeason = new Date().getFullYear();
  
  // Get all NFL teams first
  const teamsResponse = await fetch(`${baseUrl}/teams?league=1&season=${currentSeason}`, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'v1.american-football.api-sports.io'
    }
  });
  
  if (!teamsResponse.ok) {
    throw new Error(`Failed to fetch teams: ${teamsResponse.status}`);
  }
  
  const teamsData = await teamsResponse.json();
  const allPlayers: PlayerData[] = [];
  
  // Fetch players for each team (focus on key skill positions for props)
  const keyPositions = ['QB', 'RB', 'WR', 'TE', 'K']; // Positions relevant for player props
  
  for (const team of teamsData.response || []) {
    try {
      console.log(`Fetching players for ${team.name}...`);
      
      const playersResponse = await fetch(`${baseUrl}/players?team=${team.id}&season=${currentSeason}`, {
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'v1.american-football.api-sports.io'
        }
      });
      
      if (playersResponse.ok) {
        const playersData = await playersResponse.json();
        
        for (const player of playersData.response || []) {
          // Only include players in key positions for prop betting
          if (keyPositions.includes(player.position)) {
            allPlayers.push({
              id: player.id,
              name: player.name,
              position: player.position,
              team: team.name,
              teamId: team.id,
              jerseyNumber: player.number,
              age: player.age,
              height: player.height,
              weight: player.weight
            });
          }
        }
      }
      
      // Rate limiting - wait between team requests
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.warn(`Failed to fetch players for ${team.name}:`, error);
    }
  }
  
  console.log(`✅ Fetched ${allPlayers.length} NFL players from ${teamsData.response?.length || 0} teams`);
  return allPlayers;
}

async function fetchPlayerStats(apiKey: string, players: PlayerData[]): Promise<PlayerStats[]> {
  const baseUrl = 'https://v1.american-football.api-sports.io';
  const currentSeason = new Date().getFullYear();
  const playerStats: PlayerStats[] = [];
  
  // Process players in smaller batches to avoid rate limits
  const batchSize = 10;
  for (let i = 0; i < players.length; i += batchSize) {
    const batch = players.slice(i, i + batchSize);
    
    for (const player of batch) {
      try {
        const statsResponse = await fetch(`${baseUrl}/players/statistics?id=${player.id}&season=${currentSeason}`, {
          headers: {
            'X-RapidAPI-Key': apiKey,
            'X-RapidAPI-Host': 'v1.american-football.api-sports.io'
          }
        });
        
        if (statsResponse.ok) {
          const statsData = await statsResponse.json();
          
          if (statsData.response && statsData.response.length > 0) {
            const stats = statsData.response[0];
            
            // Calculate season averages from game-by-game data
            const gamesPlayed = stats.games?.played || 1;
            
            playerStats.push({
              playerId: player.id,
              playerName: player.name,
              position: player.position,
              team: player.team,
              // Raw totals
              passingYards: stats.passing?.yards || 0,
              passingTDs: stats.passing?.touchdowns || 0,
              passingAttempts: stats.passing?.attempts || 0,
              passingCompletions: stats.passing?.completions || 0,
              interceptions: stats.passing?.interceptions || 0,
              rushingYards: stats.rushing?.yards || 0,
              rushingTDs: stats.rushing?.touchdowns || 0,
              rushingAttempts: stats.rushing?.attempts || 0,
              receptions: stats.receiving?.receptions || 0,
              receivingYards: stats.receiving?.yards || 0,
              receivingTDs: stats.receiving?.touchdowns || 0,
              targets: stats.receiving?.targets || 0,
              // Per-game averages for prop betting
              avgPassingYards: (stats.passing?.yards || 0) / gamesPlayed,
              avgRushingYards: (stats.rushing?.yards || 0) / gamesPlayed,
              avgReceptions: (stats.receiving?.receptions || 0) / gamesPlayed,
              avgReceivingYards: (stats.receiving?.yards || 0) / gamesPlayed,
            });
          }
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));
        
      } catch (error) {
        console.warn(`Failed to fetch stats for ${player.name}:`, error);
      }
    }
    
    console.log(`Processed stats for batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(players.length / batchSize)}`);
  }
  
  console.log(`✅ Fetched stats for ${playerStats.length} players`);
  return playerStats;
}

async function populatePlayerProps(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("APISPORTS_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ 
        error: "APISPORTS_API_KEY not configured" 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ 
        error: "Supabase config missing" 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("🚀 Starting NFL player props population...");
    const startTime = Date.now();

    // First, check what prop markets are being cached in odds
    const { data: propMarkets } = await supabase
      .from('odds_cache')
      .select('market_type, COUNT(*)')
      .like('market_type', 'player_%')
      .group('market_type');
    
    console.log(`Found ${propMarkets?.length || 0} prop market types in odds cache:`, 
               propMarkets?.map(m => m.market_type));

    // Fetch player data from API
    const players = await fetchNFLPlayers(apiKey);
    
    if (players.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        message: "No players retrieved from API",
        players_created: 0,
        stats_updated: 0,
        errors: ["API returned no player data"]
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Clear old NFL players
    const { error: deletePlayersError } = await supabase
      .from('players')
      .delete()
      .eq('sport', 'nfl');

    if (deletePlayersError) {
      console.error('Error clearing old players:', deletePlayersError);
    } else {
      console.log('✅ Cleared old NFL players');
    }

    // Insert players into database
    const playerEntries = players.map(player => ({
      name: player.name,
      sport: 'nfl',
      position: player.position,
      team_id: null, // Will need to map to your teams table
      provider_ids: {
        api_sports_id: player.id,
        team_id: player.teamId
      },
      metadata: {
        team_name: player.team,
        jersey_number: player.jerseyNumber,
        age: player.age,
        height: player.height,
        weight: player.weight,
        last_updated: new Date().toISOString()
      },
      created_at: new Date().toISOString()
    }));

    const { data: insertedPlayers, error: insertPlayersError } = await supabase
      .from('players')
      .insert(playerEntries)
      .select();

    if (insertPlayersError) {
      throw new Error(`Failed to insert players: ${insertPlayersError.message}`);
    }

    console.log(`✅ Inserted ${insertedPlayers?.length || 0} players`);

    // Fetch and insert player stats
    const playerStats = await fetchPlayerStats(apiKey, players);
    
    if (playerStats.length > 0) {
      // Clear old stats
      const { error: deleteStatsError } = await supabase
        .from('player_season_stats')
        .delete()
        .eq('season', new Date().getFullYear());

      // Insert new stats
      const statsEntries = playerStats.map(stats => ({
        player_id: insertedPlayers?.find(p => 
          p.provider_ids?.api_sports_id === stats.playerId
        )?.id,
        season: new Date().getFullYear(),
        sport: 'nfl',
        stats_json: {
          passing: {
            yards: stats.passingYards,
            touchdowns: stats.passingTDs,
            attempts: stats.passingAttempts,
            completions: stats.passingCompletions,
            interceptions: stats.interceptions,
            avg_per_game: stats.avgPassingYards
          },
          rushing: {
            yards: stats.rushingYards,
            touchdowns: stats.rushingTDs,
            attempts: stats.rushingAttempts,
            avg_per_game: stats.avgRushingYards
          },
          receiving: {
            receptions: stats.receptions,
            yards: stats.receivingYards,
            touchdowns: stats.receivingTDs,
            targets: stats.targets,
            avg_receptions_per_game: stats.avgReceptions,
            avg_yards_per_game: stats.avgReceivingYards
          }
        },
        updated_at: new Date().toISOString()
      })).filter(entry => entry.player_id); // Only include where we found matching player

      const { error: insertStatsError } = await supabase
        .from('player_season_stats')
        .insert(statsEntries);

      if (insertStatsError) {
        console.error('Error inserting player stats:', insertStatsError);
      } else {
        console.log(`✅ Inserted stats for ${statsEntries.length} players`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Successfully populated ${players.length} NFL players and ${playerStats.length} stat records in ${duration}ms`);

    const response: APIResponse = {
      success: true,
      message: `Successfully populated ${players.length} NFL players with ${playerStats.length} stat records`,
      players_created: players.length,
      stats_updated: playerStats.length,
      errors: []
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('Error in populate-player-props:', error);
    
    const response: APIResponse = {
      success: false,
      message: `Failed to populate player props: ${error.message}`,
      players_created: 0,
      stats_updated: 0,
      errors: [error.message]
    };

    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

Deno.serve(populatePlayerProps);