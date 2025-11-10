-- =============================================================================
-- REAL-TIME DATA PIPELINE DASHBOARD
-- =============================================================================
-- Plain language status of your automation system
-- Run this in Supabase SQL Editor to see what's actually happening

-- 1. CRON JOB STATUS - Are your automation jobs running?
SELECT 
    '🤖 AUTOMATION STATUS' as section,
    jobname as job_name,
    CASE 
        WHEN jobname LIKE '%odds%' THEN 'Gets fresh betting lines every hour'
        WHEN jobname LIKE '%stats%' THEN 'Gets team/player stats every 6 hours'  
        WHEN jobname LIKE '%intelligence%' OR jobname LIKE '%news%' THEN 'Gets injury news every 2 hours'
        ELSE 'Other automation'
    END as what_it_does,
    schedule as when_it_runs,
    active::text as is_active,
    CASE 
        WHEN active = true THEN '✅ Running'
        ELSE '❌ Stopped'
    END as status
FROM cron.job 
ORDER BY jobname;

-- 2. RECENT AUTOMATION RUNS - What happened in the last few hours?
SELECT 
    '📋 RECENT ACTIVITY' as section,
    j.jobname as automation_job,
    r.start_time::timestamp as when_it_ran,
    CASE 
        WHEN r.status = 'succeeded' THEN '✅ Success'
        WHEN r.status = 'failed' THEN '❌ Failed'
        ELSE '⏳ ' || r.status
    END as result,
    CASE
        WHEN r.start_time > NOW() - INTERVAL '1 hour' THEN 'Just ran'
        WHEN r.start_time > NOW() - INTERVAL '6 hours' THEN 'Recent'
        ELSE 'Old run'
    END as how_recent,
    LEFT(r.return_message, 200) as what_happened
FROM cron.job_run_details r
JOIN cron.job j ON r.jobid = j.jobid
WHERE r.start_time > NOW() - INTERVAL '24 hours'
ORDER BY r.start_time DESC 
LIMIT 10;

-- 3. DATA FRESHNESS - When did we last get fresh data?
SELECT 
    '📊 DATA FRESHNESS' as section,
    'Betting Odds' as data_type,
    COUNT(*) as total_records,
    MAX(last_updated) as newest_data,
    CASE 
        WHEN MAX(last_updated) > NOW() - INTERVAL '2 hours' THEN '🟢 Fresh (less than 2 hours old)'
        WHEN MAX(last_updated) > NOW() - INTERVAL '6 hours' THEN '🟡 Getting stale (2-6 hours old)'
        ELSE '🔴 Very stale (over 6 hours old)'
    END as freshness_status,
    ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(last_updated)))/3600, 1) as hours_since_update
FROM odds_cache
WHERE last_updated IS NOT NULL

UNION ALL

SELECT 
    '📊 DATA FRESHNESS',
    'Team/Player Stats',
    COUNT(*),
    MAX(last_updated),
    CASE 
        WHEN MAX(last_updated) > NOW() - INTERVAL '12 hours' THEN '🟢 Fresh (less than 12 hours old)'
        WHEN MAX(last_updated) > NOW() - INTERVAL '24 hours' THEN '🟡 Getting stale (12-24 hours old)'
        ELSE '🔴 Very stale (over 24 hours old)'
    END,
    ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(last_updated)))/3600, 1)
FROM team_stats_cache
WHERE last_updated IS NOT NULL

UNION ALL

SELECT 
    '📊 DATA FRESHNESS',
    'Injury News',
    COUNT(*),
    MAX(last_updated),
    CASE 
        WHEN MAX(last_updated) > NOW() - INTERVAL '4 hours' THEN '🟢 Fresh (less than 4 hours old)'
        WHEN MAX(last_updated) > NOW() - INTERVAL '12 hours' THEN '🟡 Getting stale (4-12 hours old)'
        ELSE '🔴 Very stale (over 12 hours old)'
    END,
    ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(last_updated)))/3600, 1)
FROM news_cache
WHERE last_updated IS NOT NULL;

-- 4. WHAT'S ACTUALLY IN THE DATABASE - Do we have the data we need?
SELECT 
    '💾 DATABASE CONTENTS' as section,
    'NFL Games Available' as what_we_have,
    COUNT(DISTINCT CONCAT(home_team, ' vs ', away_team)) as count_found,
    CASE 
        WHEN COUNT(*) > 20 THEN '✅ Good coverage'
        WHEN COUNT(*) > 5 THEN '⚠️ Limited games'
        WHEN COUNT(*) > 0 THEN '🔴 Very few games'
        ELSE '❌ No games found'
    END as status,
    MIN(commence_time) as next_game,
    'Games with betting lines loaded' as notes
FROM odds_cache 
WHERE sport = 'americanfootball_nfl' 
AND commence_time > NOW()

UNION ALL

SELECT 
    '💾 DATABASE CONTENTS',
    'NBA Games Available',
    COUNT(DISTINCT CONCAT(home_team, ' vs ', away_team)),
    CASE 
        WHEN COUNT(*) > 20 THEN '✅ Good coverage'
        WHEN COUNT(*) > 5 THEN '⚠️ Limited games'
        WHEN COUNT(*) > 0 THEN '🔴 Very few games'
        ELSE '❌ No games found'
    END,
    MIN(commence_time),
    'Games with betting lines loaded'
FROM odds_cache 
WHERE sport = 'basketball_nba' 
AND commence_time > NOW()

UNION ALL

SELECT 
    '💾 DATABASE CONTENTS',
    'Team Statistics',
    COUNT(*),
    CASE 
        WHEN COUNT(*) > 50 THEN '✅ Good data'
        WHEN COUNT(*) > 10 THEN '⚠️ Some data'
        WHEN COUNT(*) > 0 THEN '🔴 Very limited'
        ELSE '❌ No stats found'
    END,
    NULL,
    'Team performance metrics for AI analysis'
FROM team_stats_cache

UNION ALL

SELECT 
    '💾 DATABASE CONTENTS',
    'Injury/News Reports',
    COUNT(*),
    CASE 
        WHEN COUNT(*) > 20 THEN '✅ Good coverage'
        WHEN COUNT(*) > 5 THEN '⚠️ Limited news'
        WHEN COUNT(*) > 0 THEN '🔴 Very few reports'
        ELSE '❌ No news found'
    END,
    NULL,
    'Player injuries and team news for AI insights'
FROM news_cache;

-- 5. IMMEDIATE ACTION ITEMS - What needs to be fixed right now?
SELECT 
    '⚡ IMMEDIATE ACTIONS NEEDED' as section,
    CASE
        WHEN NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname LIKE '%odds%') 
        THEN '🚨 CRITICAL: No odds automation scheduled - your betting lines will never update!'
        
        WHEN NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname LIKE '%stats%') 
        THEN '⚠️ MISSING: No stats automation - AI has no team performance data'
        
        WHEN NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname LIKE '%news%' OR jobname LIKE '%intelligence%') 
        THEN '⚠️ MISSING: No news automation - AI missing injury reports'
        
        WHEN NOT EXISTS (SELECT 1 FROM odds_cache WHERE last_updated > NOW() - INTERVAL '6 hours')
        THEN '🔴 STALE ODDS: Betting lines are over 6 hours old - refresh needed'
        
        WHEN NOT EXISTS (SELECT 1 FROM team_stats_cache LIMIT 1)
        THEN '🔴 NO STATS: Team stats table is empty - AI can''t analyze performance'
        
        WHEN NOT EXISTS (SELECT 1 FROM news_cache LIMIT 1)
        THEN '🔴 NO NEWS: News table is empty - AI missing injury information'
        
        ELSE '✅ System looks healthy - all automations running and data is fresh'
    END as priority_action,
    
    CASE
        WHEN NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname LIKE '%odds%') 
        THEN 'Add odds refresh cron job immediately'
        
        WHEN NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname LIKE '%stats%') 
        THEN 'Add stats sync cron job'
        
        WHEN NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname LIKE '%news%' OR jobname LIKE '%intelligence%') 
        THEN 'Add news refresh cron job'
        
        WHEN NOT EXISTS (SELECT 1 FROM odds_cache WHERE last_updated > NOW() - INTERVAL '6 hours')
        THEN 'Manually trigger odds refresh or check API keys'
        
        WHEN NOT EXISTS (SELECT 1 FROM team_stats_cache LIMIT 1)
        THEN 'Manually trigger stats sync or check API-Sports key'
        
        WHEN NOT EXISTS (SELECT 1 FROM news_cache LIMIT 1)
        THEN 'Manually trigger news refresh or check Serper API key'
        
        ELSE 'No immediate action needed - monitor for continued operation'
    END as what_to_do_now;