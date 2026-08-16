// @ts-ignore - Deno imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore - Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const SPORTS = [
  // Team sports
  "americanfootball_nfl",
  // Preseason NFL is a SEPARATE sport key on The Odds API. Without it the
  // whole August slate is invisible (americanfootball_nfl carries only
  // regular-season events, which start 2026-09-10). Out of season the key
  // just returns no events at the cost of one list call.
  "americanfootball_nfl_preseason",
  "americanfootball_ncaaf",
  "basketball_nba",
  "basketball_ncaab",
  "icehockey_nhl",
  "baseball_mlb",
  "soccer_epl",
  "soccer_usa_mls",
  "mma_mixed_martial_arts",
  // Tennis only returns data when a tournament is in season. The old list
  // stopped at the slams plus three spring Masters, so the feed went dark
  // every summer (last tennis odds 2026-07-12, the end of Wimbledon).
  // Cover the full Masters and WTA 1000 calendar. Out-of-season or unknown
  // keys are skipped by the per-sport error handling below at no cost.
  "tennis_atp_aus_open_singles",
  "tennis_atp_indian_wells",
  "tennis_atp_miami_open",
  "tennis_atp_monte_carlo_masters",
  "tennis_atp_madrid_open",
  "tennis_atp_italian_open",
  "tennis_atp_french_open",
  "tennis_atp_wimbledon",
  "tennis_atp_canadian_open",
  "tennis_atp_cincinnati_open",
  "tennis_atp_us_open",
  "tennis_atp_shanghai_masters",
  "tennis_atp_paris_masters",
  "tennis_wta_aus_open_singles",
  "tennis_wta_indian_wells",
  "tennis_wta_miami_open",
  "tennis_wta_madrid_open",
  "tennis_wta_italian_open",
  "tennis_wta_french_open",
  "tennis_wta_wimbledon",
  "tennis_wta_canadian_open",
  "tennis_wta_cincinnati_open",
  "tennis_wta_us_open",
  "tennis_wta_wuhan_open",
  "tennis_wta_china_open"
];

const PROP_SPORTS = ["americanfootball_nfl", "americanfootball_nfl_preseason", "basketball_nba", "basketball_ncaab"];

const CORE_MARKETS = "h2h,spreads,totals";

const NFL_PROP_MARKETS = [
  "player_pass_tds",
  "player_pass_yds",
  "player_pass_completions",
  "player_rush_yds",
  "player_receptions",
  "player_reception_yds",
  "player_anytime_td"
];

const PROP_MARKETS = {
  americanfootball_nfl: NFL_PROP_MARKETS,
  americanfootball_nfl_preseason: NFL_PROP_MARKETS,
  basketball_nba: [
    "player_points",
    "player_rebounds",
    "player_assists",
    "player_threes",
    "player_steals",
    "player_blocks"
  ],
  basketball_ncaab: [
    "player_points",
    "player_rebounds",
    "player_assists",
    "player_threes"
  ]
};

// Expanded to 6 US-regulated books for cross-book line comparison (market_edge
// in the fact sheet). The-odds-api bills per request, not per bookmaker, so
// adding books does not increase API credit cost; it just returns richer payloads.
// If a book key is invalid, the API silently omits it (no error).
const BOOKMAKERS = "draftkings,fanduel,betmgm,caesars,betrivers,fanatics";
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
    
    console.log("🚀 Starting quick odds refresh for NFL, NBA & NCAAB via Edge Function...");
    const startTime = Date.now();

    // Mirror scripts/quick-odds-refresh.js:
    //   - Refresh NFL, NBA & NCAAB
    //   - Fetch core markets, clear old rows for those sports, insert fresh data
    //   - Then fetch per-event player props and insert those as well.

    // Per-sport atomic replace (2026-08-12). The old flow fetched every
    // sport into memory, deleted ALL sports' rows in one statement, then
    // upserted one row per market per book per game sequentially, then
    // walked a per-event props loop with a 1.5s delay per event. When
    // football markets opened (~2,000 events) the function blew the edge
    // time limit mid-insert on every run: the global delete had already
    // fired, so MLB and tennis vanished from the cache while the gateway
    // returned 504 and pg_cron recorded success. Now each sport is
    // fetched, horizon-filtered, and swapped in batched writes, so a slow
    // or failed sport can never destroy another sport's rows, and a hard
    // time budget stops starting new sports before the platform kills the
    // function.

    const HORIZON_DAYS = 21;          // ignore events further out than this
    const TIME_BUDGET_MS = 100_000;   // stop starting new sports after this
    const INSERT_CHUNK = 500;
    const horizonMs = Date.now() + HORIZON_DAYS * 24 * 3600 * 1000;

    const coreGames: Record<string, any[]> = {};
    let totalGames = 0;
    let totalOddsInserted = 0;
    const skippedForTime: string[] = [];

    for (const sport of SPORTS) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        skippedForTime.push(sport);
        continue;
      }
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
        await logRateLimit(response);

        const games = (await response.json() as any[])
          .filter(g => g?.commence_time && new Date(g.commence_time).getTime() < horizonMs);
        console.log(`✅ Fetched ${games.length} games for ${sport} inside ${HORIZON_DAYS}d horizon`);
        coreGames[sport] = games;

        const now = new Date().toISOString();
        const rows: any[] = [];
        for (const game of games) {
          for (const bookmaker of (game.bookmakers || [])) {
            for (const market of (bookmaker.markets || [])) {
              rows.push({
                sport,
                external_game_id: game.id,
                commence_time: game.commence_time,
                home_team: game.home_team,
                away_team: game.away_team,
                bookmaker: bookmaker.key,
                market_type: market.key,
                outcomes: market.outcomes,
                last_updated: now
              });
            }
          }
        }

        // Swap this sport's rows only now that fresh data is in hand. A
        // fetch failure above leaves yesterday's rows serving the board.
        const { error: deleteError } = await supabase
          .from("odds_cache")
          .delete()
          .eq("sport", sport);
        if (deleteError) {
          console.error(`⚠️ Error clearing ${sport}, keeping old rows:`, deleteError);
          continue;
        }
        for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
          const chunk = rows.slice(i, i + INSERT_CHUNK);
          const { error } = await supabase
            .from("odds_cache")
            .upsert(chunk, { onConflict: "external_game_id,bookmaker,market_type" });
          if (error) console.log(`⚠️ Error inserting ${sport} chunk:`, error.message || error);
          else totalOddsInserted += chunk.length;
        }
        totalGames += games.length;
      } catch (err) {
        console.error(`❌ Error refreshing ${sport}:`, err);
      }
      await delay(250);
    }
    if (skippedForTime.length > 0) {
      console.log(`⏱️ Time budget hit, sports carried to next run: ${skippedForTime.join(", ")}`);
    }

    // Player props: hard-capped inline walk. The dedicated sync crons own
    // props at scale; this pass only freshens events inside 48 hours, at
    // most 15 per sport, so 991 preseason NFL events can never eat the
    // run the way the uncapped loop did.
    console.log("🎯 Fetching capped player props...");
    const PROPS_WINDOW_MS = 48 * 3600 * 1000;
    const PROPS_MAX_EVENTS = 15;

    for (const sport of PROP_SPORTS) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break;
      const games = (coreGames[sport] || [])
        .filter(g => new Date(g.commence_time).getTime() - Date.now() < PROPS_WINDOW_MS)
        .slice(0, PROPS_MAX_EVENTS);
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
        await delay(250);
      }
    }

    const duration = Date.now() - startTime;

    console.log("✅ Refresh complete!");
    console.log(`📊 Processed ${totalGames} games, ${totalOddsInserted} rows, ${duration}ms`);

    return new Response(JSON.stringify({
      status: "success",
      totalGames,
      totalOddsInserted,
      skippedForTime,
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
