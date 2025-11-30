-- Setup pg_cron for daily API-Sports sync
-- Run this in Supabase SQL Editor

-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily sync at 6 AM PT (14:00 UTC)
-- This will call the Supabase Edge Function
SELECT cron.schedule(
  'apisports-daily-sync',
  '0 14 * * *', -- Every day at 14:00 UTC (6 AM PT)
  $$
  SELECT
    net.http_post(
      url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/sync-apisports-daily',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
      body:='{}'::jsonb
    ) as request_id;
  $$
);

-- Check scheduled jobs
SELECT * FROM cron.job;

-- To unschedule (if needed):
-- SELECT cron.unschedule('apisports-daily-sync');
