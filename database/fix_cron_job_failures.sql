-- Fix cron job failures
-- Run this in Supabase SQL Editor to fix the failing cron jobs

-- 1. Enable pg_net extension (required for HTTP calls from cron jobs)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Grant necessary permissions for pg_net
GRANT USAGE ON SCHEMA pg_net TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA pg_net TO postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA pg_net TO postgres;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA pg_net TO postgres;

-- 3. Check if the problematic cron job exists and remove it if it's calling a non-existent function
DO $$
BEGIN
    -- Remove the problematic parlay outcomes job that calls a missing function
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-parlay-outcomes-30min-safe') THEN
        PERFORM cron.unschedule('check-parlay-outcomes-30min-safe');
        RAISE NOTICE 'Removed problematic cron job: check-parlay-outcomes-30min-safe';
    END IF;
END $$;

-- 4. Replace it with the correct job that calls the edge function instead
SELECT cron.schedule(
    'check-parlay-outcomes-30min-fixed',
    '*/30 * * * *',
    $$
    SELECT pg_net.http_post(
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

-- 5. Verify the fixes
SELECT 'Extension pg_net enabled:' as status, extname, extversion 
FROM pg_extension WHERE extname = 'pg_net'
UNION ALL
SELECT 'Cron jobs after fix:' as status, jobname, schedule 
FROM cron.job 
ORDER BY status, jobname;