-- Enable pg_cron extension (one-time setup in Supabase SQL Editor)
create extension if not exists pg_cron;

-- Grant permissions to the postgres user
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- Create table to log cron run attempts (optional but recommended)
create table if not exists cron_runs (
  id uuid primary key default gen_random_uuid(),
  cron_id text,
  scheduled_time timestamptz,
  executed_at timestamptz default now(),
  success boolean,
  response jsonb,
  error_message text,
  duration_ms integer
);

create index idx_cron_runs_scheduled on cron_runs(scheduled_time desc);

-- Schedule the Edge Function to run every hour
-- Replace YOUR_PROJECT_REF with your actual project reference
select cron.schedule(
  'refresh-odds-hourly',                    -- job name
  '0 * * * *',                              -- cron expression (every hour at :00)
  $$
  select
    net.http_post(
      url := 'https://YOUR_PROJECT_REF.functions.supabase.co/functions/v1/refresh-odds',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'  -- Use service role key with elevated permissions
      ),
      body := '{}',
      timeout_milliseconds := 300000  -- 5 minute timeout
    ) as request_id;
  $$
);

-- Alternatively, schedule every 6 hours (to reduce API quota usage):
-- select cron.schedule(
--   'refresh-odds-6-hourly',
--   '0 */6 * * *',
--   ... (same body)
-- );

-- Or schedule every 30 minutes (for fresh odds):
-- select cron.schedule(
--   'refresh-odds-30-min',
--   '*/30 * * * *',
--   ... (same body)
-- );

-- To view scheduled jobs:
select * from cron.job;

-- To disable a job temporarily:
-- select cron.unschedule('refresh-odds-hourly');

-- To remove a job permanently:
-- select cron.unschedule('refresh-odds-hourly');

-- Monitor cron job execution:
-- Supabase Dashboard → Logs → Edge Functions Logs
-- Or query your app logs if you're logging invocations

-- Optional: Create a trigger to log cron_runs (if you want to track manually):
-- After running this SQL, update your Edge Function to include a webhook/log call,
-- or query function_logs from Supabase.
