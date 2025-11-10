// @ts-ignore - Deno imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore - Deno imports  
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// Comprehensive sports configuration for all supported sports
const SPORTS_CONFIG = {
  NFL: {
    baseUrl: 'https://v1.american-football.api-sports.io',
    host: 'v1.american-football.api-sports.io',
    season: 2024,
    priority: 1,  // Highest priority
    endpoints: {
      teams: '/teams',
      standings: '/standings', 
      players: '/players/statistics'
    }
  },
  NBA: {
    baseUrl: 'https://v2.nba.api-sports.io',
    host: 'v2.nba.api-sports.io',
    season: '2024-2025',
    priority: 2,
    endpoints: {
      teams: '/teams',
      standings: '/standings',
      players: '/players/statistics'
    }
  },
  NCAAF: {
    baseUrl: 'https://v1.american-football.api-sports.io',
    host: 'v1.american-football.api-sports.io',
    season: 2024,
    priority: 3,
    endpoints: {
      teams: '/teams',
      standings: '/standings',
      players: '/players/statistics'
    }
  },
  MLB: {
    baseUrl: 'https://v1.baseball.api-sports.io',
    host: 'v1.baseball.api-sports.io',
    season: 2024,
    priority: 4,
    endpoints: {
      teams: '/teams',
      standings: '/standings',
      players: '/players'
    }
  },
  NHL: {
    baseUrl: 'https://v1.hockey.api-sports.io',
    host: 'v1.hockey.api-sports.io',
    season: 2024,
    priority: 5,
    endpoints: {
      teams: '/teams',
      standings: '/standings',
      players: '/players'
    }
  },
  SOCCER: {
    baseUrl: 'https://v3.football.api-sports.io',
    host: 'v3.football.api-sports.io',
    season: 2024,
    priority: 6,
    league: 39, // Premier League
    endpoints: {
      teams: '/teams',
      standings: '/standings',
      players: '/players'
    }
  },
  GOLF: {
    baseUrl: 'https://v1.golf.api-sports.io',
    host: 'v1.golf.api-sports.io',
    season: 2024,
    priority: 7,
    endpoints: {
      leaderboards: '/leaderboards',
      rankings: '/rankings',
      players: '/players'
    }
  },
  TENNIS: {
    baseUrl: 'https://v1.tennis.api-sports.io',
    host: 'v1.tennis.api-sports.io',
    season: 2024,
    priority: 8,
    endpoints: {
      rankings: '/rankings',
      players: '/players'
    }
  },
  UFC: {
    baseUrl: 'https://v1.mma.api-sports.io',
    host: 'v1.mma.api-sports.io',
    season: 2024,
    priority: 9,
    endpoints: {
      fighters: '/fighters',
      rankings: '/rankings'
    }
  }
};

// Dynamic budget allocation based on current date and sport seasons
function calculateDynamicBudget(): { total: number; allocation: Record<string, number> } {
  const now = new Date();
  const month = now.getMonth(); // 0-based (0 = January)
  const day = now.getDate();
  
  const baseBudget = {
    total: 100,
    allocation: {
      NFL: 15,      // Base allocation
      NBA: 15,      // Base allocation  
      MLB: 15,      // Base allocation
      NCAAF: 10,    // Base allocation
      NHL: 10,      // Base allocation
      SOCCER: 10,   // Base allocation
      GOLF: 8,      // Base allocation
      TENNIS: 8,    // Base allocation
      UFC: 6,       // Base allocation
      buffer: 3     // Buffer for retries
    }
  };

  // Seasonal adjustments (boost in-season sports)
  if (month >= 8 || month <= 1) { // September-February: Football season
    baseBudget.allocation.NFL += 10;
    baseBudget.allocation.NCAAF += 8;
    baseBudget.allocation.MLB -= 8; // MLB off-season
    baseBudget.allocation.TENNIS -= 3;
  }
  
  if (month >= 9 || month <= 5) { // October-June: Basketball/Hockey season
    baseBudget.allocation.NBA += 8;
    baseBudget.allocation.NHL += 6;
    baseBudget.allocation.MLB -= 6; // MLB off-season
    baseBudget.allocation.GOLF -= 2;
  }
  
  if (month >= 2 && month <= 9) { // March-October: Baseball season
    baseBudget.allocation.MLB += 10;
    baseBudget.allocation.NFL -= 5; // NFL off-season
    baseBudget.allocation.NCAAF -= 3; // NCAAF off-season
    baseBudget.allocation.NHL -= 3; // NHL off-season (playoffs end June)
  }
  
  if (month >= 7 && month <= 4) { // August-May: Soccer season (Premier League)
    baseBudget.allocation.SOCCER += 4;
    baseBudget.allocation.TENNIS -= 2;
  }
  
  // Weekend boost for event-based sports
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  if (isWeekend) {
    baseBudget.allocation.UFC += 2;
    baseBudget.allocation.GOLF += 2;
    baseBudget.allocation.TENNIS += 2;
    baseBudget.allocation.buffer -= 6;
  }

  // Ensure no negative allocations and total = 100
  Object.keys(baseBudget.allocation).forEach(sport => {
    const sportKey = sport as keyof typeof baseBudget.allocation;
    if (baseBudget.allocation[sportKey] < 0) baseBudget.allocation[sportKey] = 1;
  });

  const total = Object.values(baseBudget.allocation).reduce((a, b) => a + b, 0);
  if (total !== 100) {
    // Adjust buffer to maintain total of 100
    baseBudget.allocation.buffer += (100 - total);
  }

  return baseBudget;
}

const DAILY_BUDGET = calculateDynamicBudget();

interface ApiCallLog {
  sport: string;
  endpoint: string;
  timestamp: string;
  success: boolean;
  calls_used: number;
}

async function fetchWithRetry(url: string, headers: Record<string, string>, maxRetries = 2): Promise<Response> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return response;
      if (response.status === 429) {
        // Rate limited - wait and retry
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      if (response.status >= 500) {
        // Server error - retry
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      return response;
    } catch (error) {
      console.error(`Fetch attempt ${i + 1} failed:`, error);
      if (i < maxRetries - 1) await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Failed to fetch after ${maxRetries} retries`);
}

async function syncSportsStats(req: Request): Promise<Response> {
  try {
    const apiKey = Deno.env.get("APISPORTS_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "APISPORTS_API_KEY not set" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: "Supabase config missing" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log("🏈 Starting daily sports stats sync");
    const startTime = Date.now();
    
    let totalCalls = 0;
    const results: Record<string, any> = {};
    const today = new Date().toISOString().split('T')[0];

    // Check today's API usage first
    const { data: todaysUsage } = await supabase
      .from('api_call_log')
      .select('calls_used')
      .eq('date', today)
      .single();

    const usedToday = todaysUsage?.calls_used || 0;
    const remainingCalls = DAILY_BUDGET.total - usedToday;
    
    if (remainingCalls <= 5) {
      console.log(`⚠️ Daily budget nearly exhausted: ${usedToday}/${DAILY_BUDGET.total} used`);
      return new Response(JSON.stringify({
        status: "budget_exhausted",
        usedToday,
        totalBudget: DAILY_BUDGET.total,
        message: "Skipping sync to preserve API budget"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Sync each sport based on priority and budget
    for (const [sport, config] of Object.entries(SPORTS_CONFIG)) {
      try {
        const sportBudget = Math.min(
          DAILY_BUDGET.allocation[sport as keyof typeof DAILY_BUDGET.allocation] || 15,
          remainingCalls - totalCalls
        );
        
        if (sportBudget <= 2) {
          console.log(`⏭️ Skipping ${sport} - insufficient budget (${sportBudget} calls remaining)`);
          continue;
        }

        console.log(`🎯 Syncing ${sport} (budget: ${sportBudget} calls)`);
        
        const sportResult = await syncSportData(sport, config, sportBudget, apiKey, supabase);
        results[sport] = sportResult;
        totalCalls += sportResult.callsUsed;
        
        // Small delay between sports
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`❌ Error syncing ${sport}:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        results[sport] = { error: errorMessage, callsUsed: 0 };
      }
    }

    // Log today's total usage
    await supabase
      .from('api_call_log')
      .upsert({
        date: today,
        calls_used: usedToday + totalCalls,
        sports_synced: Object.keys(results),
        last_updated: new Date().toISOString()
      });

    const duration = Date.now() - startTime;
    console.log(`✅ Sports sync complete: ${totalCalls} calls used in ${duration}ms`);

    return new Response(JSON.stringify({
      status: "success", 
      totalCallsUsed: totalCalls,
      dailyUsage: usedToday + totalCalls,
      dailyBudget: DAILY_BUDGET.total,
      results,
      duration
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Sports sync error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function syncSportData(
  sport: string, 
  config: any, 
  budget: number, 
  apiKey: string, 
  supabase: any
): Promise<{ callsUsed: number; teams?: number; players?: number; rankings?: number }> {
  
  let callsUsed = 0;
  const headers = {
    'x-rapidapi-key': apiKey,
    'x-rapidapi-host': config.host
  };

  const results: { callsUsed: number; teams?: number; players?: number; rankings?: number } = { callsUsed: 0 };

  try {
    // Sport-specific data syncing based on available endpoints and data structures
    switch (sport) {
      case 'NFL':
      case 'NCAAF':
        await syncAmericanFootball(sport, config, budget, headers, supabase, results);
        break;
      
      case 'NBA':
        await syncBasketball(sport, config, budget, headers, supabase, results);
        break;
        
      case 'MLB':
        await syncBaseball(sport, config, budget, headers, supabase, results);
        break;
        
      case 'NHL':
        await syncHockey(sport, config, budget, headers, supabase, results);
        break;
        
      case 'SOCCER':
        await syncSoccer(sport, config, budget, headers, supabase, results);
        break;
        
      case 'GOLF':
        await syncGolf(sport, config, budget, headers, supabase, results);
        break;
        
      case 'TENNIS':
        await syncTennis(sport, config, budget, headers, supabase, results);
        break;
        
      case 'UFC':
        await syncUFC(sport, config, budget, headers, supabase, results);
        break;
        
      default:
        console.log(`⚠️ Unknown sport: ${sport}`);
    }
  } catch (error) {
    console.error(`❌ Error syncing ${sport}:`, error);
  }

  return results;
}

// American Football (NFL/NCAAF) - Teams and player stats
async function syncAmericanFootball(sport: string, config: any, budget: number, headers: any, supabase: any, results: any) {
  let callsUsed = 0;
  
  // Teams and standings
  if (callsUsed < budget) {
    try {
      const teamsUrl = `${config.baseUrl}/teams?league=1&season=${config.season}`;
      const teamsResponse = await fetchWithRetry(teamsUrl, headers);
      const teamsData = await teamsResponse.json();
      callsUsed++;

      if (teamsData.response) {
        for (const team of teamsData.response) {
          await supabase.from('team_stats').upsert({
            sport, season: config.season, team_id: team.id, team_name: team.name,
            city: team.city, logo: team.logo, stats_json: team,
            last_updated: new Date().toISOString()
          });
        }
        results.teams = teamsData.response.length;
        console.log(`✅ ${sport}: Synced ${teamsData.response.length} teams`);
      }
    } catch (error) {
      console.error(`❌ ${sport} teams sync failed:`, error);
    }
  }

  results.callsUsed = callsUsed;
}

// Basketball (NBA) - Teams, standings, and player stats
async function syncBasketball(sport: string, config: any, budget: number, headers: any, supabase: any, results: any) {
  let callsUsed = 0;
  
  // Teams
  if (callsUsed < budget) {
    try {
      const teamsUrl = `${config.baseUrl}/teams?league=12&season=${config.season}`;
      const teamsResponse = await fetchWithRetry(teamsUrl, headers);
      const teamsData = await teamsResponse.json();
      callsUsed++;

      if (teamsData.response) {
        for (const team of teamsData.response) {
          await supabase.from('team_stats').upsert({
            sport, season: config.season, team_id: team.id, team_name: team.name,
            city: team.city, logo: team.logo, stats_json: team,
            last_updated: new Date().toISOString()
          });
        }
        results.teams = teamsData.response.length;
      }
    } catch (error) {
      console.error(`❌ ${sport} teams sync failed:`, error);
    }
  }

  results.callsUsed = callsUsed;
}

// Baseball (MLB) - Teams and player stats  
async function syncBaseball(sport: string, config: any, budget: number, headers: any, supabase: any, results: any) {
  let callsUsed = 0;
  
  // Teams
  if (callsUsed < budget) {
    try {
      const teamsUrl = `${config.baseUrl}/teams?league=1&season=${config.season}`;
      const teamsResponse = await fetchWithRetry(teamsUrl, headers);
      const teamsData = await teamsResponse.json();
      callsUsed++;

      if (teamsData.response) {
        for (const team of teamsData.response) {
          await supabase.from('team_stats').upsert({
            sport, season: config.season, team_id: team.id, team_name: team.name,
            city: team.city, logo: team.logo, stats_json: team,
            last_updated: new Date().toISOString()
          });
        }
        results.teams = teamsData.response.length;
      }
    } catch (error) {
      console.error(`❌ ${sport} teams sync failed:`, error);
    }
  }

  results.callsUsed = callsUsed;
}

// Hockey (NHL) - Teams and player stats
async function syncHockey(sport: string, config: any, budget: number, headers: any, supabase: any, results: any) {
  let callsUsed = 0;
  
  // Teams
  if (callsUsed < budget) {
    try {
      const teamsUrl = `${config.baseUrl}/teams?league=57&season=${config.season}`;
      const teamsResponse = await fetchWithRetry(teamsUrl, headers);
      const teamsData = await teamsResponse.json();
      callsUsed++;

      if (teamsData.response) {
        for (const team of teamsData.response) {
          await supabase.from('team_stats').upsert({
            sport, season: config.season, team_id: team.id, team_name: team.name,
            city: team.city, logo: team.logo, stats_json: team,
            last_updated: new Date().toISOString()
          });
        }
        results.teams = teamsData.response.length;
      }
    } catch (error) {
      console.error(`❌ ${sport} teams sync failed:`, error);
    }
  }

  results.callsUsed = callsUsed;
}

// Soccer - Teams and standings
async function syncSoccer(sport: string, config: any, budget: number, headers: any, supabase: any, results: any) {
  let callsUsed = 0;
  
  // Teams (Premier League)
  if (callsUsed < budget) {
    try {
      const teamsUrl = `${config.baseUrl}/teams?league=${config.league}&season=${config.season}`;
      const teamsResponse = await fetchWithRetry(teamsUrl, headers);
      const teamsData = await teamsResponse.json();
      callsUsed++;

      if (teamsData.response) {
        for (const team of teamsData.response) {
          await supabase.from('team_stats').upsert({
            sport, season: config.season, team_id: team.team.id, team_name: team.team.name,
            city: team.team.city, logo: team.team.logo, stats_json: team,
            last_updated: new Date().toISOString()
          });
        }
        results.teams = teamsData.response.length;
      }
    } catch (error) {
      console.error(`❌ ${sport} teams sync failed:`, error);
    }
  }

  results.callsUsed = callsUsed;
}

// Golf - Rankings and tournament data
async function syncGolf(sport: string, config: any, budget: number, headers: any, supabase: any, results: any) {
  let callsUsed = 0;
  
  // Rankings
  if (callsUsed < budget) {
    try {
      const rankingsUrl = `${config.baseUrl}/rankings`;
      const rankingsResponse = await fetchWithRetry(rankingsUrl, headers);
      const rankingsData = await rankingsResponse.json();
      callsUsed++;

      if (rankingsData.response) {
        for (const player of rankingsData.response.slice(0, 50)) { // Top 50
          await supabase.from('player_stats').upsert({
            sport, season: config.season, player_id: player.id, player_name: player.name,
            position: player.rank?.toString(), stats_json: player,
            last_updated: new Date().toISOString()
          });
        }
        results.rankings = Math.min(rankingsData.response.length, 50);
      }
    } catch (error) {
      console.error(`❌ ${sport} rankings sync failed:`, error);
    }
  }

  results.callsUsed = callsUsed;
}

// Tennis - Rankings
async function syncTennis(sport: string, config: any, budget: number, headers: any, supabase: any, results: any) {
  let callsUsed = 0;
  
  // ATP Rankings
  if (callsUsed < budget) {
    try {
      const rankingsUrl = `${config.baseUrl}/rankings/atp`;
      const rankingsResponse = await fetchWithRetry(rankingsUrl, headers);
      const rankingsData = await rankingsResponse.json();
      callsUsed++;

      if (rankingsData.response) {
        for (const player of rankingsData.response.slice(0, 50)) { // Top 50
          await supabase.from('player_stats').upsert({
            sport, season: config.season, player_id: player.id, player_name: player.name,
            position: player.rank?.toString(), stats_json: player,
            last_updated: new Date().toISOString()
          });
        }
        results.rankings = Math.min(rankingsData.response.length, 50);
      }
    } catch (error) {
      console.error(`❌ ${sport} ATP rankings sync failed:`, error);
    }
  }

  results.callsUsed = callsUsed;
}

// UFC - Fighter rankings
async function syncUFC(sport: string, config: any, budget: number, headers: any, supabase: any, results: any) {
  let callsUsed = 0;
  
  // Fighter rankings
  if (callsUsed < budget) {
    try {
      const rankingsUrl = `${config.baseUrl}/rankings`;
      const rankingsResponse = await fetchWithRetry(rankingsUrl, headers);
      const rankingsData = await rankingsResponse.json();
      callsUsed++;

      if (rankingsData.response) {
        for (const fighter of rankingsData.response.slice(0, 30)) { // Top 30
          await supabase.from('player_stats').upsert({
            sport, season: config.season, player_id: fighter.id, player_name: fighter.name,
            position: fighter.rank?.toString(), stats_json: fighter,
            last_updated: new Date().toISOString()
          });
        }
        results.rankings = Math.min(rankingsData.response.length, 30);
      }
    } catch (error) {
      console.error(`❌ ${sport} rankings sync failed:`, error);
    }
  }

  results.callsUsed = callsUsed;
}

serve(syncSportsStats);