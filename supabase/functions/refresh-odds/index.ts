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
    
    console.log("🚀 Starting quick odds refresh for NFL & NBA via Edge Function...");
    const startTime = Date.now();

    // Mirror scripts/quick-odds-refresh.js:
    //   - Only refresh NFL & NBA
    //   - Fetch core markets, clear old rows for those sports, insert fresh data
    //   - Then fetch per-event player props and insert those as well.

    const SPORTS_TO_REFRESH = ["americanfootball_nfl", "basketball_nba"];
    const allSportGames: Array<{ sport: string; games: any[] }> = [];

    // 1) Fetch core odds for NFL & NBA
    for (const sport of SPORTS_TO_REFRESH) {
      try {
        const params = new URLSearchParams({
          apiKey: oddsApiKey,
          regions: REGIONS,
          markets: CORE_MARKETS,
          oddsFormat: ODDS_FORMAT,
          bookmakers: BOOKMAKERS
        });

        const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?${params.toString()}`;
        console.log(`📥 Fetching ${sport} core odds...`);

        const response = await fetchWithRetry(url);
        if (!response.ok) {
          console.log(`⚠️ Core odds request failed for ${sport}: ${response.status}`);
          continue;
        }

        const games = await response.json() as any[];
        console.log(`✅ Fetched ${games.length} games for ${sport}`);
        allSportGames.push({ sport, games });
      } catch (err) {
        console.error(`❌ Error fetching core odds for ${sport}:`, err);
      }
    }

    // 2) Clear old odds data only for NFL & NBA, then insert fresh data
    console.log("🗑️ Clearing old NFL & NBA odds data...");
    const { error: deleteError } = await supabase
      .from("odds_cache")
      .delete()
      .in("sport", SPORTS_TO_REFRESH);

    if (deleteError) {
      console.error("⚠️ Error clearing old odds:", deleteError);
    }

    console.log("💾 Inserting fresh core odds data...");
    let totalGames = 0;
    let totalOddsInserted = 0;

    for (const { sport, games } of allSportGames) {
      totalGames += games.length;

      for (const game of games) {
        for (const bookmaker of (game.bookmakers || [])) {
          for (const market of (bookmaker.markets || [])) {
            const record = {
              sport,
              external_game_id: game.id,
              commence_time: game.commence_time,
              home_team: game.home_team,
              away_team: game.away_team,
              bookmaker: bookmaker.key,
              market_type: market.key,
              outcomes: market.outcomes,
              last_updated: new Date().toISOString()
            };

            const { error } = await supabase
              .from("odds_cache")
              .upsert(record, {
                onConflict: "external_game_id,bookmaker,market_type"
              });

            if (error) {
              console.log("⚠️ Error upserting core odds:", error.message || error);
            } else {
              totalOddsInserted++;
            }
          }
        }
      }
    }

    // 3) Fetch and insert player props via per-event endpoint for NFL & NBA
    console.log("🎯 Fetching player props for NFL & NBA games...");

    for (const { sport, games } of allSportGames) {
      const propList = PROP_MARKETS[sport as keyof typeof PROP_MARKETS];
      if (!propList || propList.length === 0) continue;

      const propMarketsParam = propList.join(",");

      for (const game of games) {
        try {
          const eventId = game.id;
          const params = new URLSearchParams({
            apiKey: oddsApiKey,
            regions: REGIONS,
            markets: propMarketsParam,
            oddsFormat: ODDS_FORMAT,
            bookmakers: BOOKMAKERS
          });

          const propsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/odds/?${params.toString()}`;
          const propsResponse = await fetchWithRetry(propsUrl);

          if (!propsResponse.ok) {
            console.log(`⚠️ Props request failed for ${sport} event ${eventId}: ${propsResponse.status}`);
            continue;
          }

          const propsData = await propsResponse.json();
          const events = Array.isArray(propsData) ? propsData : [propsData];

          if (!events || events.length === 0) {
            console.log(`ℹ️ No props returned for ${sport} event ${eventId}`);
            continue;
          }

          for (const event of events) {
            if (!event.bookmakers || event.bookmakers.length === 0) continue;

            for (const bookmaker of event.bookmakers) {
              if (!bookmaker.markets || bookmaker.markets.length === 0) continue;

              for (const market of bookmaker.markets) {
                if (!market.outcomes || market.outcomes.length === 0) continue;

                const record = {
                  sport,
                  external_game_id: game.id,
                  commence_time: game.commence_time,
                  home_team: game.home_team,
                  away_team: game.away_team,
                  bookmaker: bookmaker.key,
                  market_type: market.key,
                  outcomes: market.outcomes,
                  last_updated: new Date().toISOString()
                };

                const { error } = await supabase
                  .from("odds_cache")
                  .upsert(record, {
                    onConflict: "external_game_id,bookmaker,market_type"
                  });

                if (error) {
                  console.log("⚠️ Error upserting props odds:", error.message || error);
                } else {
                  totalOddsInserted++;
                }
              }
            }
          }
        } catch (e) {
          console.log(`⚠️ Error fetching props for ${sport} game ${game.id}:`, (e as Error).message);
        }

        // Small delay between prop requests to avoid hitting rate limits too fast
        await delay(DELAYS.betweenProps);
      }
    }

    const duration = Date.now() - startTime;
    const totalGamesProcessed = allSportGames.reduce((sum, sg) => sum + sg.games.length, 0);

    console.log("✅ Quick refresh complete!");
    console.log(`📊 Processed ${totalGamesProcessed} games across NFL & NBA`);

    return new Response(JSON.stringify({
      status: "success",
      totalGames: totalGamesProcessed,
      totalOddsInserted,
      duration
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    
  } catch (error) {
    console.error("Edge Function error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

serve(refreshOdds);
