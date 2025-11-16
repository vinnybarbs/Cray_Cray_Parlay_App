// @ts-ignore - Deno imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore - Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const SPORTS = [
  "americanfootball_nfl",
  "americanfootball_ncaaf", 
  "basketball_nba",
  "icehockey_nhl",
  "soccer_epl"
];

const PROP_SPORTS = ["americanfootball_nfl", "basketball_nba"];

const CORE_MARKETS = "h2h,spreads,totals";

const PROP_MARKETS = {
  americanfootball_nfl: [
    "player_pass_tds",
    "player_pass_yds", 
    "player_rush_yds",
    "player_receptions",
    "player_reception_yds",
    "player_anytime_td"
  ],
  basketball_nba: [
    "player_points",
    "player_rebounds", 
    "player_assists",
    "player_threes"
  ]
};

const BOOKMAKERS = "draftkings,fanduel";
const REGIONS = "us";
const ODDS_FORMAT = "american";

const DELAYS = {
  betweenSports: 2000,
  betweenProps: 1500,
  afterAvailability: 1000
};

interface RateLimitInfo {
  remaining: number;
  used: number;
  requestsRemaining: number;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, retries = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      if (i === retries) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (i === retries) throw error;
      await delay(1000 * (i + 1));
    }
  }
  throw new Error("Max retries exceeded");
}

async function logRateLimit(response: Response): Promise<RateLimitInfo | null> {
  const remaining = response.headers.get("x-requests-remaining");
  const used = response.headers.get("x-requests-used");
  
  if (remaining && used) {
    const rateInfo = {
      remaining: parseInt(remaining),
      used: parseInt(used),
      requestsRemaining: parseInt(remaining)
    };
    console.log(`📊 Rate limit: ${rateInfo.used} used, ${rateInfo.remaining} remaining`);
    return rateInfo;
  }
  return null;
}

async function checkAvailableSports(oddsApiKey: string): Promise<string[]> {
  const url = `https://api.the-odds-api.com/v4/sports/?apiKey=${oddsApiKey}`;
  console.log("🔍 Checking available sports...");
  
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch available sports: ${response.status}`);
  }
  
  await logRateLimit(response);
  const data = await response.json() as Array<{ key: string }>;
  const keys = data.map(s => s.key);
  console.log(`✅ Available sports: ${keys.length} total`);
  
  return keys;
}

async function fetchCoreMarkets(
  sport: string,
  oddsApiKey: string
): Promise<{ games: any[]; rateLimit: RateLimitInfo | null }> {
  const params = new URLSearchParams({
    apiKey: oddsApiKey,
    regions: REGIONS,
    markets: CORE_MARKETS,
    oddsFormat: ODDS_FORMAT,
    bookmakers: BOOKMAKERS
  });
  
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?${params}`;
  console.log(`🔍 Fetching ${sport} (core markets)...`);
  
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${sport}: ${response.status}`);
  }
  
  const rateLimit = await logRateLimit(response);
  const games = await response.json() as any[];
  console.log(`✅ Fetched ${games.length} games for ${sport}`);
  
  return { games, rateLimit };
}

async function fetchPropMarkets(
  sport: string,
  oddsApiKey: string
): Promise<{ games: any[]; rateLimit: RateLimitInfo | null }> {
  const propMarkets = PROP_MARKETS[sport as keyof typeof PROP_MARKETS];
  if (!propMarkets || propMarkets.length === 0) {
    console.log(`⚠️  No prop markets configured for ${sport}`);
    return { games: [], rateLimit: null };
  }
  
  const params = new URLSearchParams({
    apiKey: oddsApiKey,
    regions: REGIONS,
    markets: propMarkets.join(','),
    oddsFormat: ODDS_FORMAT,
    bookmakers: BOOKMAKERS
  });
  
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?${params}`;
  console.log(`🏈 Fetching ${sport} (prop markets: ${propMarkets.join(', ')})...`);
  
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${sport} props: ${response.status}`);
  }
  
  const rateLimit = await logRateLimit(response);
  const games = await response.json() as any[];
  console.log(`✅ Fetched ${games.length} games with props for ${sport}`);
  
  return { games, rateLimit };
}

async function refreshOddsFast(req: Request): Promise<Response> {
  try {
    const oddsApiKey = Deno.env.get("ODDS_API_KEY");
    if (!oddsApiKey) {
      return new Response(JSON.stringify({ error: "ODDS_API_KEY not set" }), {
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
    
    console.log("🚀 Starting FAST odds cache refresh (batched operations)");
    const startTime = Date.now();
    
    // Check available sports
    const availableSports = await checkAvailableSports(oddsApiKey);
    await delay(DELAYS.afterAvailability);
    
    // Filter to configured sports that are available
    const sportsToFetch = SPORTS.filter(s => availableSports.includes(s));
    console.log(`📋 Sports to fetch: ${sportsToFetch.join(", ")}`);
    
    let totalGames = 0;
    const allOddsEntries: any[] = []; // Collect ALL entries for batch insert
    
    // Fetch core AND prop markets for each sport
    for (const sport of sportsToFetch) {
      try {
        if (sportsToFetch.indexOf(sport) > 0) {
          await delay(DELAYS.betweenSports);
        }
        
        // Fetch core markets (h2h, spreads, totals)
        const { games: coreGames, rateLimit: coreRate } = await fetchCoreMarkets(sport, oddsApiKey);
        totalGames += coreGames.length;
        
        // Process core market games
        for (const game of coreGames) {
          for (const bookmaker of game.bookmakers || []) {
            for (const market of bookmaker.markets || []) {
              const cacheEntry = {
                sport: sport,
                external_game_id: game.id,
                commence_time: game.commence_time,
                home_team: game.home_team,
                away_team: game.away_team,
                bookmaker: bookmaker.key,
                market_type: market.key,
                outcomes: market.outcomes,
                last_updated: new Date().toISOString()
              };
              
              allOddsEntries.push(cacheEntry);
            }
          }
        }
        
        // Add delay before fetching prop markets
        await delay(DELAYS.betweenProps);
        
        // Fetch player prop markets
        const { games: propGames, rateLimit: propRate } = await fetchPropMarkets(sport, oddsApiKey);
        
        // Process prop market games (separate from core to avoid duplication)
        for (const game of propGames) {
          for (const bookmaker of game.bookmakers || []) {
            for (const market of bookmaker.markets || []) {
              const cacheEntry = {
                sport: sport,
                external_game_id: game.id,
                commence_time: game.commence_time,
                home_team: game.home_team,
                away_team: game.away_team,
                bookmaker: bookmaker.key,
                market_type: market.key,
                outcomes: market.outcomes,
                last_updated: new Date().toISOString()
              };
              
              allOddsEntries.push(cacheEntry);
            }
          }
        }
        
      } catch (error) {
        console.error(`Error fetching ${sport}:`, error);
      }
    }
    
    console.log(`\n💾 Performing smart selective replacement...`);
    console.log(`📊 Collected ${allOddsEntries.length} odds entries from ${totalGames} games`);
    
    // STEP 1: Get unique game IDs from fresh API data
    const freshGameIds = [...new Set(allOddsEntries.map(entry => entry.external_game_id))];
    console.log(`🎯 Fresh games from API: ${freshGameIds.length} games`);

    // STEP 1.5: Upsert games before inserting odds
    const gameRecords = allOddsEntries.map(entry => ({
      game_id: entry.external_game_id,
      commence_time: entry.commence_time,
      home_team: entry.home_team,
      away_team: entry.away_team,
      sport: entry.sport
    }));
    // Remove duplicates by game_id
    const uniqueGames = Object.values(
      gameRecords.reduce((acc, game) => {
        acc[game.game_id] = game;
        return acc;
      }, {})
    );
    if (uniqueGames.length > 0) {
      console.log(`💾 Upserting ${uniqueGames.length} games into games table...`);
      const { error: gameUpsertError } = await supabase
        .from('games')
        .upsert(uniqueGames, { onConflict: ['game_id'] });
      if (gameUpsertError) {
        console.error('Error upserting games:', gameUpsertError);
        throw new Error(`Game upsert failed: ${gameUpsertError.message}`);
      }
      console.log(`✅ Upserted ${uniqueGames.length} games`);
    }

    // STEP 2: Delete ONLY the games we have fresh data for (preserves other games)
    if (freshGameIds.length > 0) {
      console.log('🗑️ Removing stale odds for games with fresh data...');
      const { error: deleteError } = await supabase
        .from('odds_cache')
        .delete()
        .in('external_game_id', freshGameIds);
      
      if (deleteError) {
        console.error('Error clearing stale odds:', deleteError);
        throw new Error(`Selective delete failed: ${deleteError.message}`);
      }
      console.log(`✅ Cleared stale data for ${freshGameIds.length} games`);
    }

    // STEP 3: Insert all fresh data (includes updates + new games/markets)
    console.log(`💾 Inserting ${allOddsEntries.length} fresh odds entries...`);
    const chunkSize = 500;
    let totalInserted = 0;

    for (let i = 0; i < allOddsEntries.length; i += chunkSize) {
      const chunk = allOddsEntries.slice(i, i + chunkSize);
      console.log(`📤 Processing fresh batch ${Math.floor(i/chunkSize) + 1}: ${chunk.length} entries`);
      
      const { data, error } = await supabase
        .from('odds_cache')
        .insert(chunk);
      
      if (error) {
        console.error(`❌ Error inserting fresh batch ${Math.floor(i/chunkSize) + 1}:`, error);
        console.error('Sample record:', JSON.stringify(chunk[0], null, 2));
        throw new Error(`Fresh data insert failed: ${error.message}`);
      } else {
        totalInserted += chunk.length;
        console.log(`✅ Inserted fresh batch ${Math.floor(i/chunkSize) + 1}: ${chunk.length} entries`);
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`\n🎉 FAST refresh complete!`);
    console.log(`📊 ${totalGames} games processed`);
    console.log(`💾 ${totalInserted} odds entries inserted (fresh + new games/markets)`);
    console.log(`⏱️ Duration: ${duration}ms (${(duration/1000).toFixed(1)}s)`);
    
    return new Response(JSON.stringify({
      status: "success",
      method: "smart_selective_replacement",
      totalGames,
      freshGames: freshGameIds.length,
      totalOddsInserted: totalInserted,
      duration,
      durationSeconds: Math.round(duration / 1000)
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    
  } catch (error) {
    console.error("Smart refresh error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : String(error),
      method: "smart_selective_replacement"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

serve(refreshOddsFast);