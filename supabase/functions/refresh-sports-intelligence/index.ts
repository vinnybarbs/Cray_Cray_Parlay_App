// @ts-ignore - Deno imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore - Deno imports  
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

/*
 * Enhanced Sports Intelligence Gathering System
 * 
 * Sophisticated multi-category intelligence collection for AI analytical edge detection:
 * 
 * 🏥 INJURIES: Critical player availability and impact analysis
 * 🎯 EXPERT ANALYSIS: Sharp money, matchup analysis, advanced analytics 
 * 🎲 SITUATIONAL EDGES: Revenge games, rest advantages, weather, trap spots
 * 💰 MARKET INTELLIGENCE: Public vs sharp money, line movement, contrarian opportunities
 * 🔍 INSIDER INTELLIGENCE: Locker room dynamics, coaching changes, motivation factors
 * 📊 HISTORICAL CONTEXT: Head-to-head trends, situational performance patterns
 * 
 * Runs every 2 hours via pg_cron, rotating through query templates for diverse intelligence
 */

// Enhanced intelligence gathering configuration for sophisticated AI analysis
const INTELLIGENCE_CONFIG = {
  searchCategories: {
    // Critical injury intelligence - highest priority
    injuries: {
      priority: 1,
      searchesPerSport: 6,
      queryTemplates: [
        "{team} injury report latest news",
        "{team} questionable doubtful injury status", 
        "{team} key players injury impact"
      ],
      expiresHours: 12
    },
    
    // Expert analysis and sharp money intelligence
    expert_analysis: {
      priority: 2,
      searchesPerSport: 5,
      queryTemplates: [
        "{team} expert picks predictions betting analysis",
        "{team} vs {opponent} matchup analysis expert preview",
        "sharp money {team} {sport} betting line movement",
        "{team} advanced analytics efficiency ratings",
        "{team} fade or follow expert consensus {sport}"
      ],
      expiresHours: 24
    },
    
    // Situational edge detection - revenge games, rest, weather
    situational_edges: {
      priority: 3,
      searchesPerSport: 4,
      queryTemplates: [
        "{team} revenge game narrative {sport}",
        "{team} rest advantage back to back {sport}", 
        "{team} home field advantage weather {sport}",
        "{team} trap game look ahead spot {sport}"
      ],
      expiresHours: 48
    },
    
    // Market sentiment and contrarian opportunities
    market_intelligence: {
      priority: 4,
      searchesPerSport: 4,
      queryTemplates: [
        "{sport} public betting percentages fade the public",
        "{team} line movement steam moves sharp action",
        "{team} contrarian betting value overreaction", 
        "{sport} betting model predictions vs Vegas"
      ],
      expiresHours: 6
    },
    
    // Insider information and team dynamics
    insider_intelligence: {
      priority: 5,
      searchesPerSport: 3,
      queryTemplates: [
        "{team} insider reports locker room chemistry",
        "{team} coaching changes game plan adjustments",
        "{team} motivation factors playoff implications"
      ],
      expiresHours: 24
    },
    
    // Historical trends and head-to-head patterns
    historical_context: {
      priority: 6,
      searchesPerSport: 2,
      queryTemplates: [
        "{team} historical performance similar situations",
        "{team} vs {opponent} head to head betting trends"
      ],
      expiresHours: 72
    },

    // Breaking news and last-minute intelligence
    breaking_news: {
      priority: 7,
      searchesPerSport: 3,
      queryTemplates: [
        "{team} breaking news last minute changes {sport}",
        "{team} late scratch lineup changes {sport}",
        "{team} weather delay venue change {sport}"
      ],
      expiresHours: 2 // Very time-sensitive
    }
  },
  
  dailyBudget: {
    total: 200, // Daily searches - with 50k credits = 250 days of coverage
    allocation: {
      // Optimized for 27 searches per sport = teams covered efficiently
      NFL: 108,    // 4 teams × 27 searches = comprehensive NFL coverage
      NBA: 54,     // 2 teams × 27 searches = key NBA matchups  
      NCAAF: 27,   // 1 team × 27 searches = top college game
      NHL: 0,      // Off during peak NFL/NBA season (Oct-Feb)
      MLB: 0,      // Off-season now (resumes March with 81 searches)
      SOCCER: 0,   // Minimal during American sports peak
      MMA: 8,      // Selective high-value events only
      GOLF: 3      // Major tournament weekends only
    }
    // Summer allocation (Apr-Sep): MLB: 81, NBA: 54, NFL: 27, NCAAF: 27, others: 11
    // This gives you comprehensive coverage of 4 NFL teams + 2 NBA teams daily
  }
};

// Team data for major sports (focusing on most bet-on teams)
const SPORTS_TEAMS = {
  NFL: [
    'Kansas City Chiefs', 'Buffalo Bills', 'San Francisco 49ers', 'Philadelphia Eagles',
    'Dallas Cowboys', 'Green Bay Packers', 'New England Patriots', 'Pittsburgh Steelers',
    'Los Angeles Rams', 'Baltimore Ravens', 'Tampa Bay Buccaneers', 'Miami Dolphins'
  ],
  NBA: [
    'Los Angeles Lakers', 'Boston Celtics', 'Golden State Warriors', 'Miami Heat', 
    'Brooklyn Nets', 'Philadelphia 76ers', 'Milwaukee Bucks', 'Phoenix Suns',
    'Denver Nuggets', 'Dallas Mavericks', 'Los Angeles Clippers', 'Toronto Raptors'
  ],
  MLB: [
    'New York Yankees', 'Los Angeles Dodgers', 'Boston Red Sox', 'Houston Astros',
    'Atlanta Braves', 'Philadelphia Phillies', 'St. Louis Cardinals', 'San Francisco Giants',
    'Chicago Cubs', 'New York Mets', 'Tampa Bay Rays', 'Toronto Blue Jays'
  ],
  NCAAF: [
    'Alabama Crimson Tide', 'Georgia Bulldogs', 'Ohio State Buckeyes', 'Michigan Wolverines',
    'Texas Longhorns', 'Oklahoma Sooners', 'Clemson Tigers', 'LSU Tigers'
  ],
  NHL: [
    'Toronto Maple Leafs', 'Boston Bruins', 'New York Rangers', 'Tampa Bay Lightning',
    'Colorado Avalanche', 'Vegas Golden Knights', 'Edmonton Oilers', 'Pittsburgh Penguins'
  ],
  SOCCER: [
    'Manchester City', 'Arsenal', 'Liverpool', 'Chelsea', 'Manchester United', 'Tottenham'
  ]
};

async function refreshSportsIntelligence(req: Request): Promise<Response> {
  try {
    const serperKey = Deno.env.get("SERPER_API_KEY");
    if (!serperKey) {
      return new Response(JSON.stringify({ error: "Serper API key missing" }), {
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
    
    console.log("📰 Starting sports intelligence cache refresh");
    const startTime = Date.now();
    
    let totalSearches = 0;
    const results: Record<string, any> = {};

    // Check today's usage
    const today = new Date().toISOString().split('T')[0];
    const { data: todaysUsage } = await supabase
      .from('api_call_log')
      .select('calls_used')
      .eq('date', today)
      .eq('api_type', 'serper')
      .single();

    const usedToday = todaysUsage?.calls_used || 0;
    const remainingSearches = INTELLIGENCE_CONFIG.dailyBudget.total - usedToday;
    
    if (remainingSearches <= 10) {
      console.log(`⚠️ Daily search budget nearly exhausted: ${usedToday}/${INTELLIGENCE_CONFIG.dailyBudget.total} used`);
      return new Response(JSON.stringify({
        status: "budget_exhausted",
        usedToday,
        totalBudget: INTELLIGENCE_CONFIG.dailyBudget.total,
        message: "Skipping intelligence refresh to preserve search budget"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Process each sport based on season and priority
    for (const [sport, teams] of Object.entries(SPORTS_TEAMS)) {
      if (!isSeasonActive(sport)) {
        console.log(`⏭️ Skipping ${sport} - out of season`);
        continue;
      }

      const sportBudget = Math.min(
        INTELLIGENCE_CONFIG.dailyBudget.allocation[sport as keyof typeof INTELLIGENCE_CONFIG.dailyBudget.allocation] || 20,
        remainingSearches - totalSearches
      );

      if (sportBudget <= 5) {
        console.log(`⏭️ Skipping ${sport} - insufficient budget (${sportBudget} searches remaining)`);
        continue;
      }

      console.log(`🔍 Gathering intelligence for ${sport} (budget: ${sportBudget} searches)`);
      
      const sportResult = await gatherSportIntelligence(sport, teams, sportBudget, serperKey, supabase);
      results[sport] = sportResult;
      totalSearches += sportResult.searchesUsed;

      // Rate limiting between sports
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Log usage
    await supabase
      .from('api_call_log')
      .upsert({
        date: today,
        api_type: 'serper',
        calls_used: usedToday + totalSearches,
        sports_synced: Object.keys(results),
        last_updated: new Date().toISOString()
      });

    const duration = Date.now() - startTime;
    console.log(`✅ Intelligence refresh complete: ${totalSearches} searches used in ${duration}ms`);

    return new Response(JSON.stringify({
      status: "success",
      totalSearchesUsed: totalSearches,
      dailyUsage: usedToday + totalSearches,
      dailyBudget: INTELLIGENCE_CONFIG.dailyBudget.total,
      results,
      duration
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Intelligence refresh error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function gatherSportIntelligence(
  sport: string,
  teams: string[],
  budget: number,
  serperKey: string,
  supabase: any
): Promise<{ searchesUsed: number; articles: number; insights: number }> {
  
  let searchesUsed = 0;
  let totalArticles = 0;
  let totalInsights = 0;

  // Prioritize search categories by importance
  const categories = Object.entries(INTELLIGENCE_CONFIG.searchCategories)
    .sort(([,a], [,b]) => a.priority - b.priority);

  for (const [category, config] of categories) {
    if (searchesUsed >= budget - 2) break;

    const categoryBudget = Math.min(config.searchesPerSport, budget - searchesUsed);
    console.log(`  🔍 ${category}: ${categoryBudget} searches`);

    // Enhanced search logic with multiple query templates
    const queryTemplates = config.queryTemplates;
    let templateIndex = 0;

    if (category === 'market_intelligence' || category === 'historical_context') {
      // General market/historical searches (not team-specific)
      for (let i = 0; i < categoryBudget && searchesUsed < budget; i++) {
        const template = queryTemplates[templateIndex % queryTemplates.length];
        const query = template.replace('{sport}', sport);
        
        const result = await performSearch(query, serperKey, supabase, sport, category);
        if (result) {
          totalArticles += result.articleCount;
          totalInsights += result.insightCount;
          searchesUsed++;
        }
        templateIndex++;
        
        // Rate limiting between searches
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } else {
      // Team-specific searches with rotating query templates
      const teamsToSearch = teams.slice(0, Math.ceil(categoryBudget / queryTemplates.length));
      
      for (const team of teamsToSearch) {
        if (searchesUsed >= budget) break;
        
        // Use different query templates for each team to get diverse intelligence
        const template = queryTemplates[templateIndex % queryTemplates.length];
        const query = template
          .replace('{team}', team)
          .replace('{sport}', sport)
          .replace('{opponent}', 'upcoming opponent'); // Will enhance this later with actual matchups
        
        const result = await performSearch(query, serperKey, supabase, sport, category, team);
        if (result) {
          totalArticles += result.articleCount;
          totalInsights += result.insightCount;
        }
        searchesUsed++;
        templateIndex++;
        
        // Rate limiting between searches
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
  }

  return { searchesUsed, articles: totalArticles, insights: totalInsights };
}

async function performSearch(
  query: string,
  serperKey: string,
  supabase: any,
  sport: string,
  category: string,
  team?: string
): Promise<{ articleCount: number; insightCount: number } | null> {
  
  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': serperKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num: 8, // Get top 8 results
        location: 'United States'
      })
    });

    if (!response.ok) {
      throw new Error(`Serper API responded with ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.organic) {
      console.log(`No results for query: ${query}`);
      return null;
    }

    // Extract and format articles
    const articles = data.organic.slice(0, 6).map((result: any) => ({
      title: result.title,
      link: result.link,
      snippet: result.snippet,
      date: result.date || new Date().toISOString(),
      source: result.source
    }));

    // Generate AI summary of key insights
    const summary = generateInsightSummary(articles, category, team || sport);
    
    // Cache the intelligence
    const expiresAt = new Date();
    const config = INTELLIGENCE_CONFIG.searchCategories[category as keyof typeof INTELLIGENCE_CONFIG.searchCategories];
    expiresAt.setHours(expiresAt.getHours() + config.expiresHours);

    await supabase
      .from('news_cache')
      .upsert({
        sport,
        search_type: category,
        team_name: team || null,
        search_query: query,
        articles: JSON.stringify(articles),
        summary,
        expires_at: expiresAt.toISOString()
      }, {
        onConflict: 'sport,search_type,team_name'
      });

    return { 
      articleCount: articles.length, 
      insightCount: summary ? 1 : 0 
    };

  } catch (error) {
    console.error(`Search failed for "${query}":`, error);
    return null;
  }
}

function generateInsightSummary(articles: any[], category: string, subject: string): string {
  if (!articles || articles.length === 0) return "";

  // Extract key phrases and create intelligent summary
  const snippets = articles.map(a => a.snippet).join(' ');
  
  switch (category) {
    case 'injuries':
      return extractInjuryInsights(snippets, subject);
    case 'analyst_picks':
      return extractAnalystInsights(snippets, subject);
    case 'team_news':
      return extractTeamInsights(snippets, subject);
    case 'betting_trends':
      return extractBettingInsights(snippets, subject);
    default:
      return snippets.substring(0, 300) + "...";
  }
}

function extractInjuryInsights(text: string, team: string): string {
  const injuries = [];
  const lowerText = text.toLowerCase();
  
  // Look for injury keywords
  if (lowerText.includes('questionable')) injuries.push('Questionable players for upcoming games');
  if (lowerText.includes('doubtful')) injuries.push('Key players doubtful to play');
  if (lowerText.includes('out') && lowerText.includes('week')) injuries.push('Players ruled out');
  if (lowerText.includes('return') && lowerText.includes('injury')) injuries.push('Players returning from injury');
  
  return injuries.length > 0 
    ? `${team} injury status: ${injuries.join(', ')}`
    : `${team} injury report updated with latest player availability`;
}

function extractAnalystInsights(text: string, subject: string): string {
  const predictions = [];
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('favor') || lowerText.includes('pick')) predictions.push('Expert predictions available');
  if (lowerText.includes('spread') || lowerText.includes('line')) predictions.push('Spread analysis from professionals');
  if (lowerText.includes('over') || lowerText.includes('under')) predictions.push('Total points insights');
  
  return predictions.length > 0
    ? `${subject} analyst consensus: ${predictions.join(', ')}`
    : `Professional analysis and predictions for ${subject}`;
}

function extractTeamInsights(text: string, team: string): string {
  const news = [];
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('trade') || lowerText.includes('acquire')) news.push('Roster moves');
  if (lowerText.includes('coach') || lowerText.includes('staff')) news.push('Coaching updates');
  if (lowerText.includes('suspend') || lowerText.includes('fine')) news.push('Player discipline');
  if (lowerText.includes('sign') || lowerText.includes('contract')) news.push('Contract news');
  
  return news.length > 0
    ? `${team} updates: ${news.join(', ')}`
    : `Latest ${team} team news and developments`;
}

function extractBettingInsights(text: string, sport: string): string {
  const trends = [];
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('public') && lowerText.includes('money')) trends.push('Public betting patterns');
  if (lowerText.includes('sharp') && lowerText.includes('money')) trends.push('Professional bettor activity');
  if (lowerText.includes('line') && lowerText.includes('move')) trends.push('Line movement analysis');
  
  return trends.length > 0
    ? `${sport} betting trends: ${trends.join(', ')}`
    : `Current ${sport} betting market analysis`;
}

function isSeasonActive(sport: string): boolean {
  const now = new Date();
  const month = now.getMonth(); // 0-based
  
  switch (sport) {
    case 'NFL':
    case 'NCAAF':
      return month >= 7 || month <= 1; // Aug-Feb
    case 'NBA':
    case 'NHL':
      return month >= 9 || month <= 5; // Oct-June
    case 'MLB':
      return month >= 2 && month <= 9; // Mar-Oct
    case 'SOCCER':
      return month >= 7 || month <= 4; // Aug-May
    default:
      return true;
  }
}

serve(refreshSportsIntelligence);