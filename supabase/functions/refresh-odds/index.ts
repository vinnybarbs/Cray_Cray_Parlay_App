// @ts-ignore - Deno imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore - Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// The big European competitions (owner 2026-10-13: "wire up all major
// soccer leagues"). Shadow sports like EPL and MLS. They refresh at the
// top of the hour only, on h2h and totals (soccer spreads never come back
// from the US books), so the six cost at most 2 credits each per hour on a
// 100K monthly plan. An hourly quote still clears the 90 minute closing
// line fence.
const EXTRA_SOCCER = [
  "soccer_uefa_champs_league",
  "soccer_uefa_europa_league",
  "soccer_spain_la_liga",
  "soccer_italy_serie_a",
  "soccer_germany_bundesliga",
  "soccer_france_ligue_one"
];
const SOCCER_MARKETS = "h2h,totals";
// Every soccer key, the six above plus EPL and MLS. All shadow, all
// priced on h2h and totals only (spreads come back empty and the bulk
// odds call bills per market requested).
const SOCCER_SPORTS = ["soccer_epl", "soccer_usa_mls", ...EXTRA_SOCCER];

// Credit budget (owner 2026-10-13: "we need to be at 20 mins on game day
// but ... too frequent a day or days before a game"). The audit that day
// found about 5,000 credits a day on a 100K month. A sport with a game
// starting inside GAME_DAY_AHEAD_MS (or one that started inside
// LIVE_BEHIND_MS) refreshes every run, every 20 minutes. Any other sport
// refreshes only on the run at the top of every SLOW_EVERY_HOURS hour.
// Soccer is shadow and never refreshes more than hourly. Hotness reads
// the commence times already in odds_cache, so it costs no API call, and
// a sport with nothing cached is cold (an off season key returns no
// events, which is free, on its slow run).
const GAME_DAY_AHEAD_MS = 18 * 3600 * 1000;
const LIVE_BEHIND_MS = 4 * 3600 * 1000;
const SLOW_EVERY_HOURS = 3;

const TEAM_SPORTS = [
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
  ...EXTRA_SOCCER
];
// Tennis tournament keys rotate weekly and only return data in season. A
// hand list went dark twice (2026-07-12 after Wimbledon, 2026-09-13 after
// the US Open, when Beijing and Tokyo were not on it). Since 2026-09-19
// the run DISCOVERS every active tennis_ key from the free sports list
// call and this list is only the fallback when that call fails.
const TENNIS_FALLBACK = [
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
  "tennis_atp_china_open",
  "tennis_atp_japan_open",
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

// College basketball props came out 2026-10-13 (owner: "College
// basketball shouldn't be calling player props"). Nothing reads them, and
// in season they alone would have cost about 4,300 credits a day.
const PROP_SPORTS = ["americanfootball_nfl", "americanfootball_nfl_preseason", "basketball_nba"];
// Per event props bill per market per event, so they are the expensive
// call. Owner 2026-10-13: "the day of the game player props should be
// pulled for movement every 20 mins". A game inside PROPS_LIVE_MS gets
// props every run (every 20 minutes). A game later that day (inside
// GAME_DAY_AHEAD_MS) gets them on the slow 3 hour runs. The NFL prop
// model reads player_props from sync-nfl-props, not these rows. These
// feed the on demand Player Props builder (api/suggest-picks.js).
const PROPS_LIVE_MS = 3 * 3600 * 1000;

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
  ]
};

// Expanded to 6 US-regulated books for cross-book line comparison (market_edge
// in the fact sheet). Up to 10 bookmakers bill as one region, so these six
// cost the same as one book. An 11th would double every call. If a book
// key is invalid, the API silently omits it (no error).
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
  const data = await response.json() as Array<{ key: string; active?: boolean }>;
  const keys = data.filter(s => s.active !== false).map(s => s.key);
  console.log(`✅ Available sports: ${keys.join(", ")}`);
  
  return keys;
}

// The team sports plus every tennis key the API lists as active today.
// Falls back to the hand list when the list call fails, so a bad minute
// on the free endpoint never blanks tennis.
async function resolveSports(oddsApiKey: string): Promise<{ sports: string[]; tennis: string[]; discovered: boolean }> {
  try {
    const active = await checkAvailableSports(oddsApiKey);
    const tennis = active.filter(k => k.startsWith("tennis_")).sort();
    return { sports: [...TEAM_SPORTS, ...tennis], tennis, discovered: true };
  } catch (e) {
    console.log("⚠️ Sports discovery failed, using the tennis fallback list:", (e as Error).message);
    return { sports: [...TEAM_SPORTS, ...TENNIS_FALLBACK], tennis: TENNIS_FALLBACK, discovered: false };
  }
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
    // Per sport witness for the cron_job_logs row (directive 14): games
    // fetched and rows written, so the ops check judges the feed by rows.
    const perSport: Record<string, { games: number; rows: number }> = {};
    // Directive 14 (ops check 2026-09-28 to 10-03): a core request that
    // comes back non 2xx, or a run that fetched no game for any sport,
    // is partial. The 97 hour quota outage of 2026-09-26 logged
    // completed on rows 0 the whole way through.
    const failedSports: string[] = [];
    const resolved = await resolveSports(oddsApiKey);
    console.log(`🎾 Tennis keys this run (${resolved.discovered ? "discovered" : "fallback"}): ${resolved.tennis.join(", ") || "none"}`);

    // The run at minute 0 to 19 of the hour is the hourly one, and the
    // hourly run every SLOW_EVERY_HOURS hours is the slow cadence run.
    const nowDate = new Date();
    const hourlyRun = nowDate.getUTCMinutes() < 20;
    const slowRun = hourlyRun && nowDate.getUTCHours() % SLOW_EVERY_HOURS === 0;
    const hourlySkipped: string[] = [];
    const cadenceSkipped: string[] = [];

    // Game day sports from the commence times already cached.
    const hotSports = new Set<string>();
    {
      const from = new Date(Date.now() - LIVE_BEHIND_MS).toISOString();
      const to = new Date(Date.now() + GAME_DAY_AHEAD_MS).toISOString();
      // One tiny lookup per sport: a single query capped by the API row
      // limit could miss a sport on a busy day and leave it on the slow
      // cadence through its own games.
      await Promise.all(resolved.sports.map(async (s) => {
        const { data: soon, error: soonErr } = await supabase
          .from("odds_cache")
          .select("external_game_id")
          .eq("sport", s)
          .gte("commence_time", from)
          .lte("commence_time", to)
          .limit(1);
        // Fail open: a failed lookup refreshes the sport rather than
        // starve the board.
        if (soonErr || (soon && soon.length > 0)) hotSports.add(s);
      }));
    }
    console.log(`🔥 Game day sports: ${[...hotSports].join(", ") || "none"} (hourly ${hourlyRun}, slow ${slowRun})`);

    for (const sport of resolved.sports) {
      const isSoccer = SOCCER_SPORTS.includes(sport);
      const hot = hotSports.has(sport);
      if (isSoccer && !hourlyRun) {
        hourlySkipped.push(sport);
        continue;
      }
      if (!hot && !slowRun) {
        cadenceSkipped.push(sport);
        continue;
      }
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        skippedForTime.push(sport);
        continue;
      }
      try {
        const params = new URLSearchParams({
          apiKey: oddsApiKey,
          regions: REGIONS,
          markets: isSoccer ? SOCCER_MARKETS : CORE_MARKETS,
          oddsFormat: ODDS_FORMAT,
          bookmakers: BOOKMAKERS
        });

        const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?${params.toString()}`;
        console.log(`📥 Fetching ${sport} core odds...`);

        const response = await fetchWithRetry(url);
        if (!response.ok) {
          console.log(`⚠️ Core odds request failed for ${sport}: ${response.status}`);
          failedSports.push(`${sport}:${response.status}`);
          continue;
        }
        await logRateLimit(response);

        const games = (await response.json() as any[])
          .filter(g => g?.commence_time && new Date(g.commence_time).getTime() < horizonMs);
        console.log(`✅ Fetched ${games.length} games for ${sport} inside ${HORIZON_DAYS}d horizon`);
        coreGames[sport] = games;
        perSport[sport] = { games: games.length, rows: 0 };

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
        // Player prop rows stay: they refresh on their own slower cadence
        // below, and this delete used to wipe them every 20 minutes.
        const { error: deleteError } = await supabase
          .from("odds_cache")
          .delete()
          .eq("sport", sport)
          .not("market_type", "like", "player_%");
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
          else { totalOddsInserted += chunk.length; perSport[sport].rows += chunk.length; }
        }
        totalGames += games.length;
      } catch (err) {
        console.error(`❌ Error refreshing ${sport}:`, err);
        failedSports.push(`${sport}:${(err as Error).message}`);
      }
      await delay(250);
    }
    if (skippedForTime.length > 0) {
      console.log(`⏱️ Time budget hit, sports carried to next run: ${skippedForTime.join(", ")}`);
    }

    // Player props: hard-capped inline walk. The dedicated sync crons own
    // props at scale; this pass only freshens game day events that have
    // not started (every run inside PROPS_LIVE_MS, slow runs out to
    // GAME_DAY_AHEAD_MS), at most 15 per sport. Prop rows for games that started over 6 hours ago are
    // cleared here, since the core swap no longer deletes them.
    const PROPS_MAX_EVENTS = 15;
    let propEvents = 0;
    {
      const { error: oldPropErr } = await supabase
        .from("odds_cache")
        .delete()
        .like("market_type", "player_%")
        .lt("commence_time", new Date(Date.now() - 6 * 3600 * 1000).toISOString());
      if (oldPropErr) console.log("⚠️ Old prop cleanup failed:", oldPropErr.message);
    }
    console.log("🎯 Fetching capped player props...");

    for (const sport of PROP_SPORTS) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break;
      const games = (coreGames[sport] || [])
        .filter(g => {
          const until = new Date(g.commence_time).getTime() - Date.now();
          return until > 0 && until < (slowRun ? GAME_DAY_AHEAD_MS : PROPS_LIVE_MS);
        })
        .slice(0, PROPS_MAX_EVENTS);
      propEvents += games.length;
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

    // Directive 14: a run that fetched games but wrote nothing is partial,
    // never completed. Cron status alone is not proof of ingestion.
    try {
      // A run that fetched no sport at all (nothing on game day between
      // slow runs) is a healthy skip, not a starved feed.
      const fetchedSports = Object.keys(perSport).length;
      const status = (totalGames > 0 && totalOddsInserted === 0)
        || (fetchedSports > 0 && totalGames === 0) || failedSports.length > 0
        ? "partial" : "completed";
      await supabase.from("cron_job_logs").insert({
        job_name: "refresh-odds-hourly",
        status,
        details: JSON.stringify({
          games: totalGames, rows: totalOddsInserted, per_sport: perSport, failed_sports: failedSports,
          tennis_keys: resolved.tennis, tennis_discovered: resolved.discovered,
          skipped_for_time: skippedForTime, hourly_skipped: hourlySkipped,
          cadence_skipped: cadenceSkipped, game_day_sports: [...hotSports], slow_run: slowRun,
          prop_events: propEvents, duration_ms: duration
        })
      });
    } catch (e) {
      console.log("⚠️ cron_job_logs insert failed:", (e as Error).message);
    }

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
