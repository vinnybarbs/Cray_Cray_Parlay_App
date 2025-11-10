-- Setup cron jobs for refresh-sports-intelligence Edge Function (news)
-- This schedules news refresh every 2 hours
-- Run this in your Supabase SQL Editor

-- Schedule news refresh every 2 hours (at :15 past the hour)
-- Offset from odds refresh to avoid API rate limit conflicts
select cron.schedule(
  'refresh-sports-intelligence-2-hourly',   -- job name
  '15 */2 * * *',                          -- cron expression (every 2 hours at :15)
  $$
  select
    net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-sports-intelligence',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
      ),
      body := '{}',
      timeout_milliseconds := 300000  -- 5 minute timeout
    ) as request_id;
  $$
);

-- Verify the job was scheduled
select * from cron.job where jobname = 'refresh-sports-intelligence-2-hourly';