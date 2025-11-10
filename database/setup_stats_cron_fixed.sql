-- Setup cron job for stats refresh using pg_net
-- This schedules team/player stats refresh every 6 hours
-- Run this in your Supabase SQL Editor

SELECT cron.schedule(
  'sync-sports-stats-6-hourly',             -- job name
  '0 1,7,13,19 * * *',                      -- cron expression (every 6 hours starting at 1 AM)
  $$
  SELECT pg_net.http_post(
    'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/sync-sports-stats',
    '{}',
    '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs"}'
  );
  $$
);

-- Verify the job was scheduled
SELECT * FROM cron.job WHERE jobname = 'sync-sports-stats-6-hourly';