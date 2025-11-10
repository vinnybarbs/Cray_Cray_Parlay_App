-- ============================================================================
-- ENHANCED DASHBOARD - Complete overview with missing data analysis
-- ============================================================================
-- Shows what you have + what's missing + actionable recommendations
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
  -- Check what cron jobs are currently scheduled
SELECT 
    jobid,
    jobname,
    schedule,
    command,
    active,
    nodename,
    nodeport
FROM cron.job 
ORDER BY jobname;

-- Also check recent cron job runs  
SELECT 
    jobid,
    runid,
    job_pid,
    database,
    username,
    command,
    status,
    return_message,
    start_time,
    end_time
FROM cron.job_run_details 
ORDER BY start_time DESC 
LIMIT 20;

-- Check if pg_cron extension is enabled
SELECT * FROM pg_extension WHERE extname = 'pg_cron';
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
  timestamp as last_updated,
  -- Add actionable recommendations
  CASE 
    WHEN metric = 'TOTAL_RECORDS' AND source = 'team_stats_cache' AND value = '0' 
      THEN '🔧 Run: curl "http://localhost:5001/api/refresh-stats"'
    WHEN metric = 'TOTAL_RECORDS' AND source = 'news_cache' AND value = '0' 
      THEN '🔧 Run: curl "http://localhost:5001/api/refresh-news"'
    WHEN metric = 'FRESHNESS_HOURS' AND source = 'odds_cache' AND value::float > 6 
      THEN '🔧 Run: curl "http://localhost:5001/api/refresh-odds"'
    WHEN metric = 'GAMES_COVERED' AND source LIKE '%nfl%' AND value::int < 5 
      THEN '⏰ Wait for more NFL games (limited games this week)'
    WHEN status LIKE '%STALE%' OR status LIKE '%OLD%' 
      THEN '🔄 Refresh recommended'
    WHEN status = '❌ NO DATA' 
      THEN '🚨 Critical - API endpoint may not be working'
    ELSE '✅ No action needed'
  END as recommendation
FROM data_status
ORDER BY 
  CASE 
    WHEN status LIKE '%❌%' THEN 1  -- Critical issues first
    WHEN status LIKE '%⚠️%' THEN 2  -- Warnings second  
    WHEN metric = 'TOTAL_RECORDS' THEN 3
    WHEN metric = 'GAMES_COVERED' THEN 4
    WHEN metric = 'BOOKMAKERS' THEN 5
    WHEN metric = 'FRESHNESS_HOURS' THEN 6
  END, source;

-- ============================================================================
-- DETAILED ANALYSIS - What's actually missing and why
-- ============================================================================

-- Show missing data sources with explanations
SELECT '🔍 MISSING DATA ANALYSIS' as analysis_type, * FROM (
  SELECT 
    'Missing Team Stats' as issue,
    '0 records in team_stats_cache' as problem,
    'No team performance data for AI analysis' as impact,
    'curl "http://localhost:5001/api/refresh-stats"' as solution,
    'High' as priority
  WHERE NOT EXISTS (SELECT 1 FROM team_stats_cache LIMIT 1)
  
  UNION ALL
  
  SELECT 
    'Missing News Data',
    '0 records in news_cache',
    'No injury reports or analyst insights for AI',
    'curl "http://localhost:5001/api/refresh-news"', 
    'High'
  WHERE NOT EXISTS (SELECT 1 FROM news_cache LIMIT 1)
  
  UNION ALL
  
  SELECT 
    'Stale Odds Data',
    'Odds over 6 hours old (' || ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(last_updated)))/3600, 1) || 'h)',
    'AI making decisions on outdated lines',
    'curl "http://localhost:5001/api/refresh-odds"',
    'Medium'
  FROM odds_cache
  HAVING MAX(last_updated) < NOW() - INTERVAL '6 hours'
  
  UNION ALL
  
  SELECT 
    'Limited NFL Games',
    'Only ' || COUNT(DISTINCT CONCAT(home_team, ' vs ', away_team)) || ' NFL games',
    'Reduced parlay options for primary sport',
    'Normal - NFL has limited midweek games',
    'Low'
  FROM odds_cache 
  WHERE sport = 'americanfootball_nfl' AND commence_time > NOW()
  HAVING COUNT(DISTINCT CONCAT(home_team, ' vs ', away_team)) < 5
) issues;

-- ============================================================================
-- API ENDPOINT STATUS - Check if your refresh endpoints work
-- ============================================================================

SELECT '🌐 API ENDPOINT STATUS' as check_type, * FROM (
  SELECT 
    'refresh-odds' as endpoint,
    CASE WHEN MAX(last_updated) > NOW() - INTERVAL '24 hours' 
         THEN '✅ Working (recent data)' 
         ELSE '❌ Not working or not run' END as status,
    COALESCE(MAX(last_updated)::text, 'Never') as last_successful_run,
    'curl "http://localhost:5001/api/refresh-odds"' as test_command
  FROM odds_cache
  
  UNION ALL
  
  SELECT 
    'refresh-stats',
    CASE WHEN EXISTS(SELECT 1 FROM team_stats_cache) 
         THEN '✅ Has data' 
         ELSE '❌ No data - never run' END,
    COALESCE(MAX(last_updated)::text, 'Never'),
    'curl "http://localhost:5001/api/refresh-stats"'
  FROM team_stats_cache
  
  UNION ALL
  
  SELECT 
    'refresh-news',
    CASE WHEN EXISTS(SELECT 1 FROM news_cache) 
         THEN '✅ Has data' 
         ELSE '❌ No data - never run' END,
    COALESCE(MAX(last_updated)::text, 'Never'),
    'curl "http://localhost:5001/api/refresh-news"'
  FROM news_cache
) endpoint_status;

-- ============================================================================
-- GAME SCHEDULE INSIGHT - Why you have the games you do
-- ============================================================================

SELECT '📅 GAME SCHEDULE ANALYSIS' as schedule_type, * FROM (
  SELECT 
    sport,
    COUNT(DISTINCT CONCAT(home_team, ' vs ', away_team)) as games_available,
    MIN(commence_time) as next_game,
    MAX(commence_time) as last_game,
    CASE 
      WHEN sport = 'americanfootball_nfl' AND COUNT(*) < 10 THEN 'Normal - NFL plays mainly Sunday/Monday/Thursday'
      WHEN sport = 'americanfootball_ncaaf' AND COUNT(*) > 50 THEN 'Normal - College has many Saturday games'
      WHEN sport = 'icehockey_nhl' AND COUNT(*) < 10 THEN 'Normal - NHL has 2-8 games per day'
      WHEN sport = 'soccer_epl' AND COUNT(*) > 15 THEN 'Normal - EPL weekend fixtures'
      ELSE 'Check if this is expected for ' || sport
    END as explanation
  FROM odds_cache 
  WHERE commence_time > NOW() AND commence_time < NOW() + INTERVAL '7 days'
  GROUP BY sport
) schedule_analysis
ORDER BY games_available DESC;

-- ============================================================================
-- CRON JOB STATUS - Are your scheduled tasks running?
-- ============================================================================

-- Check what cron jobs are currently scheduled
SELECT 
    jobid,
    jobname,
    schedule,
    command,
    active,
    nodename,
    nodeport
FROM cron.job 
ORDER BY jobname;

-- Also check recent cron job runs  
SELECT 
    jobid,
    runid,
    job_pid,
    database,
    username,
    command,
    status,
    return_message,
    start_time,
    end_time
FROM cron.job_run_details 
ORDER BY start_time DESC 
LIMIT 20;

-- Check if pg_cron extension is enabled
SELECT * FROM pg_extension WHERE extname = 'pg_cron';