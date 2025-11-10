-- ============================================================================
-- SUPABASE TABLE EXPLORER - See exactly what you have cached
-- ============================================================================
-- Instructions: Copy each query section and run in Supabase SQL Editor
-- Navigate to: https://supabase.com/dashboard/project/[your-project]/sql
-- ============================================================================

-- ============================================================================
-- SECTION 1: WHAT TABLES EXIST?
-- ============================================================================

-- See all your tables and their row counts
SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as columns,
  pg_size_pretty(pg_total_relation_size('public.' || table_name)) as size
FROM information_schema.tables t
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
  AND table_name IN (
    'parlays', 'parlay_legs', 'odds_cache', 'team_stats_cache', 
    'standings_cache', 'injuries_cache', 'news_cache', 
    'betting_trends_cache', 'roster_cache'
  )
ORDER BY table_name;

-- ============================================================================
-- SECTION 2: ODDS CACHE - What betting odds are cached
-- ============================================================================

-- Quick odds overview
SELECT 
  'Current Odds Cache' as info,
  sport,
  market_type,
  bookmaker,
  COUNT(*) as odds_available,
  MIN(commence_time) as earliest_game,
  MAX(commence_time) as latest_game,
  MAX(last_updated) as last_refreshed
FROM odds_cache 
WHERE commence_time > NOW()  -- Only future games
GROUP BY sport, market_type, bookmaker
ORDER BY sport, market_type, bookmaker;

-- Sample odds data (first 5 records)
SELECT 
  'Sample Odds Data' as info,
  sport,
  home_team,
  away_team,
  market_type,
  bookmaker,
  odds_json,
  commence_time,
  last_updated
FROM odds_cache 
WHERE commence_time > NOW()
ORDER BY last_updated DESC 
LIMIT 5;

-- ============================================================================
-- SECTION 3: TEAM STATS CACHE - What team data you have
-- ============================================================================

-- Team stats overview
SELECT 
  'Team Stats Available' as info,
  sport,
  season,
  COUNT(*) as teams_cached,
  MAX(last_updated) as last_refreshed,
  ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(last_updated)))/3600, 1) as hours_old
FROM team_stats_cache
GROUP BY sport, season
ORDER BY sport, season;

-- Sample team stats
SELECT 
  'Sample Team Stats' as info,
  sport,
  team_name,
  jsonb_pretty(stats) as stats_sample,
  last_updated
FROM team_stats_cache
ORDER BY last_updated DESC
LIMIT 2;

-- ============================================================================
-- SECTION 4: NEWS CACHE - What news/analysis is cached
-- ============================================================================

-- News cache overview
SELECT 
  'News Cache Summary' as info,
  sport,
  search_type,
  COUNT(*) as articles_cached,
  MAX(last_updated) as last_refreshed,
  COUNT(DISTINCT team_name) as teams_covered
FROM news_cache
GROUP BY sport, search_type
ORDER BY sport, search_type;

-- Recent news samples
SELECT 
  'Recent News Headlines' as info,
  sport,
  search_type,
  team_name,
  search_query,
  jsonb_array_length(articles) as article_count,
  LEFT(summary, 200) || '...' as summary_preview,
  last_updated
FROM news_cache
ORDER BY last_updated DESC
LIMIT 5;

-- ============================================================================
-- SECTION 5: YOUR PARLAY DATA - What you've created
-- ============================================================================

-- Your parlay activity
SELECT 
  'Your Parlay Summary' as info,
  DATE(created_at) as date,
  ai_model,
  risk_level,
  COUNT(*) as parlays_created,
  AVG(total_legs) as avg_legs,
  AVG(potential_payout) as avg_payout,
  COUNT(CASE WHEN is_lock_bet THEN 1 END) as locked_parlays
FROM parlays
GROUP BY DATE(created_at), ai_model, risk_level
ORDER BY date DESC;

-- Recent parlays with details
SELECT 
  'Recent Parlays' as info,
  p.created_at,
  p.ai_model,
  p.risk_level,
  p.total_legs,
  p.combined_odds,
  p.potential_payout,
  p.is_lock_bet,
  COUNT(pl.id) as legs_count
FROM parlays p
LEFT JOIN parlay_legs pl ON p.id = pl.parlay_id
GROUP BY p.id, p.created_at, p.ai_model, p.risk_level, p.total_legs, p.combined_odds, p.potential_payout, p.is_lock_bet
ORDER BY p.created_at DESC
LIMIT 10;

-- ============================================================================
-- SECTION 6: CACHE FRESHNESS CHECK
-- ============================================================================

-- How fresh is your cached data?
WITH freshness_check AS (
  SELECT 'odds_cache' as table_name, MAX(last_updated) as last_update FROM odds_cache
  UNION ALL
  SELECT 'team_stats_cache', MAX(last_updated) FROM team_stats_cache  
  UNION ALL
  SELECT 'news_cache', MAX(last_updated) FROM news_cache
  UNION ALL
  SELECT 'injuries_cache', MAX(last_updated) FROM injuries_cache
  UNION ALL
  SELECT 'standings_cache', MAX(last_updated) FROM standings_cache
)
SELECT 
  'Cache Freshness Check' as info,
  table_name,
  last_update,
  ROUND(EXTRACT(EPOCH FROM (NOW() - last_update))/3600, 1) as hours_old,
  CASE 
    WHEN table_name = 'odds_cache' AND last_update > NOW() - INTERVAL '2 hours' THEN '✅ Fresh'
    WHEN table_name = 'odds_cache' THEN '⚠️ Stale - Refresh Needed'
    WHEN table_name LIKE '%stats%' AND last_update > NOW() - INTERVAL '24 hours' THEN '✅ Fresh'
    WHEN table_name LIKE '%news%' AND last_update > NOW() - INTERVAL '6 hours' THEN '✅ Fresh'
    WHEN last_update IS NULL THEN '❌ No Data'
    ELSE '⚠️ Needs Refresh'
  END as status
FROM freshness_check
ORDER BY table_name;

-- ============================================================================
-- BONUS: API USAGE TRACKING
-- ============================================================================

-- See which APIs are being hit and when
SELECT 
  'API Usage Summary' as info,
  'The Odds API' as api_source,
  COUNT(DISTINCT sport) as sports_covered,
  COUNT(DISTINCT bookmaker) as bookmakers,
  COUNT(*) as total_records,
  MAX(last_updated) as last_api_call
FROM odds_cache
UNION ALL
SELECT 
  'API Usage Summary',
  'API-Sports',
  COUNT(DISTINCT sport),
  COUNT(DISTINCT team_id),
  COUNT(*),
  MAX(last_updated)
FROM team_stats_cache
UNION ALL
SELECT 
  'API Usage Summary',
  'Serper News API',
  COUNT(DISTINCT sport),
  COUNT(DISTINCT search_type),
  COUNT(*),
  MAX(last_updated)
FROM news_cache;