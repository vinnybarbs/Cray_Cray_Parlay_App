-- Setup cron job for odds refresh using pg_net (alternative to net extension)
-- This schedules odds refresh every hour
-- Run this in your Supabase SQL Editor

-- First, let's try using pg_net instead of net
SELECT cron.schedule(
  'refresh-odds-hourly',                    -- job name
  '0 * * * *',                              -- cron expression (every hour at :00)
  $$
  SELECT pg_net.http_post(
    'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-odds',
    '{}',
    '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs"}'
  );
  $$
);

-- Verify the job was scheduled
SELECT * FROM cron.job WHERE jobname = 'refresh-odds-hourly';