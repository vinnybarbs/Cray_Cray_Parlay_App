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
-- This will call your deployed refresh-odds function automatically
select cron.schedule(
  'refresh-odds-hourly',                    -- job name
  '0 * * * *',                              -- cron expression (every hour at :00)
  $$
  select
    net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-odds',
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
select * from cron.job where jobname = 'refresh-odds-hourly';
