-- Setup automatic parlay outcome checking
-- Runs daily to check and settle completed parlays
-- 
-- Prerequisites:
-- 1. pg_cron extension must be enabled in Supabase dashboard
-- 2. pg_net extension must be enabled in Supabase dashboard
-- 
-- To run: Copy and paste this into Supabase SQL Editor

-- Remove existing job if it exists
SELECT cron.unschedule('parlay-outcome-check');

-- Schedule parlay checking to run daily at 3 AM PT (11:00 UTC)
-- Runs after games are completed and stats are updated
SELECT cron.schedule(
  'parlay-outcome-check',
  '0 11 * * *', -- Every day at 11:00 UTC (3 AM PT)
  $$
  SELECT
    net.http_post(
      url:='https://craycrayparlayapp-production.up.railway.app/api/cron/check-parlays',
      headers:='{"Content-Type": "application/json"}'::jsonb,
      body:='{}'::jsonb
    ) as request_id;
  $$
);

-- Verify the job was created
SELECT * FROM cron.job WHERE jobname = 'parlay-outcome-check';

-- To check job execution history:
-- SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'parlay-outcome-check') ORDER BY start_time DESC LIMIT 10;

-- To manually trigger (for testing):
-- SELECT net.http_post(url:='https://craycrayparlayapp-production.up.railway.app/api/cron/check-parlays', headers:='{"Content-Type": "application/json"}'::jsonb, body:='{}'::jsonb);
