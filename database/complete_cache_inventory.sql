-- ============================================================================
-- COMPLETE CACHE AND DATA INVENTORY - Run in Supabase SQL Editor
-- ============================================================================
-- Copy and paste these queries into Supabase Dashboard → SQL Editor
-- https://supabase.com/dashboard/project/[your-project]/sql
-- ============================================================================

-- ============================================================================
-- 1. MASTER OVERVIEW - All Tables with Count and Freshness
-- ============================================================================

SELECT 
  'System Overview' as section,
  table_name,
  row_count,
  last_activity,
  CASE 
    WHEN table_name LIKE '%cache%' AND last_activity < NOW() - INTERVAL '2 hours' THEN '⚠️ STALE DATA'
    WHEN table_name LIKE '%cache%' AND last_activity < NOW() - INTERVAL '6 hours' THEN '🔴 VERY STALE'
    WHEN table_name LIKE '%cache%' THEN '✅ FRESH'
    ELSE '📊 USER DATA'
  END as status
FROM (
  SELECT 'users' as table_name, COUNT(*) as row_count, MAX(created_at) as last_activity FROM auth.users
  UNION ALL
  SELECT 'parlays', COUNT(*), MAX(created_at) FROM parlays
  UNION ALL
  SELECT 'parlay_legs', COUNT(*), MAX(created_at) FROM parlay_legs
  UNION ALL
  SELECT 'odds_cache', COUNT(*), MAX(last_updated) FROM odds_cache WHERE last_updated IS NOT NULL
  UNION ALL
  SELECT 'team_stats_cache', COUNT(*), MAX(last_updated) FROM team_stats_cache WHERE last_updated IS NOT NULL
  UNION ALL  
  SELECT 'standings_cache', COUNT(*), MAX(last_updated) FROM standings_cache WHERE last_updated IS NOT NULL
  UNION ALL
  SELECT 'injuries_cache', COUNT(*), MAX(last_updated) FROM injuries_cache WHERE last_updated IS NOT NULL
  UNION ALL
  SELECT 'news_cache', COUNT(*), MAX(last_updated) FROM news_cache WHERE last_updated IS NOT NULL
  UNION ALL
  SELECT 'betting_trends_cache', COUNT(*), MAX(last_updated) FROM betting_trends_cache WHERE last_updated IS NOT NULL
  UNION ALL
  SELECT 'roster_cache', COUNT(*), MAX(last_updated) FROM roster_cache WHERE last_updated IS NOT NULL
) t
ORDER BY 
  CASE 
    WHEN table_name = 'users' THEN 1
    WHEN table_name = 'parlays' THEN 2
    WHEN table_name = 'parlay_legs' THEN 3
    ELSE 4
  END, table_name;

-- ============================================================================
-- 2. ODDS CACHE BREAKDOWN - What odds are cached from where
-- ============================================================================

SELECT 
  'Odds Cache Details' as section,
  sport,
  bookmaker,
  market_type,
  COUNT(*) as odds_count,
  COUNT(DISTINCT CONCAT(home_team, ' vs ', away_team)) as unique_games,
  MIN(last_updated) as oldest_data,
  MAX(last_updated) as newest_data,
  ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - last_updated))/3600), 1) as avg_hours_old
FROM odds_cache 
GROUP BY sport, bookmaker, market_type
ORDER BY sport, bookmaker, market_type;

-- ============================================================================
-- 3. API SOURCES BREAKDOWN - Where data comes from
-- ============================================================================

SELECT 'Data Sources' as section, 'Odds-API (The Odds API)' as source, 
       sport, bookmaker, COUNT(*) as records, MAX(last_updated) as last_fetch
FROM odds_cache 
GROUP BY sport, bookmaker
UNION ALL
SELECT 'Data Sources', 'API-Sports', 
       sport, 'Team Stats' as bookmaker, COUNT(*) as records, MAX(last_updated)
FROM team_stats_cache 
GROUP BY sport
UNION ALL
SELECT 'Data Sources', 'Serper (Google News)', 
       sport, search_type as bookmaker, COUNT(*), MAX(last_updated)
FROM news_cache 
GROUP BY sport, search_type
ORDER BY source, sport;

-- ============================================================================
-- 4. GAME COVERAGE - What games have complete data
-- ============================================================================

SELECT 
  'Game Coverage' as section,
  sport,
  COUNT(DISTINCT CONCAT(home_team, ' vs ', away_team)) as total_games,
  COUNT(DISTINCT CASE WHEN market_type = 'h2h' THEN CONCAT(home_team, ' vs ', away_team) END) as moneyline_games,
  COUNT(DISTINCT CASE WHEN market_type = 'spreads' THEN CONCAT(home_team, ' vs ', away_team) END) as spread_games,
  COUNT(DISTINCT CASE WHEN market_type = 'totals' THEN CONCAT(home_team, ' vs ', away_team) END) as total_games_data,
  COUNT(DISTINCT bookmaker) as bookmakers_available
FROM odds_cache 
WHERE commence_time > NOW()  -- Future games only
GROUP BY sport
ORDER BY total_games DESC;

-- ============================================================================
-- 5. FRESHNESS CHECK - How current is each data source
-- ============================================================================

SELECT 
  'Data Freshness' as section,
  data_type,
  source_count,
  oldest_data,
  newest_data,
  freshness_status
FROM (
  SELECT 
    'Odds Data' as data_type,
    COUNT(*) as source_count,
    MIN(last_updated) as oldest_data,
    MAX(last_updated) as newest_data,
    CASE 
      WHEN MAX(last_updated) > NOW() - INTERVAL '1 hour' THEN '🟢 Very Fresh'
      WHEN MAX(last_updated) > NOW() - INTERVAL '3 hours' THEN '🟡 Acceptable'
      WHEN MAX(last_updated) > NOW() - INTERVAL '6 hours' THEN '🟠 Getting Stale'
      ELSE '🔴 Stale - Needs Refresh'
    END as freshness_status
  FROM odds_cache
  
  UNION ALL
  
  SELECT 
    'Team Statistics',
    COUNT(*),
    MIN(last_updated),
    MAX(last_updated),
    CASE 
      WHEN MAX(last_updated) > NOW() - INTERVAL '24 hours' THEN '🟢 Daily Fresh'
      WHEN MAX(last_updated) > NOW() - INTERVAL '48 hours' THEN '🟡 Acceptable'
      ELSE '🔴 Needs Update'
    END
  FROM team_stats_cache
  
  UNION ALL
  
  SELECT 
    'News & Analysis',
    COUNT(*),
    MIN(last_updated),
    MAX(last_updated),
    CASE 
      WHEN MAX(last_updated) > NOW() - INTERVAL '6 hours' THEN '🟢 Fresh News'
      WHEN MAX(last_updated) > NOW() - INTERVAL '24 hours' THEN '🟡 Acceptable'
      ELSE '🔴 Old News'
    END
  FROM news_cache
) freshness_data
ORDER BY data_type;

-- ============================================================================
-- 6. USER ACTIVITY SUMMARY - Your parlay creation patterns
-- ============================================================================

SELECT 
  'User Activity' as section,
  ai_model,
  risk_level,
  sportsbook,
  COUNT(*) as parlays_created,
  AVG(total_legs) as avg_legs,
  AVG(potential_payout) as avg_payout,
  COUNT(CASE WHEN is_lock_bet THEN 1 END) as locked_parlays,
  MAX(created_at) as last_created
FROM parlays
GROUP BY ai_model, risk_level, sportsbook
ORDER BY parlays_created DESC;

-- ============================================================================
-- 7. CACHE EFFICIENCY - Storage usage
-- ============================================================================

SELECT 
  'Storage Usage' as section,
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as index_size
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('odds_cache', 'team_stats_cache', 'news_cache', 'parlays', 'parlay_legs', 'injuries_cache', 'standings_cache', 'betting_trends_cache', 'roster_cache')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;