-- Every public surface now reads mv_public_record (the landing page via
-- /api/public-stats, the ledger headline aggregates via
-- /api/public-ledger), but the rollup only refreshed at 0:10 and 6:10
-- while settlements land all day: check-parlays every 2 hours at :40,
-- house parlay settlement hourly at :20, and the daily safety net at
-- 6:15. Refresh hourly at :50, after the settlement windows, so every
-- surface on the site moves together within the hour. The hourly job
-- replaces the two daily ones. refresh_mv_model_accuracy() refreshes
-- both mv_model_accuracy and mv_public_record concurrently.
SELECT cron.unschedule('refresh_mv_model_accuracy_morning');
SELECT cron.unschedule('refresh_mv_model_accuracy_midnight');
SELECT cron.schedule(
  'refresh_public_rollups_hourly',
  '50 * * * *',
  'SELECT public.refresh_mv_model_accuracy();'
);
