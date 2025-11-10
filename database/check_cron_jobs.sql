-- Check what cron jobs are currently scheduled in Supabase
-- Run this in your Supabase SQL Editor

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