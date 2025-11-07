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

    // Cache core markets for all supported sports
    const sports = [
      'americanfootball_nfl',
      'americanfootball_ncaaf',
      'basketball_nba',
      'baseball_mlb',
      'icehockey_nhl',
      'soccer_epl',
      'golf_pga',
      'tennis_atp',
      'mma_ufc'
    ];
    const regions = 'us';
    const oddsFormat = 'american';
    
    // Core markets for all sports
    const coreMarkets = 'h2h,spreads,totals';
    
    // Player prop markets (NFL/NCAAF only to avoid rate limits)
    const playerPropMarkets = 'player_pass_tds,player_pass_yds,player_rush_yds,player_receptions,player_reception_yds,player_anytime_td';

    let totalGames = 0;
    let totalOdds = 0;

    for (const sport of sports) {
      try {
        // Add delay to avoid rate limiting (max 10 requests/min)
        if (totalGames > 0) {
          await new Promise(resolve => setTimeout(resolve, 7000)); // 7 second delay between sports
        }
        
        // Determine which markets to fetch based on sport
        const isFootball = sport.includes('football');
        const markets = isFootball ? `${coreMarkets},${playerPropMarkets}` : coreMarkets;
        
        const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${oddsApiKey}&regions=${regions}&markets=${markets}&oddsFormat=${oddsFormat}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
          logger.error(`Failed to fetch odds for ${sport}`, { status: response.status });
          continue;
        }

        const games = await response.json();
        logger.info(`Fetched ${games.length} games for ${sport} (${isFootball ? 'with props' : 'core only'})`);

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

module.exports = { refreshOddsCache };
