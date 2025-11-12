-- Setup working cron jobs with proper fallback
-- Run this in Supabase SQL Editor

-- 1. Remove ALL existing cron jobs first
DO $$
BEGIN
    -- Remove previous versions
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-odds-hourly-fixed') THEN
        PERFORM cron.unschedule('refresh-odds-hourly-fixed');
        RAISE NOTICE 'Removed: refresh-odds-hourly-fixed';
    END IF;
    
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-odds-hourly-fast') THEN
        PERFORM cron.unschedule('refresh-odds-hourly-fast');
        RAISE NOTICE 'Removed: refresh-odds-hourly-fast';
    END IF;
    
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-intelligence-2hourly-fixed') THEN
        PERFORM cron.unschedule('refresh-intelligence-2hourly-fixed');
        RAISE NOTICE 'Removed: refresh-intelligence-2hourly-fixed';
    END IF;
    
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-intelligence-2hourly-generous') THEN
        PERFORM cron.unschedule('refresh-intelligence-2hourly-generous');
        RAISE NOTICE 'Removed: refresh-intelligence-2hourly-generous';
    END IF;
    
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-parlay-outcomes-30min-fixed') THEN
        PERFORM cron.unschedule('check-parlay-outcomes-30min-fixed');
        RAISE NOTICE 'Removed: check-parlay-outcomes-30min-fixed';
    END IF;
    
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-parlay-outcomes-30min-generous') THEN
        PERFORM cron.unschedule('check-parlay-outcomes-30min-generous');
        RAISE NOTICE 'Removed: check-parlay-outcomes-30min-generous';
    END IF;
END $$;

-- 2. Use original function with VERY generous timeout (background jobs don't need to be fast)

-- Refresh odds every hour with 30-minute timeout (original function)
SELECT cron.schedule(
    'refresh-odds-hourly-ultra',
    '0 * * * *',
    $$
    SELECT net.http_post(
        url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-odds',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
        ),
        body := jsonb_build_object('automated', true),
        timeout_milliseconds := 1800000  -- 30 minutes (1800000ms)
    ) as request_id;
    $$
);

-- Refresh intelligence every 2 hours with 30-minute timeout 
SELECT cron.schedule(
    'refresh-intelligence-2hourly-ultra',
    '15 */2 * * *',
    $$
    SELECT net.http_post(
        url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-sports-intelligence',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
        ),
        body := jsonb_build_object('automated', true),
        timeout_milliseconds := 1800000  -- 30 minutes
    ) as request_id;
    $$
);

-- Check parlay outcomes every 30 minutes with 15-minute timeout (this one works fast)
SELECT cron.schedule(
    'check-parlay-outcomes-30min-ultra',
    '*/30 * * * *',
    $$
    SELECT net.http_post(
        url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/check-parlay-outcomes',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
        ),
        body := '{}',
        timeout_milliseconds := 900000   -- 15 minutes
    ) as request_id;
    $$
);

-- 3. Verify the jobs are scheduled
SELECT 
    jobname,
    schedule,
    active,
    database
FROM cron.job 
WHERE jobname LIKE '%-ultra'
ORDER BY jobname;

-- 4. Manually trigger odds refresh with ultra timeout to test
SELECT net.http_post(
    url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-odds',
    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
    ),
    body := jsonb_build_object('manual_ultra_test', true),
    timeout_milliseconds := 1800000  -- 30 minutes for manual test
) as manual_ultra_test;