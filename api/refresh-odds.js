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
    
    // Cache core markets for all supported sports
    const sports = [
      'americanfootball_nfl',
      'americanfootball_ncaaf',
      'basketball_nba',
      'icehockey_nhl',
      'soccer_epl'
    ];
    const regions = 'us';
    const oddsFormat = 'american';
    const bookmakers = 'draftkings,fanduel,betmgm,caesars'; // Only fetch bookmakers available in app
    
    // Core markets for all sports
    const coreMarkets = 'h2h,spreads,totals';
    
    // Player props markets (require per-event endpoint)
    const nflPlayerProps = [
      'player_pass_tds', 'player_pass_yds', 'player_pass_completions', 'player_pass_attempts',
      'player_pass_interceptions', 'player_rush_yds', 'player_rush_attempts',
      'player_receptions', 'player_reception_yds', 'player_anytime_td'
    ].join(',');
    
    const nflTeamProps = 'team_totals';
    
    // Track NFL/NCAAF game IDs for props fetch
    const nflGameIds = [];

    let totalGames = 0;
    let totalOdds = 0;

    for (const sport of sports) {
      try {
        // Check if sport is available
        if (!availableSportKeys.includes(sport)) {
          console.log(`⚠️ Skipping ${sport} - not available in API`);
          logger.warn(`Sport not available: ${sport}`);
          continue;
        }
        
        // Add delay between requests to avoid rate limiting
        if (sports.indexOf(sport) > 0) {
          await new Promise(resolve => setTimeout(resolve, 7000));
        }
        
        // Only fetch core markets (h2h, spreads, totals)
        // Player props require expensive per-event API calls
        const markets = coreMarkets;
        
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
        
        // Track NFL/NCAAF games for props fetch
        if (sport.includes('football')) {
          games.forEach(game => nflGameIds.push({ id: game.id, sport }));
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
    console.log(`\n🏈 Phase 2: Fetching player props for ${Math.min(nflGameIds.length, 20)} NFL/NCAAF games...`);
    const propsGames = nflGameIds.slice(0, 20); // Limit to 20 games = 20 API calls
    
    for (const gameInfo of propsGames) {
      try {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay
        
        const propsUrl = `https://api.the-odds-api.com/v4/sports/${gameInfo.sport}/events/${gameInfo.id}/odds/?apiKey=${oddsApiKey}&regions=${regions}&markets=${nflPlayerProps},${nflTeamProps}&oddsFormat=${oddsFormat}&bookmakers=${bookmakers}`;
        
        console.log(`   Fetching props for game ${gameInfo.id.substring(0, 8)}...`);
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

    logger.info('Odds cache refresh complete', { 
      totalGames, 
      totalOdds,
      nflPropsGames: propsGames.length,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      totalGames,
      totalOdds,
      timestamp: new Date().toISOString()
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
