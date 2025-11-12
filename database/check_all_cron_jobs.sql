-- Check status of all cron jobs and test the intelligence function
-- Run this in Supabase SQL Editor

-- 1. Check what cron jobs are currently scheduled
SELECT 
    jobname,
    schedule,
    active,
    database,
    command
FROM cron.job 
ORDER BY jobname;

-- 2. Check recent cron job execution history
SELECT 
    jobname,
    runid,
    job_pid,
    database,
    username,
    status,
    return_message,
    start_time AT TIME ZONE 'America/Denver' as start_time_mt,
    end_time AT TIME ZONE 'America/Denver' as end_time_mt,
    EXTRACT(EPOCH FROM (end_time - start_time)) as duration_seconds
FROM cron.job_run_details 
WHERE start_time > NOW() - INTERVAL '24 hours'
ORDER BY start_time DESC;

-- 3. Test manual execution of sports intelligence function
SELECT net.http_post(
    url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-sports-intelligence',
    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
    ),
    body := jsonb_build_object('manual_test', true),
    timeout_milliseconds := 1200000  -- 20 minutes
) as manual_intelligence_test;