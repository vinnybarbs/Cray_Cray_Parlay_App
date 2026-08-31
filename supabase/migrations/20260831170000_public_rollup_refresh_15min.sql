-- Public rollup refresh: hourly to every 15 minutes.
--
-- Settlement is already event driven (trg_settle_on_game_results grades
-- picks the moment a final lands in game_results), but every public
-- percentage reads mv_public_record, which refreshed on a fixed hourly
-- clock at :50. That gap was the only delay between a settled pick and
-- the posted win rate: worst case 59 minutes of a graded outcome showing
-- in the feeds while the headline number stood still (owner question
-- 2026-08-31, and the "settlement to posted win % feels delayed"
-- instinct behind it).
--
-- Both MV refreshes complete in well under a second at current table
-- size, so four runs an hour cost nothing. The :50 slot is kept so the
-- cadence change is invisible to anything aligned to the old schedule.
-- Webhook-per-row refresh was considered and rejected: settlement grades
-- dozens of rows per pass, REFRESH CONCURRENTLY cannot run inside the
-- trigger's transaction, and a debounced HTTP hop buys at most 14 more
-- minutes on a page nobody watches live.
--
-- cron.schedule with an existing jobname updates the schedule in place.
SELECT cron.schedule(
  'refresh_public_rollups_hourly',
  '5,20,35,50 * * * *',
  'SELECT public.refresh_mv_model_accuracy();'
);
