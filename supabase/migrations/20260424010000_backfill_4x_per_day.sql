-- Bump backfill-game-results from 1x/day (05:00 UTC) to 4x/day (every 6h).
-- Motivation: user-facing tiles would show stale records for up to 24h after
-- a completed game. team_latest_record is sourced from game_results metadata,
-- so game_results freshness directly drives how quickly the fallback path
-- catches up. Staggered 30 min past the hour to avoid colliding with
-- sync-standings (which fires at :00).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'backfill-game-results-daily') THEN
    PERFORM cron.unschedule('backfill-game-results-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'backfill-game-results-6h',
  '30 */6 * * *',
  $$
    SELECT net.http_post(
      url := 'https://craycrayparlayapp-production.up.railway.app/cron/backfill-game-results?secret=ICPJObr8saKs%2Blg8fNALQRwe9CxvV%2FDw2TzrahsQXio%3D&days=2&sports=NBA,NCAAB,NFL,NHL,MLB,EPL,MLS',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) AS request_id;
  $$
);
