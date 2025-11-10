-- Setup cron jobs for sync-sports-stats Edge Function
-- This schedules team/player stats refresh every 6 hours
-- Run this in your Supabase SQL Editor

-- Schedule stats sync every 6 hours (at 1:00, 7:00, 13:00, 19:00)
-- Less frequent than odds since team stats change less often
select cron.schedule(
  'sync-sports-stats-6-hourly',             -- job name
  '0 1,7,13,19 * * *',                      -- cron expression (every 6 hours starting at 1 AM)
  $$
  select
    net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/sync-sports-stats',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
      ),
      body := '{}',
      timeout_milliseconds := 600000  -- 10 minute timeout (stats take longer)
    ) as request_id;
  $$
);

-- Verify the job was scheduled
select * from cron.job where jobname = 'sync-sports-stats-6-hourly';