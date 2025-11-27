/**
 * Check Outcomes Edge Function
 * Runs daily to:
 * 1. Fetch yesterday's game results from ESPN
 * 2. Check user parlays and update outcomes
 * 3. Check AI suggestions and update model performance
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req: Request) => {
  console.log('🔍 Check Outcomes Edge Function triggered');
  
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Return 202 Accepted immediately (async processing pattern)
    const response = new Response(
      JSON.stringify({ 
        status: 'accepted',
        message: 'Outcome checking started in background',
        timestamp: new Date().toISOString()
      }),
      { 
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    // Process in background
    processOutcomes(supabase).catch(err => {
      console.error('[check-outcomes] Background job failed:', err);
    });
    
    return response;
    
  } catch (error) {
    console.error('❌ Check outcomes error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

async function processOutcomes(supabase: any) {
  console.log('[check-outcomes] Background processing started');
  const startTime = Date.now();
  
  try {
    // Step 1: Fetch yesterday's games from ESPN
    console.log('📊 Step 1: Fetching game results from ESPN...');
    const gamesFetched = await fetchYesterdaysGames(supabase);
    console.log(`✅ Fetched and cached ${gamesFetched} games`);
    
    // Step 2: Check user parlays
    console.log('🎰 Step 2: Checking user parlays...');
    const parlayResults = await checkUserParlays(supabase);
    console.log(`✅ Checked ${parlayResults.checked} parlays, updated ${parlayResults.resolved}`);
    
    // Step 3: Check AI suggestions
    console.log('🤖 Step 3: Checking AI suggestions...');
    const suggestionResults = await checkAISuggestions(supabase);
    console.log(`✅ Checked ${suggestionResults.checked} suggestions, resolved ${suggestionResults.resolved}`);
    
    // Step 4: Log results to cron_job_logs
    const duration = Date.now() - startTime;
    await logResults(supabase, {
      games_fetched: gamesFetched,
      parlays_checked: parlayResults.checked,
      parlays_resolved: parlayResults.resolved,
      suggestions_checked: suggestionResults.checked,
      suggestions_resolved: suggestionResults.resolved,
      duration_ms: duration
    });
    
    console.log(`✅ Check outcomes complete in ${duration}ms`);
    
  } catch (error) {
    console.error('❌ Background processing error:', error);
    await logResults(supabase, { error: error.message }, 'failed');
  }
}

/**
 * Fetch yesterday's games from ESPN Scoreboard API
 */
async function fetchYesterdaysGames(supabase: any): Promise<number> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = formatDate(yesterday);
  
  const sports = ['NFL', 'NBA', 'MLB', 'NHL'];
  const baseUrl = 'http://site.api.espn.com/apis/site/v2/sports';
  
  const sportPaths: Record<string, string> = {
    NFL: 'football/nfl',
    NBA: 'basketball/nba',
    MLB: 'baseball/mlb',
    NHL: 'hockey/nhl'
  };
  
  let totalGames = 0;
  
  for (const sport of sports) {
    try {
      const url = `${baseUrl}/${sportPaths[sport]}/scoreboard?dates=${dateStr}`;
      console.log(`  Fetching ${sport} scoreboard...`);
      
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`  ⚠️ ${sport} scoreboard returned ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      const games = parseGames(data, sport);
      
      if (games.length > 0) {
        const cached = await cacheGames(supabase, games);
        totalGames += cached;
        console.log(`  ✅ ${sport}: cached ${cached} games`);
      }
      
      // Rate limiting
      await sleep(500);
      
    } catch (error) {
      console.error(`  ❌ Error fetching ${sport}:`, error.message);
    }
  }
  
  return totalGames;
}

/**
 * Parse ESPN API games
 */
function parseGames(data: any, sport: string): any[] {
  const games = [];
  
  for (const event of data.events || []) {
    try {
      const competition = event.competitions[0];
      const homeTeam = competition.competitors.find((c: any) => c.homeAway === 'home');
      const awayTeam = competition.competitors.find((c: any) => c.homeAway === 'away');
      
      if (!homeTeam || !awayTeam) continue;
      
      games.push({
        espn_event_id: event.id,
        sport,
        game_date: new Date(event.date).toISOString().split('T')[0],
        home_team: homeTeam.team.displayName,
        away_team: awayTeam.team.displayName,
        home_score: parseInt(homeTeam.score) || null,
        away_score: parseInt(awayTeam.score) || null,
        status: normalizeStatus(event.status?.type?.name),
        metadata: { event_name: event.name }
      });
    } catch (error) {
      console.warn(`  ⚠️ Error parsing event ${event.id}:`, error.message);
    }
  }
  
  return games;
}

/**
 * Cache games to database
 */
async function cacheGames(supabase: any, games: any[]): Promise<number> {
  let cachedCount = 0;
  
  for (const game of games) {
    try {
      const { error } = await supabase
        .from('game_results')
        .upsert(game, { onConflict: 'espn_event_id' });
      
      if (!error) cachedCount++;
    } catch (error) {
      console.warn(`  ⚠️ Error caching game:`, error.message);
    }
  }
  
  return cachedCount;
}

/**
 * Check user parlays (placeholder - will integrate with existing service)
 */
async function checkUserParlays(supabase: any) {
  // TODO: Import and use existing ParlayOutcomeChecker
  console.log('  User parlay checking will be integrated with existing service');
  return { checked: 0, resolved: 0 };
}

/**
 * Check AI suggestions
 */
async function checkAISuggestions(supabase: any) {
  const { data: suggestions, error } = await supabase
    .from('ai_suggestions')
    .select('*')
    .eq('actual_outcome', 'pending')
    .lte('game_date', new Date().toISOString());
  
  if (error || !suggestions) {
    console.warn('  ⚠️ Error fetching suggestions:', error?.message);
    return { checked: 0, resolved: 0 };
  }
  
  let resolvedCount = 0;
  
  for (const suggestion of suggestions) {
    try {
      const resolved = await checkSuggestion(supabase, suggestion);
      if (resolved) resolvedCount++;
    } catch (error) {
      console.warn(`  ⚠️ Error checking suggestion ${suggestion.id}:`, error.message);
    }
  }
  
  return { checked: suggestions.length, resolved: resolvedCount };
}

/**
 * Check a single suggestion
 */
async function checkSuggestion(supabase: any, suggestion: any): Promise<boolean> {
  const gameDate = new Date(suggestion.game_date).toISOString().split('T')[0];
  
  const { data: games, error } = await supabase
    .from('game_results')
    .select('*')
    .eq('sport', suggestion.sport)
    .eq('game_date', gameDate)
    .eq('status', 'final');
  
  if (error || !games || games.length === 0) {
    return false;
  }
  
  const match = games.find((g: any) =>
    teamsMatch(g.home_team, suggestion.home_team) &&
    teamsMatch(g.away_team, suggestion.away_team)
  );
  
  if (!match) return false;
  
  const outcome = determineOutcome(suggestion, match);
  
  await supabase
    .from('ai_suggestions')
    .update({
      actual_outcome: outcome,
      resolved_at: new Date().toISOString()
    })
    .eq('id', suggestion.id);
  
  return true;
}

/**
 * Helper functions
 */
function teamsMatch(team1: string, team2: string): boolean {
  const normalize = (s: string) => s.toLowerCase().trim();
  const t1 = normalize(team1);
  const t2 = normalize(team2);
  return t1 === t2 || t1.includes(t2) || t2.includes(t1);
}

function determineOutcome(suggestion: any, game: any): string {
  const { home_score, away_score } = game;
  
  if (home_score === null || away_score === null) return 'pending';
  
  switch (suggestion.bet_type) {
    case 'Moneyline':
      const winner = home_score > away_score ? game.home_team : game.away_team;
      return suggestion.pick.toLowerCase().includes(winner.toLowerCase()) ? 'won' : 'lost';
    
    case 'Spread':
      const line = parseFloat(suggestion.point) || 0;
      const pickedHome = suggestion.pick.toLowerCase().includes(game.home_team.toLowerCase());
      const adjustedHomeScore = pickedHome ? home_score + line : home_score - line;
      if (adjustedHomeScore === away_score) return 'push';
      return adjustedHomeScore > away_score ? 'won' : 'lost';
    
    case 'Totals':
    case 'Total':
      const total = home_score + away_score;
      const targetTotal = parseFloat(suggestion.point) || 0;
      if (total === targetTotal) return 'push';
      const isOver = suggestion.pick.toLowerCase().includes('over');
      return isOver ? (total > targetTotal ? 'won' : 'lost') : (total < targetTotal ? 'won' : 'lost');
    
    default:
      return 'pending';
  }
}

function normalizeStatus(status: string): string {
  if (!status) return 'unknown';
  const s = status.toLowerCase();
  if (s.includes('final') || s.includes('end')) return 'final';
  if (s.includes('scheduled')) return 'scheduled';
  if (s.includes('progress')) return 'in_progress';
  return s;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function logResults(supabase: any, details: any, status = 'success') {
  try {
    await supabase.from('cron_job_logs').insert({
      job_name: 'check-outcomes',
      status,
      details: JSON.stringify(details)
    });
  } catch (error) {
    console.warn('Failed to log results:', error.message);
  }
}
