-- build-house-parlays ran at 10:45, 15:45 and 19:45 UTC, and the 15:45
-- slot (09:45 MT) is the same minute pre-analyze-mlb writes the day's
-- MLB picks, so the builder read an empty pick pool one second before
-- it filled (2026-09-09 run: pool 3, pick_candidates 2). Move every
-- build 13 minutes behind the analysis slots.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'build-house-parlays'),
  schedule := '58 10,15,19 * * *'
);
