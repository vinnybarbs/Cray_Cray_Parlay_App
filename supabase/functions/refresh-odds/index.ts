import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    "player_pass_completions",
    "player_rush_yds",
    "player_receptions",
    "player_reception_yds",
    "player_anytime_td"
  ],
  basketball_nba: [
    "player_points",
    "player_rebounds",
    "player_assists",
    "player_threes",
    "player_steals",
    "player_blocks"
  ]
};

const BOOKMAKERS = "draftkings,fanduel";
const REGIONS = "us";
const ODDS_FORMAT = "american";

// Rate limits in milliseconds
const DELAYS = {
  betweenSports: 2000,    // 2s between sports
  betweenProps: 1500,     // 1.5s between prop calls
  afterAvailability: 1000  // 1s after availability check
};

interface RateLimitInfo {
  remaining: number;
  used: number;
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      if (response.status === 429) {
        // Rate limited - wait longer
        await delay(5000);
        continue;
      }
      if (response.status >= 500) {
        // Server error - retry
        await delay(2000);
        continue;
      }
      return response;
    } catch (err) {
      console.error(`Fetch attempt ${i + 1} failed:`, err);
      if (i < maxRetries - 1) await delay(1000);
    }
  }
  throw new Error(`Failed to fetch after ${maxRetries} retries`);
}

async function logRateLimit(response: Response): Promise<RateLimitInfo | null> {
  const remaining = response.headers.get("x-requests-remaining");
  const used = response.headers.get("x-requests-used");
  
  if (remaining && used) {
    const info = { remaining: parseInt(remaining), used: parseInt(used) };
    console.log(`📊 API Rate Limit: ${info.remaining} remaining (${info.used} used)`);
    return info;
  }
  return null;
}

async function checkAvailableSports(oddsApiKey: string): Promise<string[]> {
  console.log("🔍 Checking available sports...");
  const url = `https://api.the-odds-api.com/v4/sports/?apiKey=${oddsApiKey}`;
  
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch available sports: ${response.status}`);
  }
  
  await logRateLimit(response);
  const data = await response.json() as Array<{ key: string }>;
  const keys = data.map(s => s.key);
  console.log(`✅ Available sports: ${keys.join(", ")}`);
  
  return keys;
}

async function fetchCoreMarkets(
  sport: string,
  oddsApiKey: string
): Promise<{ games: unknown[]; rateLimit: RateLimitInfo | null }> {
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
  const games = await response.json() as unknown[];
  console.log(`✅ Fetched ${games.length} games for ${sport}`);
  
  return { games, rateLimit };
}

async function fetchPlayerProps(
  sport: string,
  gameId: string,
  oddsApiKey: string
): Promise<{ props: unknown[] | null; rateLimit: RateLimitInfo | null }> {
  if (!PROP_MARKETS[sport as keyof typeof PROP_MARKETS]) {
    return { props: null, rateLimit: null };
  }
  
  const markets = PROP_MARKETS[sport as keyof typeof PROP_MARKETS].join(",");
  const params = new URLSearchParams({
    apiKey: oddsApiKey,
    regions: REGIONS,
    markets: markets,
    oddsFormat: ODDS_FORMAT,
    bookmakers: BOOKMAKERS
  });
  
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/events/${gameId}/odds/?${params}`;
  
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    console.warn(`⚠️ Failed to fetch props for ${sport}/${gameId}: ${response.status}`);
    return { props: null, rateLimit: null };
  }
  
  const rateLimit = await logRateLimit(response);
  const props = await response.json() as unknown[];
  
  return { props, rateLimit };
}

async function refreshOdds(req: Request): Promise<Response> {
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
    
    console.log("🚀 Starting odds cache refresh via Edge Function");
    const startTime = Date.now();
    
    // Check available sports
    const availableSports = await checkAvailableSports(oddsApiKey);
    await delay(DELAYS.afterAvailability);
    
    // Filter to configured sports that are available
    const sportsToFetch = SPORTS.filter(s => availableSports.includes(s));
    console.log(`📋 Sports to fetch: ${sportsToFetch.join(", ")}`);
    
    let totalGames = 0;
    let totalOddsInserted = 0;
    const allGameIds: Array<{ sport: string; id: string }> = [];
    
    // Fetch core markets for each sport
    for (const sport of sportsToFetch) {
      try {
        if (sportsToFetch.indexOf(sport) > 0) {
          await delay(DELAYS.betweenSports);
        }
        
        const { games, rateLimit } = await fetchCoreMarkets(sport, oddsApiKey);
        totalGames += games.length;
        
        // Collect game IDs for props fetch (NFL, NBA only)
        if (PROP_SPORTS.includes(sport)) {
          games.forEach((game: any) => {
            allGameIds.push({ sport, id: game.id });
          });
        }
        
        // Store in odds_cache via Supabase
        // Note: Your existing schema should handle this
        for (const game of games) {
          for (const bookmaker of (game as any).bookmakers || []) {
            for (const market of bookmaker.markets || []) {
              const cacheEntry = {
                sport: sport,
                game_id: (game as any).id,
                external_game_id: (game as any).id,
                commence_time: (game as any).commence_time,
                home_team: (game as any).home_team,
                away_team: (game as any).away_team,
                bookmaker: bookmaker.key,
                market_type: market.key,
                outcomes: market.outcomes,
                last_updated: new Date().toISOString()
              };
              
              const { error } = await supabase
                .from("odds_cache")
                .upsert([cacheEntry], { onConflict: "external_game_id,bookmaker,market_type" });
              
              if (error) {
                console.error("Error upserting odds:", error);
              } else {
                totalOddsInserted++;
              }
            }
          }
        }
        
      } catch (error) {
        console.error(`Error fetching ${sport}:`, error);
      }
    }
    
    // Fetch player props for NFL/NBA
    console.log(`\n🎯 Fetching player props for ${allGameIds.length} games...`);
    for (let i = 0; i < allGameIds.length && i < 20; i++) {
      try {
        if (i > 0) await delay(DELAYS.betweenProps);
        
        const { sport, id } = allGameIds[i];
        const { props } = await fetchPlayerProps(sport, id, oddsApiKey);
        
        if (props) {
          // Store player props similar to core markets
          // (Your schema may need adjustment for player_props table if separate)
          for (const bookmaker of (props as any).bookmakers || []) {
            for (const market of bookmaker.markets || []) {
              const propEntry = {
                sport: sport,
                game_id: id,
                external_game_id: id,
                bookmaker: bookmaker.key,
                market_type: market.key,
                outcomes: market.outcomes,
                last_updated: new Date().toISOString()
              };
              
              const { error } = await supabase
                .from("odds_cache")
                .upsert([propEntry], { onConflict: "external_game_id,bookmaker,market_type" });
              
              if (error) {
                console.error("Error upserting props:", error);
              } else {
                totalOddsInserted++;
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching props:`, error);
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Refresh complete: ${totalGames} games, ${totalOddsInserted} odds entries in ${duration}ms`);
    
    return new Response(JSON.stringify({
      status: "success",
      totalGames,
      totalOddsInserted,
      duration
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    
  } catch (error) {
    console.error("Edge Function error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

serve(refreshOdds);
