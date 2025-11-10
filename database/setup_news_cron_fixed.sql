-- Setup cron job for news refresh using pg_net
-- This schedules news refresh every 2 hours
-- Run this in your Supabase SQL Editor

SELECT cron.schedule(
  'refresh-sports-intelligence-2-hourly',   -- job name
  '15 */2 * * *',                          -- cron expression (every 2 hours at :15)
  $$
  SELECT pg_net.http_post(
    'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-sports-intelligence',
    '{}',
    '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs"}'
  );
  $$
);

-- Verify the job was scheduled
SELECT * FROM cron.job WHERE jobname = 'refresh-sports-intelligence-2-hourly';