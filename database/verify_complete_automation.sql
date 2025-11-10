-- Final verification: Check all 4 Edge Functions are scheduled
-- Run this AFTER executing add_missing_cron_jobs.sql

SELECT 
    jobid,
    jobname,
    schedule,
    active,
    CASE 
        WHEN jobname LIKE '%odds%' THEN '🎯 Odds refresh - Every hour'
        WHEN jobname LIKE '%stats%' THEN '📊 Stats sync - 4x daily (1am,7am,1pm,7pm)'  
        WHEN jobname LIKE '%intelligence%' OR jobname LIKE '%news%' THEN '📰 News refresh - Every 2 hours'
        WHEN jobname LIKE '%parlay%' THEN '🎲 Parlay outcomes - Every 30 minutes'
        ELSE '❓ Other job'
    END as description,
    CASE 
        WHEN active = true THEN '✅ RUNNING'
        ELSE '❌ STOPPED'  
    END as status
FROM cron.job 
ORDER BY jobname;

-- Expected result: 4 jobs all showing "RUNNING"
-- refresh-odds-hourly
-- sync-sports-stats-6-hourly  
-- refresh-sports-intelligence-2-hourly
-- check-parlay-outcomes-30min