-- Schedule RSS ingestion cron jobs
-- Run this in Supabase SQL Editor

-- First, set the anon key for cron jobs (one-time setup)
ALTER DATABASE postgres 
SET app.settings.anon_key TO 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzOTg1MTUsImV4cCI6MjA3Nzk3NDUxNX0.1O92kXamxlOLuBnF0H-pNUPxXnd2bxLqToKlqobH5Wc';

-- Option 1: ingest-news-lite every 3 hours (recommended for testing)
SELECT cron.schedule(
  'ingest-news-lite-3hr',
  '0 */3 * * *',
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

-- Option 2: ingest-news (processes 3 feeds) every 6 hours
SELECT cron.schedule(
  'ingest-news-6hr',
  '0 */6 * * *',
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

-- Option 3: More aggressive schedule for Sundays (NFL game days)
-- Every 2 hours on Sunday
SELECT cron.schedule(
  'ingest-news-sunday',
  '0 */2 * * 0',
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

-- View all scheduled jobs
SELECT jobid, jobname, schedule, active 
FROM cron.job 
ORDER BY jobname;

-- To unschedule a job (if needed):
-- SELECT cron.unschedule('ingest-news-lite-3hr');
-- SELECT cron.unschedule('ingest-news-6hr');
-- SELECT cron.unschedule('ingest-news-sunday');
