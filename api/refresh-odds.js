const { supabase } = require('../lib/middleware/supabaseAuth.js');
const { logger } = require('../shared/logger');

/**
 * Refresh odds cache from The Odds API
 * POST /cron/refresh-odds
 * Protected by CRON_SECRET
 */
async function refreshOddsCache(req, res) {
  try {
    // Verify cron secret
    const cronSecret = req.headers.authorization?.replace('Bearer ', '');
    if (cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const oddsApiKey = process.env.ODDS_API_KEY;
    if (!oddsApiKey) {
      return res.status(500).json({ error: 'Odds API key not configured' });
    }

  logger.info('Starting odds cache refresh');
  const startTime = Date.now();

  // Use configured sports/bookmakers/limits
  const { SPORTS, CORE_MARKETS, PROP_MARKETS, TEAM_PROPS, RATE_LIMITS } = require('../config/sports-config');

    // First, verify which sports are available
    console.log('\n🔍 Checking available sports...');
    const sportsCheckUrl = `https://api.the-odds-api.com/v4/sports/?apiKey=${oddsApiKey}`;
    const sportsCheckResponse = await fetch(sportsCheckUrl);
    
    if (!sportsCheckResponse.ok) {
      logger.error('Failed to fetch available sports', { status: sportsCheckResponse.status });
      return res.status(500).json({ error: 'Failed to check available sports' });
    }
    
    const availableSports = await sportsCheckResponse.json();
    const availableSportKeys = availableSports.map(s => s.key);
    console.log(`✅ Available sports: ${availableSportKeys.filter(k => k.includes('football') || k.includes('basketball') || k.includes('hockey') || k.includes('soccer')).join(', ')}`);
    
    // Cache core markets for all configured sports (we'll filter by availability)
    const sports = SPORTS || [];
    const regions = 'us';
    const oddsFormat = 'american';
  // Only fetch bookmakers available in app. Controlled by env BOOKMAKERS or default to DraftKings and FanDuel only.
  const bookmakers = process.env.BOOKMAKERS || 'draftkings,fanduel';
    
    // Core markets for all sports
    const coreMarkets = 'h2h,spreads,totals';
    
    // Track per-sport game IDs for props fetch (only for sports that need props)
    const propsGameIds = [];

    let totalGames = 0;
    let totalOdds = 0;

    // Filter to only the sports available from the Odds API
    const sportsToFetch = sports.filter(s => availableSportKeys.includes(s));

    for (const sport of sportsToFetch) {
      try {
        // Add delay between requests to avoid rate limiting
        if (sportsToFetch.indexOf(sport) > 0) {
          await new Promise(resolve => setTimeout(resolve, RATE_LIMITS.betweenSports || 7000));
        }
        
  // Only fetch core markets (h2h, spreads, totals)
  // Player props require expensive per-event API calls (only fetched for NFL/NBA)
  const markets = CORE_MARKETS || coreMarkets;
        
        const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${oddsApiKey}&regions=${regions}&markets=${markets}&oddsFormat=${oddsFormat}&bookmakers=${bookmakers}`;
        
        console.log(`\n🔍 Fetching ${sport}...`);
        console.log(`📊 Markets: ${markets}`);
        console.log(`📚 Bookmakers: ${bookmakers}`);
        logger.info(`Fetching ${sport}...`);
        const response = await fetch(url);
        
  // Log remaining API calls
  const remaining = response.headers.get('x-requests-remaining');
  const used = response.headers.get('x-requests-used');
  if (remaining) console.log(`📊 API calls remaining: ${remaining} (used: ${used})`);
        
        // DEBUG: Print raw response body for NCAAF
        if (sport === 'americanfootball_ncaaf') {
          const rawText = await response.clone().text();
          console.log('🟠 NCAAF RAW RESPONSE:', rawText.substring(0, 500));
        }
        
        if (!response.ok) {
          const errorText = await response.text();
          console.log(`❌ Failed to fetch ${sport}: ${response.status}`);
          console.log(`Error details: ${errorText}`);
          logger.error(`Failed to fetch odds for ${sport}`, { status: response.status, error: errorText });
          continue;
        }

        const games = await response.json();
        console.log(`✅ Fetched ${games.length} games for ${sport} (core markets)`);
        
        // Debug: Show sample game and bookmakers
        if (games.length > 0) {
          const sampleGame = games[0];
          const sampleBookmakers = sampleGame.bookmakers?.map(b => b.key).join(', ') || 'none';
          console.log(`   Sample game: ${sampleGame.away_team} @ ${sampleGame.home_team}`);
          console.log(`   Bookmakers in response: ${sampleBookmakers}`);
        }
        
  logger.info(`✅ Fetched ${games.length} games for ${sport} (core markets)`);
        
        // Track games for props fetch only for sports that need per-event props (NFL, NBA)
        if (sport === 'americanfootball_nfl' || sport === 'basketball_nba') {
          games.forEach(game => propsGameIds.push({ id: game.id, sport }));
        }

        for (const game of games) {
          totalGames++;

          // Store each bookmaker's odds
          for (const bookmaker of game.bookmakers || []) {
            for (const market of bookmaker.markets || []) {
              const oddsData = {
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

              // Upsert odds (update if exists, insert if not)
              const { error } = await supabase
                .from('odds_cache')
                .upsert(oddsData, {
                  onConflict: 'external_game_id,bookmaker,market_type',
                  ignoreDuplicates: false
                });

              if (error) {
                logger.error('Error upserting odds', { error: error.message, game_id: game.id });
              } else {
                totalOdds++;
              }
            }
          }
        }
      } catch (err) {
        logger.error(`Error processing sport ${sport}`, { error: err.message });
      }
    }

    // PHASE 2: Fetch player props for NFL/NCAAF games (limit to 20 games to control API usage)
  console.log(`\n🏈 Phase 2: Fetching player/team/TD props for up to ${Math.min(propsGameIds.length, RATE_LIMITS.maxPropsGames || 20)} games (NFL/NBA)...`);
  const propsGames = propsGameIds.slice(0, RATE_LIMITS.maxPropsGames || 20); // Limit to configured max games
    
    for (const gameInfo of propsGames) {
      try {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMITS.betweenProps || 2000)); // per-prop delay

        // Build markets list for this sport: combine configured player props and team props
        const sportPropMarkets = (PROP_MARKETS[gameInfo.sport] || []).join(',');
        const teamProps = TEAM_PROPS || 'team_totals';
        const marketsList = [sportPropMarkets, teamProps].filter(Boolean).join(',');

        const propsUrl = `https://api.the-odds-api.com/v4/sports/${gameInfo.sport}/events/${gameInfo.id}/odds/?apiKey=${oddsApiKey}&regions=${regions}&markets=${encodeURIComponent(marketsList)}&oddsFormat=${oddsFormat}&bookmakers=${bookmakers}`;

        console.log(`   Fetching props for game ${gameInfo.id.substring(0, 8)} (${gameInfo.sport})...`);
        const propsResponse = await fetch(propsUrl);
        
        if (!propsResponse.ok) {
          const errorText = await propsResponse.text();
          console.log(`   ⚠️ Failed: ${propsResponse.status} - ${errorText}`);
          continue;
        }
        
        const propsData = await propsResponse.json();
        
        // Store props in cache
        for (const bookmaker of propsData.bookmakers || []) {
          for (const market of bookmaker.markets || []) {
            const oddsData = {
              sport: gameInfo.sport,
              external_game_id: propsData.id,
              commence_time: propsData.commence_time,
              home_team: propsData.home_team,
              away_team: propsData.away_team,
              bookmaker: bookmaker.key,
              market_type: market.key,
              outcomes: market.outcomes,
              last_update: bookmaker.last_update,
              last_updated: new Date().toISOString()
            };

            const { error: upsertError } = await supabase
              .from('odds_cache')
              .upsert(oddsData, {
                onConflict: 'external_game_id,bookmaker,market_type'
              });

            if (!upsertError) {
              totalOdds++;
            }
          }
        }
      } catch (error) {
        console.log(`⚠️ Failed to fetch props for game ${gameInfo.id}`);
      }
    }
    
    console.log(`✅ Phase 2 complete: Added player/team props`);

    // Clean up old odds (older than 24 hours)
    const { error: deleteError } = await supabase
      .from('odds_cache')
      .delete()
      .lt('last_updated', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (deleteError) {
      logger.error('Error cleaning up old odds', { error: deleteError.message });
    }

    const endTime = Date.now();
    const durationMs = endTime - startTime;

    // Log completion and metrics
    const runSummary = {
      totalGames,
      totalOdds,
      nflPropsGames: propsGames.length,
      durationMs,
      bookmakers,
      timestamp: new Date().toISOString()
    };

    logger.info('Odds cache refresh complete', runSummary);

    // Try to record a lightweight run summary to Supabase (if table exists)
    try {
      if (supabase) {
        await supabase.from('cron_runs').insert({
          run_at: runSummary.timestamp,
          total_games: runSummary.totalGames,
          total_odds: runSummary.totalOdds,
          nfl_props_games: runSummary.nflPropsGames,
          duration_ms: runSummary.durationMs,
          bookmakers: runSummary.bookmakers
        });
        logger.info('Recorded cron run to Supabase: cron_runs');
      }
    } catch (err) {
      logger.warn('Could not record cron run to Supabase (table may not exist)', { error: err.message });
    }

    res.json({
      success: true,
      totalGames,
      totalOdds,
      timestamp: new Date().toISOString(),
      durationMs
    });

  } catch (error) {
    logger.error('Error refreshing odds cache', { error: error.message });
    res.status(500).json({ 
      error: 'Failed to refresh odds cache',
      message: error.message 
    });
  }
}

module.exports = refreshOddsCache;
