-- ============================================================================
-- ONE-QUERY DASHBOARD - Complete overview in a single result
-- ============================================================================
-- Run this ONE query in Supabase SQL Editor to see everything
-- ============================================================================

WITH summary_stats AS (
  -- Count all your data sources
  SELECT 
    'TOTAL_RECORDS' as metric,
    'odds_cache' as source,
    COUNT(*)::text as value,
    MAX(last_updated) as timestamp
  FROM odds_cache
  
  UNION ALL
  
  SELECT 'TOTAL_RECORDS', 'team_stats_cache', COUNT(*)::text, MAX(last_updated) 
  FROM team_stats_cache
  
  UNION ALL
  
  SELECT 'TOTAL_RECORDS', 'news_cache', COUNT(*)::text, MAX(last_updated)
  FROM news_cache
  
  UNION ALL
  
  SELECT 'TOTAL_RECORDS', 'your_parlays', COUNT(*)::text, MAX(created_at)
  FROM parlays
  
  UNION ALL
  
  -- Current game coverage
  SELECT 'GAMES_COVERED', o.sport, 
         COUNT(DISTINCT CONCAT(home_team, ' vs ', away_team))::text,
         MAX(last_updated)
  FROM odds_cache o 
  WHERE commence_time > NOW()
  GROUP BY o.sport
  
  UNION ALL
  
  -- Bookmaker coverage  
  SELECT 'BOOKMAKERS', o.sport,
         string_agg(DISTINCT bookmaker, ', '),
         MAX(last_updated)
  FROM odds_cache o
  WHERE commence_time > NOW()  
  GROUP BY o.sport
  
  UNION ALL
  
  -- Data freshness
  SELECT 'FRESHNESS_HOURS', 'odds_cache',
         ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(last_updated)))/3600, 1)::text,
         MAX(last_updated)
  FROM odds_cache
  
  UNION ALL
  
  SELECT 'FRESHNESS_HOURS', 'team_stats_cache',
         ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(last_updated)))/3600, 1)::text,
         MAX(last_updated)
  FROM team_stats_cache
  
  UNION ALL
  
  SELECT 'FRESHNESS_HOURS', 'news_cache',
         ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(last_updated)))/3600, 1)::text,
         MAX(last_updated)
  FROM news_cache
),

data_status AS (
  SELECT 
    metric,
    source,
    value,
    timestamp,
    CASE 
      WHEN metric = 'FRESHNESS_HOURS' AND source = 'odds_cache' AND value::float > 2 THEN '⚠️ STALE'
      WHEN metric = 'FRESHNESS_HOURS' AND source LIKE '%stats%' AND value::float > 48 THEN '⚠️ OLD'
      WHEN metric = 'FRESHNESS_HOURS' AND source = 'news_cache' AND value::float > 12 THEN '⚠️ OLD'
      WHEN metric = 'FRESHNESS_HOURS' THEN '✅ FRESH'
      WHEN metric = 'TOTAL_RECORDS' AND value::int > 0 THEN '✅ HAS DATA'
      WHEN metric = 'TOTAL_RECORDS' THEN '❌ NO DATA'
      WHEN metric = 'GAMES_COVERED' AND value::int > 5 THEN '✅ GOOD COVERAGE'
      WHEN metric = 'GAMES_COVERED' AND value::int > 0 THEN '⚠️ LIMITED'
      ELSE '✅ OK'
    END as status
  FROM summary_stats
)

SELECT 
  -- Create readable dashboard format
  CASE 
    WHEN metric = 'TOTAL_RECORDS' THEN source || ' records'
    WHEN metric = 'GAMES_COVERED' THEN source || ' games covered'  
    WHEN metric = 'BOOKMAKERS' THEN source || ' bookmakers'
    WHEN metric = 'FRESHNESS_HOURS' THEN source || ' freshness (hours)'
  END as data_point,
  value,
  status,
  timestamp as last_updated
FROM data_status
ORDER BY 
  CASE metric
    WHEN 'TOTAL_RECORDS' THEN 1
    WHEN 'GAMES_COVERED' THEN 2  
    WHEN 'BOOKMAKERS' THEN 3
    WHEN 'FRESHNESS_HOURS' THEN 4
  END,
  source;