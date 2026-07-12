-- Machine-built parlays: build twice daily after the morning and afternoon
-- pre-analyze waves, settle hourly off the legs' outcomes. Both endpoints
-- are idempotent, so extra firings are harmless.

select cron.schedule(
  'build-house-parlays',
  '45 15,19 * * *',  -- 9:45am and 1:45pm Denver (MDT)
  $$
  SELECT net.http_post(
    url := 'https://craycrayparlayapp-production.up.railway.app/cron/build-house-parlays',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 120000
  ) as request_id;
  $$
);

select cron.schedule(
  'settle-house-parlays',
  '20 * * * *',  -- hourly, after the pick-outcome checkers have run
  $$
  SELECT net.http_post(
    url := 'https://craycrayparlayapp-production.up.railway.app/cron/settle-house-parlays',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 120000
  ) as request_id;
  $$
);
