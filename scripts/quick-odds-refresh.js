#!/usr/bin/env node
/**
 * Quick odds refresh script that gets basic NFL & NBA odds data without timing out
 * This is a lightweight version that just gets core market data plus key player props
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;

// Sports and markets to refresh quickly
const SPORTS = ['americanfootball_nfl', 'basketball_nba'];
const CORE_MARKETS = 'h2h,spreads,totals';

const PROP_MARKETS = {
  americanfootball_nfl: [
    'player_pass_yds',
    'player_pass_tds',
    'player_rush_yds',
    'player_receptions',
    'player_reception_yds',
    'player_anytime_td',
    'team_totals'
  ],
  basketball_nba: [
    'player_points',
    'player_rebounds',
    'player_assists',
    'player_threes',
    'player_steals',
    'player_blocks'
  ]
};

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ODDS_API_KEY) {
  console.error('❌ Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or ODDS_API_KEY in environment');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function quickRefresh() {
  console.log('🚀 Starting quick odds refresh for NFL & NBA...');
  
  try {
    // 1) Fetch core markets for NFL & NBA
    const allSportGames = [];

    for (const sport of SPORTS) {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=${CORE_MARKETS}&oddsFormat=american&bookmakers=draftkings,fanduel`;

      console.log(`📥 Fetching ${sport} core odds...`);
      const response = await fetch(url);

      if (!response.ok) {
        console.log(`⚠️ Core odds request failed for ${sport}: ${response.status}`);
        continue;
      }

      const games = await response.json();
      console.log(`✅ Fetched ${games.length} games for ${sport}`);
      allSportGames.push({ sport, games });
    }

    // Clear old odds data only for NFL & NBA, then insert fresh data
    console.log('🗑️ Clearing old NFL & NBA odds data...');
    await supabase.from('odds_cache').delete().in('sport', SPORTS);

    console.log('💾 Inserting fresh core odds data...');
    for (const { sport, games } of allSportGames) {
      for (const game of games) {
        for (const bookmaker of game.bookmakers || []) {
          for (const market of bookmaker.markets || []) {
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

            await supabase.from('odds_cache').insert(record);
          }
        }
      }
    }

    // 2) Fetch and insert player props via per-event endpoint for NFL & NBA
    console.log('🎯 Fetching player props for NFL & NBA games...');

    for (const { sport, games } of allSportGames) {
      const propList = PROP_MARKETS[sport];
      if (!propList || propList.length === 0) continue;

      const propMarketsParam = encodeURIComponent(propList.join(','));

      for (const game of games) {
        try {
          const eventId = game.id;
          const propsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=${propMarketsParam}&oddsFormat=american&bookmakers=draftkings,fanduel`;

          const propsResponse = await fetch(propsUrl);

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

                const { error } = await supabase.from('odds_cache').insert(record);
                if (error) {
                  console.log('⚠️ Error inserting props odds:', error.message || error);
                }
              }
            }
          }
        } catch (e) {
          console.log(`⚠️ Error fetching props for ${sport} game ${game.id}: ${e.message}`);
        }

        // Small delay between prop requests to avoid hitting rate limits too fast
        await sleep(1500);
      }
    }

    const totalGames = allSportGames.reduce((sum, sg) => sum + sg.games.length, 0);

    console.log('✅ Quick refresh complete!');
    console.log(`📊 Processed ${totalGames} games across NFL & NBA`);
    
    // Show a sample with Mountain Time conversion
    console.log('\n🕐 Sample game times in Mountain Time:');
    const sampleGames = (allSportGames.flatMap(sg => sg.games)).slice(0, 3);
    for (const game of sampleGames) {
      const gameTime = new Date(game.commence_time);
      const mtTime = gameTime.toLocaleString('en-US', {
        timeZone: 'America/Denver',
        weekday: 'short',
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      console.log(`${game.away_team} @ ${game.home_team}: ${mtTime} MT`);
    }
    
  } catch (error) {
    console.error('❌ Quick refresh failed:', error.message);
    process.exit(1);
  }
}

quickRefresh();