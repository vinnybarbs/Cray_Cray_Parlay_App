-- Lock-time reprice sweep (2026-08-10, owner decision, Option 4).
--
-- Every 30 minutes, re-check pending Play-tier moneyline picks starting
-- within 90 minutes against the current market. A pick whose side the
-- market has faded by a full implied point since pricing demotes to
-- Lean. Attacks the negative CLV measured in the 4-10pp band at its
-- mechanism, price staleness between analysis and first pitch.
-- Reuses the CRON_SECRET already embedded in the pre-analyze jobs.

DO $$
DECLARE
  secret text;
BEGIN
  SELECT substring(command FROM 'secret=([^&'']+)') INTO secret
  FROM cron.job WHERE jobname = 'pre-analyze-mlb' LIMIT 1;

  PERFORM cron.unschedule('reprice-pending-picks')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reprice-pending-picks');

  PERFORM cron.schedule(
    'reprice-pending-picks',
    '25,55 * * * *',
    format(
      $job$SELECT net.http_post(
        url:='https://craycrayparlayapp-production.up.railway.app/cron/reprice-pending-picks?secret=%s',
        headers:='{"Content-Type": "application/json"}'::jsonb,
        body:='{}'::jsonb
      );$job$, secret)
  );
END $$;
