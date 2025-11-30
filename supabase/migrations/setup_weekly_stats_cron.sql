-- Setup weekly team stats sync using Supabase pg_cron
-- Run this in Supabase SQL Editor
-- 
-- NOTE: pg_cron must be enabled in your Supabase project settings first:
-- Dashboard > Database > Extensions > Enable "pg_cron"

-- Schedule weekly stats sync to run every Tuesday at 3 AM PT (11:00 UTC)
-- Syncs new game stats (team + player) from previous week
SELECT cron.schedule(
  'apisports-weekly-stats',
  '0 11 * * 2', -- Every Tuesday at 11:00 UTC (3 AM PT)
  $$
  SELECT
    net.http_post(
      url:='https://craycrayparlayapp-production.up.railway.app/api/sync-apisports?type=weekly',
      headers:='{"Content-Type": "application/json"}'::jsonb,
      body:='{}'::jsonb
    ) as request_id;
  $$
);

-- Verify the job was created
SELECT * FROM cron.job WHERE jobname = 'apisports-weekly-stats';

-- Check job history (after it runs)
SELECT * FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'apisports-weekly-stats')
ORDER BY start_time DESC
LIMIT 10;

-- To unschedule (if needed):
-- SELECT cron.unschedule('apisports-weekly-stats');
