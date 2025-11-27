-- test_and_schedule_news_ingestion.sql
-- Helper script to verify RSS ingestion is working and schedule it

-- 1) Check if tables exist
SELECT 
  'news_sources' as table_name, 
  COUNT(*) as row_count 
FROM news_sources
UNION ALL
SELECT 
  'news_articles' as table_name, 
  COUNT(*) as row_count 
FROM news_articles;

-- 2) View recent news sources
SELECT 
  id, 
  name, 
  feed_url, 
  last_fetched, 
  created_at 
FROM news_sources 
ORDER BY created_at DESC 
LIMIT 10;

-- 3) View recent news articles
SELECT 
  id,
  source_id,
  title,
  link,
  published_at,
  fetched_at,
  LENGTH(content) as content_length,
  LENGTH(summary) as summary_length
FROM news_articles 
ORDER BY fetched_at DESC 
LIMIT 10;

-- 4) View cron job logs for news ingestion
SELECT 
  id,
  job_name,
  status,
  details,
  created_at
FROM cron_job_logs
WHERE job_name IN ('ingest-news', 'ingest-news-lite')
ORDER BY created_at DESC
LIMIT 20;

-- 5) Manually trigger the function via pg_net (test it works)
-- This is useful for testing before scheduling
SELECT
  net.http_post(
    url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/ingest-news-lite',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || '<YOUR_SUPABASE_ANON_KEY>'
    ),
    body := '{}'::jsonb
  ) as manual_trigger_result;

-- 6) Schedule ingest-news-lite to run every 3 hours
-- First, check if the job already exists
SELECT * FROM cron.job WHERE jobname = 'ingest-news-lite-schedule';

-- If it doesn't exist, create it:
SELECT cron.schedule(
  'ingest-news-lite-schedule',
  '0 */3 * * *', -- Every 3 hours
  $$
    SELECT net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/ingest-news-lite',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);

-- 7) Alternative: Schedule ingest-news (main function) to run daily
SELECT cron.schedule(
  'ingest-news-daily',
  '0 2 * * *', -- Daily at 2 AM UTC
  $$
    SELECT net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/ingest-news',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);

-- 8) View all cron jobs
SELECT * FROM cron.job ORDER BY jobname;

-- 9) Unschedule a job (if needed)
-- SELECT cron.unschedule('ingest-news-lite-schedule');
-- SELECT cron.unschedule('ingest-news-daily');

-- 10) Set the anon key for cron jobs (run once)
-- Replace with your actual SUPABASE_ANON_KEY from .env.local
-- ALTER DATABASE postgres SET app.settings.anon_key TO 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

-- 11) Check article counts by source
SELECT 
  ns.name as source_name,
  ns.feed_url,
  COUNT(na.id) as article_count,
  MAX(na.published_at) as latest_article,
  MAX(na.fetched_at) as last_fetched
FROM news_sources ns
LEFT JOIN news_articles na ON na.source_id = ns.id
GROUP BY ns.id, ns.name, ns.feed_url
ORDER BY article_count DESC;
