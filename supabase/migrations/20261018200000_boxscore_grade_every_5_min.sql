-- Owner 2026-10-18 ("why are we stingy on refresh?"): NFL props settled
-- from the ESPN final box score only on the capture-prop-closes tick,
-- every 15 minutes, so a game that went final at :01 waited until :15.
-- This job runs the box score grade on the other five minute marks, so
-- a finished game settles within five minutes. Quiet runs (nothing
-- pending past kickoff) write no log row.
SELECT cron.schedule(
  'grade-nfl-props-boxscore',
  '5,10,20,25,35,40,50,55 0-3,12-23 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://craycrayparlayapp-production.up.railway.app/cron/analyze-nfl-props?mode=boxscore&secret=' ||
      (SELECT substring(command FROM 'secret=([^&]+)') FROM cron.job WHERE jobname = 'pre-analyze-mlb' LIMIT 1),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) as request_id;
  $cmd$
);
