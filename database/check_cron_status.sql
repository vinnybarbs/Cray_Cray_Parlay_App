-- Check cron job status - Simple version that works
-- Run each section separately in Supabase SQL Editor

-- 1. Check if pg_cron extension is enabled
SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_cron';

-- 2. Check what cron jobs are currently scheduled
SELECT 
    jobname,
    schedule,
    active,
    database,
    username
FROM cron.job 
ORDER BY jobname;

-- 3. Check recent cron job runs (if any exist)
SELECT 
    j.jobname,
    r.status,
    r.return_message,
    r.start_time,
    r.end_time
FROM cron.job_run_details r
JOIN cron.job j ON r.jobid = j.jobid
ORDER BY r.start_time DESC 
LIMIT 10;

-- 4. Check what tables exist in public schema
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE '%cache%'
ORDER BY table_name;