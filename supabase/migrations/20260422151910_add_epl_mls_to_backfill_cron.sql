-- supabase/migrations/20260422151910_add_epl_mls_to_backfill_cron.sql
-- The backfill-game-results-daily pg_cron job was calling the Railway endpoint
-- with sports=NBA,NCAAB,NFL,NHL,MLB — EPL and MLS were silently excluded.
-- Result: 51 EPL + 120 MLS picks stuck pending forever because game_results
-- had zero soccer rows for settle_ai_suggestions() to match against.
--
-- The Railway endpoint (api/cron/backfill-game-results.js) ALREADY supports
-- both EPL and MLS via its SPORT_PATHS map (soccer/eng.1 and soccer/usa.1).
-- This migration just adds them to the cron URL.

-- cron.schedule errors if the jobname already exists, so unschedule first.
SELECT cron.unschedule('backfill-game-results-daily');

SELECT cron.schedule(
  'backfill-game-results-daily',
  '0 5 * * *',
  $$
    SELECT net.http_post(
        url := 'https://craycrayparlayapp-production.up.railway.app/cron/backfill-game-results?secret=ICPJObr8saKs%2Blg8fNALQRwe9CxvV%2FDw2TzrahsQXio%3D&days=2&sports=NBA,NCAAB,NFL,NHL,MLB,EPL,MLS',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
    ) as request_id;
  $$
);
