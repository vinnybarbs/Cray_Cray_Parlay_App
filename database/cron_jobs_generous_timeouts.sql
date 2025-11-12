-- Updated cron jobs with generous timeouts for background processing
-- Run this in Supabase SQL Editor

-- 1. Remove existing cron jobs
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-odds-hourly-fixed') THEN
        PERFORM cron.unschedule('refresh-odds-hourly-fixed');
        RAISE NOTICE 'Removed: refresh-odds-hourly-fixed';
    END IF;
    
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-intelligence-2hourly-fixed') THEN
        PERFORM cron.unschedule('refresh-intelligence-2hourly-fixed');
        RAISE NOTICE 'Removed: refresh-intelligence-2hourly-fixed';
    END IF;
    
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-parlay-outcomes-30min-fixed') THEN
        PERFORM cron.unschedule('check-parlay-outcomes-30min-fixed');
        RAISE NOTICE 'Removed: check-parlay-outcomes-30min-fixed';
    END IF;
END $$;

-- 2. Create cron jobs with generous timeouts (these run in background)

-- Refresh odds every hour using FAST batched function
SELECT cron.schedule(
    'refresh-odds-hourly-fast',
    '0 * * * *',
    $$
    SELECT net.http_post(
        url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-odds-fast',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
        ),
        body := jsonb_build_object('automated', true),
        timeout_milliseconds := 300000  -- 5 minutes should be plenty now
    ) as request_id;
    $$
);

-- Refresh intelligence every 2 hours with 20-minute timeout
SELECT cron.schedule(
    'refresh-intelligence-2hourly-generous',
    '15 */2 * * *',
    $$
    SELECT net.http_post(
        url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-sports-intelligence',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
        ),
        body := jsonb_build_object('automated', true),
        timeout_milliseconds := 1200000  -- 20 minutes
    ) as request_id;
    $$
);

-- Check parlay outcomes every 30 minutes with 10-minute timeout (this one is fast)
SELECT cron.schedule(
    'check-parlay-outcomes-30min-generous',
    '*/30 * * * *',
    $$
    SELECT net.http_post(
        url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/check-parlay-outcomes',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
        ),
        body := '{}',
        timeout_milliseconds := 600000   -- 10 minutes
    ) as request_id;
    $$
);

-- 3. Verify the new jobs are scheduled
SELECT 
    jobname,
    schedule,
    active,
    database
FROM cron.job 
WHERE jobname LIKE '%-generous' OR jobname LIKE '%-fast'
ORDER BY jobname;

-- 4. Test manual execution of FAST refresh function
SELECT net.http_post(
    url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-odds-fast',
    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
    ),
    body := jsonb_build_object('manual_test', true),
    timeout_milliseconds := 300000  -- 5 minutes should be plenty now
) as manual_refresh_fast_test;