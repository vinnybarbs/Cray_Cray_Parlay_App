-- ============================================================================
-- QUICK CACHE STATUS - Simple one-query overview
-- ============================================================================
-- Run this single query in Supabase SQL Editor for instant status
-- ============================================================================

WITH cache_summary AS (
  -- Odds Cache Summary
  SELECT 
    'Odds Cache (The Odds API)' as data_source,
    sport,
    COUNT(*) as records,
    COUNT(DISTINCT bookmaker) as bookmakers,
    COUNT(DISTINCT CONCAT(home_team, ' vs ', away_team)) as games,
    MAX(last_updated) as last_updated,
    ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(last_updated)))/3600, 1) as hours_old
  FROM odds_cache 
  WHERE commence_time > NOW()  -- Future games only
  GROUP BY sport
  
  UNION ALL
  
  -- Team Stats Cache
  SELECT 
    'Team Stats (API-Sports)',
    sport,
    COUNT(*),
    COUNT(DISTINCT team_id),
    NULL,
    MAX(last_updated),
    ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(last_updated)))/3600, 1)
  FROM team_stats_cache 
  GROUP BY sport
  
  UNION ALL
  
  -- News Cache
  SELECT 
    'News & Analysis (Serper)',
    sport,
    COUNT(*),
    COUNT(DISTINCT search_type),
    NULL,
    MAX(last_updated),
    ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(last_updated)))/3600, 1)
  FROM news_cache 
  GROUP BY sport
  
  UNION ALL
  
  -- Your Parlays
  SELECT 
    'Your Parlays',
    'User Data',
    COUNT(*),
    COUNT(DISTINCT ai_model),
    COUNT(CASE WHEN is_lock_bet THEN 1 END),
    MAX(created_at),
    ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))/3600, 1)
  FROM parlays
)

SELECT 
  data_source,
  sport,
  records,
  bookmakers as sources_or_models,
  games as games_or_locked,
  last_updated,
  hours_old,
  CASE 
    WHEN data_source LIKE '%Odds%' AND hours_old > 2 THEN '⚠️ STALE'
    WHEN data_source LIKE '%Stats%' AND hours_old > 48 THEN '⚠️ OLD' 
    WHEN data_source LIKE '%News%' AND hours_old > 12 THEN '⚠️ OLD'
    WHEN hours_old IS NULL THEN '❌ NO DATA'
    ELSE '✅ FRESH'
  END as status
FROM cache_summary
ORDER BY 
  CASE data_source 
    WHEN 'Your Parlays' THEN 1 
    WHEN 'Odds Cache (The Odds API)' THEN 2
    WHEN 'Team Stats (API-Sports)' THEN 3
    WHEN 'News & Analysis (Serper)' THEN 4
  END,
  sport;