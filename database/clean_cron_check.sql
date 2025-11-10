-- Clean SQL query to check Edge Function cron jobs
-- Run this in Supabase SQL Editor

-- Check what cron jobs are currently scheduled
SELECT 
    jobid,
    jobname,
    schedule,
    active,
    CASE 
        WHEN jobname LIKE '%odds%' THEN 'Odds refresh (should be: 0 * * * *)'
        WHEN jobname LIKE '%stats%' THEN 'Stats sync (should be: 0 1,7,13,19 * * *)'  
        WHEN jobname LIKE '%intelligence%' OR jobname LIKE '%news%' THEN 'News refresh (should be: 15 */2 * * *)'
        WHEN jobname LIKE '%parlay%' THEN 'Parlay outcomes (MISSING: */30 * * * *)'
        ELSE 'Other job'
    END as description,
    CASE 
        WHEN active = true THEN 'RUNNING'
        ELSE 'STOPPED'  
    END as status
FROM cron.job 
ORDER BY jobname;