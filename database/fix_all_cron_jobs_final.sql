-- Fix ALL cron jobs to use correct net.http_post syntax
-- Run this in Supabase SQL Editor

-- 1. Remove all problematic cron jobs
DO $$
BEGIN
    -- Remove all existing jobs that are failing
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-odds-hourly-safe') THEN
        PERFORM cron.unschedule('refresh-odds-hourly-safe');
        RAISE NOTICE 'Removed: refresh-odds-hourly-safe';
    END IF;
    
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-intelligence-2hourly-safe') THEN
        PERFORM cron.unschedule('refresh-intelligence-2hourly-safe');
        RAISE NOTICE 'Removed: refresh-intelligence-2hourly-safe';
    END IF;
    
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-parlay-outcomes-30min-safe') THEN
        PERFORM cron.unschedule('check-parlay-outcomes-30min-safe');
        RAISE NOTICE 'Removed: check-parlay-outcomes-30min-safe';
    END IF;
END $$;

-- 2. Create working cron jobs using correct net.http_post syntax
SELECT cron.schedule(
    'refresh-odds-hourly-fixed',
    '0 * * * *',
    $$
    SELECT net.http_post(
        url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-odds',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
        ),
        body := jsonb_build_object('automated', true),
        timeout_milliseconds := 300000
    ) as request_id;
    $$
);

SELECT cron.schedule(
    'refresh-intelligence-2hourly-fixed',
    '15 */2 * * *',
    $$
    SELECT net.http_post(
        url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-sports-intelligence',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
        ),
        body := jsonb_build_object('automated', true),
        timeout_milliseconds := 300000
    ) as request_id;
    $$
);

SELECT cron.schedule(
    'check-parlay-outcomes-30min-fixed',
    '*/30 * * * *',
    $$
    SELECT net.http_post(
        url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/check-parlay-outcomes',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
        ),
        body := '{}',
        timeout_milliseconds := 120000
    ) as request_id;
    $$
);

-- 3. Verify the new jobs are scheduled
SELECT 
    jobname,
    schedule,
    active
FROM cron.job 
WHERE jobname LIKE '%-fixed'
ORDER BY jobname;

-- 4. Manually trigger odds refresh right now
SELECT net.http_post(
    url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-odds',
    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
    ),
    body := '{}',
    timeout_milliseconds := 300000
) as manual_refresh_now;