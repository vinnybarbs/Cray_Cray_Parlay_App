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

// ─── US Eastern game-day helpers ───
// Ported inline from lib/services/sport-day.js (edge functions can't require
// Node modules). ESPN's `dates=` param buckets by US Eastern, and a US
// evening game (8pm ET or later) already carries the NEXT day's UTC date, so
// toISOString() bucketing misattributes late games.
const EASTERN_TZ = 'America/New_York';

// en-CA gives YYYY-MM-DD directly; Intl handles EST/EDT transitions.
const easternDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: EASTERN_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** Eastern game-day as YYYY-MM-DD. */
function sportDayISO(date: Date = new Date()): string {
  return easternDateFmt.format(date);
}

/** Eastern game-day as YYYYMMDD (ESPN `dates=` param format). */
function sportDayCompact(date: Date = new Date()): string {
  return sportDayISO(date).replace(/-/g, '');
}

/** The instant n*24h before `from`. */
function daysAgo(n: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - n * 24 * 60 * 60 * 1000);
}

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
  // "Yesterday" as an Eastern game-day, matching ESPN's date buckets.
  const dateStr = sportDayCompact(daysAgo(1));
  
  const sports = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAB', 'MLS', 'UFC'];
  const baseUrl = 'http://site.api.espn.com/apis/site/v2/sports';

  const sportPaths: Record<string, string> = {
    NFL: 'football/nfl',
    NBA: 'basketball/nba',
    MLB: 'baseball/mlb',
    NHL: 'hockey/nhl',
    NCAAB: 'basketball/mens-college-basketball',
    MLS: 'soccer/usa.1',
    UFC: 'mma/ufc'
  };
  
  let totalGames = 0;
  
  for (const sport of sports) {
    try {
      const groups = sport === 'NCAAB' ? '&groups=50' : '';
      const url = `${baseUrl}/${sportPaths[sport]}/scoreboard?dates=${dateStr}${groups}`;
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
        // Eastern game-day: an 8pm ET start already has tomorrow's UTC date.
        date: sportDayISO(new Date(event.date)),
        home_team_name: homeTeam.team.displayName,
        away_team_name: awayTeam.team.displayName,
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
  // suggestion.game_date is usually a date-only string that IS already the
  // game-day bucket — new Date() would read it as midnight UTC (the prior US
  // evening), so a timezone conversion would shift it back a day. Use
  // date-only strings verbatim; only genuine timestamps get converted to the
  // Eastern game-day.
  const raw = suggestion.game_date;
  const gameDate = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? raw
    : sportDayISO(new Date(raw));

  // Check game date ±1 day to handle timezone edge cases (pure calendar
  // math anchored at UTC noon, immune to the runtime's local timezone).
  const gd = new Date(`${gameDate}T12:00:00Z`);
  const dates = [-1, 0, 1].map(off =>
    new Date(gd.getTime() + off * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );

  const { data: games, error } = await supabase
    .from('game_results')
    .select('*')
    .eq('sport', suggestion.sport)
    .in('date', dates)
    .eq('status', 'final');

  if (error || !games || games.length === 0) {
    return false;
  }

  const match = games.find((g: any) =>
    teamsMatch(g.home_team_name, suggestion.home_team) &&
    teamsMatch(g.away_team_name, suggestion.away_team)
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
      const winner = home_score > away_score ? game.home_team_name : game.away_team_name;
      return suggestion.pick.toLowerCase().includes(winner.toLowerCase()) ? 'won' : 'lost';

    case 'Spread':
      const line = parseFloat(suggestion.point) || 0;
      const pickedHome = suggestion.pick.toLowerCase().includes(game.home_team_name.toLowerCase());
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
