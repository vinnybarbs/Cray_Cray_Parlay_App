-- Schedule daily player stats refresh at 8am
-- Fetches recent stats for players with active prop odds

-- Enable pg_net extension if not already enabled (for invoking Edge Functions)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop existing schedule if it exists
SELECT cron.unschedule('refresh-player-stats-daily');
SELECT cron.unschedule('refresh-player-stats-morning');

-- Schedule for 8:00 AM daily (after games complete overnight)
SELECT cron.schedule(
  'refresh-player-stats-morning',
  '0 8 * * *', -- Every day at 8:00 AM
  $$
  SELECT
    net.http_post(
      url:='https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/refresh-player-stats',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb,
      body:='{"automated": true}'::jsonb
    ) AS request_id;
  $$
);

-- Verify the schedule
SELECT jobname, schedule, active, command
FROM cron.job
WHERE jobname LIKE '%player-stats%'
ORDER BY jobname;

COMMENT ON SCHEMA cron IS 'Daily player stats refresh scheduled at 8am';
