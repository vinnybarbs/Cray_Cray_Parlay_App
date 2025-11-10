// @ts-ignore - Deno imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore - Deno imports  
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// Sports configuration matching your existing setup
const SPORTS_CONFIG = {
  NFL: {
    baseUrl: 'https://v1.american-football.api-sports.io',
    host: 'v1.american-football.api-sports.io',
    season: 2024,
    priority: 1  // Highest priority
  },
  NBA: {
    baseUrl: 'https://v2.nba.api-sports.io', 
    host: 'v2.nba.api-sports.io',
    season: '2024-2025',
    priority: 2
  },
  NCAAF: {
    baseUrl: 'https://v1.american-football.api-sports.io',
    host: 'v1.american-football.api-sports.io', 
    season: 2024,
    priority: 3
  }
};

// Daily API call budget allocation
const DAILY_BUDGET = {
  total: 100,
  allocation: {
    NFL: 40,      // 40% - highest priority
    NBA: 25,      // 25% 
    NCAAF: 20,    // 20%
    buffer: 15    // 15% buffer for retries/extras
  }
};

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
): Promise<{ callsUsed: number; teams?: number; players?: number; games?: number }> {
  
  let callsUsed = 0;
  const headers = {
    'x-rapidapi-key': apiKey,
    'x-rapidapi-host': config.host
  };

  // Priority 1: Teams and standings (1-2 calls)
  if (callsUsed < budget - 1) {
    try {
      const teamsUrl = `${config.baseUrl}/teams?league=1&season=${config.season}`;
      const teamsResponse = await fetchWithRetry(teamsUrl, headers);
      const teamsData = await teamsResponse.json();
      callsUsed++;

      if (teamsData.response) {
        // Store teams data
        for (const team of teamsData.response) {
          await supabase
            .from('team_stats')
            .upsert({
              sport,
              season: config.season,
              team_id: team.id,
              team_name: team.name,
              city: team.city,
              logo: team.logo,
              stats_json: team,
              last_updated: new Date().toISOString()
            });
        }
        console.log(`✅ ${sport}: Synced ${teamsData.response.length} teams`);
      }
    } catch (error) {
      console.error(`❌ ${sport} teams sync failed:`, error);
    }
  }

  // Priority 2: Player stats (use remaining budget efficiently)  
  const remainingBudget = budget - callsUsed;
  if (remainingBudget > 2) {
    try {
      // Get top players stats (limit to budget)
      const playersUrl = `${config.baseUrl}/players/statistics?league=1&season=${config.season}`;
      const playersResponse = await fetchWithRetry(playersUrl, headers);
      const playersData = await playersResponse.json();
      callsUsed++;

      if (playersData.response) {
        // Store player stats
        for (const player of playersData.response.slice(0, 100)) { // Limit to top 100
          await supabase
            .from('player_stats')
            .upsert({
              sport,
              season: config.season,
              player_id: player.player?.id,
              player_name: player.player?.name,
              team_id: player.team?.id,
              team_name: player.team?.name,
              position: player.player?.position,
              stats_json: player.statistics,
              last_updated: new Date().toISOString()
            });
        }
        console.log(`✅ ${sport}: Synced ${Math.min(playersData.response.length, 100)} player stats`);
      }
    } catch (error) {
      console.error(`❌ ${sport} players sync failed:`, error);
    }
  }

  return { callsUsed };
}

serve(syncSportsStats);