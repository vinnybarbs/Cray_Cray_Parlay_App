-- Retire golf notes (owner 2026-10-11, build_queue 92, plan decision 13).
-- The analyze-golf job (10:30, 16:30 and 22:30 UTC) is unscheduled and its
-- route is removed from server.js in the same change. golf_field keeps its
-- rows as history and the digest shows only rows from the last 4 days.
-- A cron_job_logs row from analyze-golf after this date is an ops finding.
select cron.unschedule('analyze-golf')
where exists (select 1 from cron.job where jobname = 'analyze-golf');
