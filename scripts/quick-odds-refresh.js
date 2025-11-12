#!/usr/bin/env node
/**
 * Quick odds refresh script that gets basic NFL odds data without timing out
 * This is a lightweight version that just gets core market data
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const SUPABASE_URL = 'https://pcjhulzyqmhrhsrgvwvx.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMDYxNzE2MCwiZXhwIjoyMDQ2MTkzMTYwfQ.ZEyVz8DYwNVRpqU7cvjPapFzsIM3k-ScZHPvVT4y5gs';
const ODDS_API_KEY = '85946a80b612917ca4bf785f44e0a749';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function quickRefresh() {
  console.log('🚀 Starting quick odds refresh...');
  
  try {
    // Get NFL odds data
    const url = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel`;
    
    console.log('📥 Fetching NFL odds...');
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    
    const games = await response.json();
    console.log(`✅ Fetched ${games.length} NFL games`);
    
    // Clear old odds data and insert new data
    console.log('🗑️ Clearing old odds data...');
    await supabase.from('odds_cache').delete().gte('id', 1);
    
    console.log('💾 Inserting fresh odds data...');
    for (const game of games) {
      for (const bookmaker of game.bookmakers) {
        for (const market of bookmaker.markets) {
          const record = {
            sport: 'americanfootball_nfl',
            game_id: `${game.home_team}_vs_${game.away_team}_${game.commence_time}`.replace(/[^a-zA-Z0-9_]/g, '_'),
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
    
    console.log('✅ Quick refresh complete!');
    console.log(`📊 Processed ${games.length} games`);
    
    // Show a sample with Mountain Time conversion
    console.log('\n🕐 Sample game times in Mountain Time:');
    const sampleGames = games.slice(0, 3);
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