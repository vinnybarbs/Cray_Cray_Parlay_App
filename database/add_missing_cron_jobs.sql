-- Add missing parlay outcome checker cron job
-- Run this in Supabase SQL Editor

-- Schedule parlay outcome checking every 30 minutes
SELECT cron.schedule(
    'check-parlay-outcomes-30min',
    '*/30 * * * *',
    $$
    SELECT net.http_post(
        url:='https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/check-parlay-outcomes',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
    $$
);

-- Update stats sync frequency from daily to 4x daily (1am, 7am, 1pm, 7pm)
SELECT cron.unschedule('daily-sports-stats-sync');

SELECT cron.schedule(
    'sync-sports-stats-6-hourly', 
    '0 1,7,13,19 * * *',
    $$
    SELECT net.http_post(
        url:='https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/sync-sports-stats',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
    $$
);