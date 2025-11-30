-- Setup daily API-Sports sync using Supabase pg_net
-- Run this in Supabase SQL Editor
-- 
-- NOTE: pg_cron must be enabled in your Supabase project settings first:
-- Dashboard > Database > Extensions > Enable "pg_cron"

-- Schedule daily sync at 6 AM PT (14:00 UTC)
-- This calls your Railway backend directly (no Edge Function needed)
SELECT cron.schedule(
  'apisports-daily-sync',
  '0 14 * * *', -- Every day at 14:00 UTC (6 AM PT)
  $$
  SELECT
    net.http_post(
      url:='https://craycrayparlayapp-production.up.railway.app/api/sync-apisports',
      headers:='{"Content-Type": "application/json"}'::jsonb,
      body:='{}'::jsonb
    ) as request_id;
  $$
);

-- Verify the job was created
SELECT * FROM cron.job WHERE jobname = 'apisports-daily-sync';

-- Check job history (after it runs)
SELECT * FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'apisports-daily-sync')
ORDER BY start_time DESC
LIMIT 10;

-- To unschedule (if needed):
-- SELECT cron.unschedule('apisports-daily-sync');
