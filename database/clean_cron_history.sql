-- Check recent cron job runs
-- Run this SECOND in Supabase SQL Editor (separate query)

SELECT 
    j.jobname,
    r.status,
    r.start_time,
    LEFT(r.return_message, 100) as message
FROM cron.job_run_details r
JOIN cron.job j ON r.jobid = j.jobid
WHERE r.start_time > NOW() - INTERVAL '24 hours'
ORDER BY r.start_time DESC 
LIMIT 10;