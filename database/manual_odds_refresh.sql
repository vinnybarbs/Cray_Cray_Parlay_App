-- Check current cron job status and manually refresh odds
-- Run each section separately

-- 1. Check what cron jobs are currently scheduled
SELECT 
    jobname,
    schedule,
    active,
    command
FROM cron.job 
ORDER BY jobname;

-- 2. If no working cron jobs exist, let's manually refresh the odds data
-- This calls the edge function directly from the database
SELECT net.http_post(
    url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-odds',
    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
    ),
    body := '{}',
    timeout_milliseconds := 300000
) as manual_refresh_result;

-- 3. After running the manual refresh, check if new data was added
SELECT 
    COUNT(*) as total_records,
    MAX(last_updated) as most_recent_update,
    COUNT(DISTINCT sport) as sports_count
FROM odds_cache;