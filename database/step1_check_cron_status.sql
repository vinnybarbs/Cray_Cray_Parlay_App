-- =============================================================================
-- STEP 1: CHECK CRON JOB STATUS
-- =============================================================================
-- Run this first to see what automation is currently scheduled

-- Check what cron jobs are currently scheduled
SELECT 
    'CRON JOBS' as section,
    jobid,
    jobname,
    schedule,
    active::text,
    CASE 
        WHEN jobname LIKE '%odds%' THEN '✅ Odds automation'
        WHEN jobname LIKE '%stats%' THEN '✅ Stats automation' 
        WHEN jobname LIKE '%news%' OR jobname LIKE '%intelligence%' THEN '✅ News automation'
        ELSE '❓ Other automation'
    END as description
FROM cron.job 
ORDER BY jobname;

-- Check recent cron job executions  
SELECT 
    'RECENT RUNS' as section,
    j.jobname,
    r.status,
    r.start_time,
    r.end_time,
    CASE 
        WHEN r.status = 'succeeded' THEN '✅ Success'
        WHEN r.status = 'failed' THEN '❌ Failed' 
        ELSE '⏳ ' || r.status
    END as result,
    LEFT(r.return_message, 100) as message_preview
FROM cron.job_run_details r
JOIN cron.job j ON r.jobid = j.jobid
ORDER BY r.start_time DESC 
LIMIT 10;

-- Check if pg_cron extension is enabled
SELECT 
    'EXTENSION STATUS' as section,
    extname as extension_name,
    '✅ pg_cron is enabled' as status
FROM pg_extension 
WHERE extname = 'pg_cron'
UNION ALL
SELECT 
    'EXTENSION STATUS',
    'pg_cron',
    '❌ pg_cron is NOT enabled - run: CREATE EXTENSION pg_cron;'
WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron');