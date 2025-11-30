-- Setup automatic news summarization
-- Runs daily to extract betting-relevant insights from raw articles
-- 
-- Prerequisites:
-- 1. pg_cron extension must be enabled in Supabase dashboard
-- 2. pg_net extension must be enabled in Supabase dashboard
-- 3. Run add-news-summary-columns.sql first to create columns
-- 
-- To run: Copy and paste this into Supabase SQL Editor

-- Remove existing job if it exists
SELECT cron.unschedule('news-summarization');

-- Schedule news summarization to run daily at 7 AM PT (15:00 UTC)
-- Runs after daily data sync completes
SELECT cron.schedule(
  'news-summarization',
  '0 15 * * *', -- Every day at 15:00 UTC (7 AM PT)
  $$
  SELECT
    net.http_post(
      url:='https://craycrayparlayapp-production.up.railway.app/api/cron/summarize-news',
      headers:='{"Content-Type": "application/json"}'::jsonb,
      body:='{}'::jsonb
    ) as request_id;
  $$
);

-- Verify the job was created
SELECT * FROM cron.job WHERE jobname = 'news-summarization';

-- To check job execution history:
-- SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'news-summarization') ORDER BY start_time DESC LIMIT 10;

-- To manually trigger (for testing):
-- SELECT net.http_post(url:='https://craycrayparlayapp-production.up.railway.app/api/cron/summarize-news', headers:='{"Content-Type": "application/json"}'::jsonb, body:='{}'::jsonb);
