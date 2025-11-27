-- Simple RSS ingestion schedule (no database parameter needed)
-- Run this in Supabase SQL Editor

-- Schedule ingest-news-lite to run every 3 hours
SELECT cron.schedule(
  'ingest-news-lite-3hr',
  '0 */3 * * *',
  $$
    SELECT net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/ingest-news-lite',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzOTg1MTUsImV4cCI6MjA3Nzk3NDUxNX0.1O92kXamxlOLuBnF0H-pNUPxXnd2bxLqToKlqobH5Wc'
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Verify the job was scheduled
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'ingest-news-lite-3hr';

-- To check if it's running, wait 3 hours then run:
-- SELECT COUNT(*) FROM news_articles;

-- To unschedule (if needed):
-- SELECT cron.unschedule('ingest-news-lite-3hr');
