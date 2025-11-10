-- ENHANCED CRON JOBS WITH PG_NET AUTO-HEALING
-- These jobs check and enable pg_net before making HTTP calls
-- Prevents failures if extension gets disabled

-- 1. Enhanced Odds Refresh (with pg_net check)
SELECT cron.schedule(
  'refresh-odds-hourly-safe',
  '0 * * * *', -- Every hour
  $$
    -- Ensure pg_net is enabled
    SELECT ensure_pg_net_enabled();
    
    -- Make the HTTP call
    SELECT pg_net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/refresh-odds',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs", "Content-Type": "application/json"}',
      body := '{"automated": true}'
    );
  $$
);

-- 2. Enhanced Sports Intelligence Refresh (with pg_net check) 
SELECT cron.schedule(
  'refresh-intelligence-2hourly-safe',
  '15 */2 * * *', -- Every 2 hours at :15
  $$
    -- Ensure pg_net is enabled
    SELECT ensure_pg_net_enabled();
    
    -- Make the HTTP call
    SELECT pg_net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/refresh-sports-intelligence',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs", "Content-Type": "application/json"}',
      body := '{"automated": true}'
    );
  $$
);

-- 3. Parlay outcomes check (already works, no HTTP needed)
SELECT cron.schedule(
  'check-parlay-outcomes-30min-safe', 
  '*/30 * * * *', -- Every 30 minutes
  $$
    SELECT refresh_parlay_outcomes();
  $$
);

-- Remove old jobs to avoid duplicates
SELECT cron.unschedule('refresh-odds-hourly');
SELECT cron.unschedule('refresh-sports-intelligence-2-hourly');
SELECT cron.unschedule('check-parlay-outcomes-30min');

-- Verify new jobs
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE '%safe%';