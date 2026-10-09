-- 2026-10-09 (owner): the daily build routine becomes the exec assistant,
-- the one voice to the owner. Brief file agents/exec-assistant.md, agent
-- name exec-assistant on the blackboard, same trigger and schedule.
update directives
set check_sql = $sql$select name, synced_at from skills where synced_at < now() - interval '14 days' union all select 'missing: ' || s as name, null from unnest(array['traphawk-ops-check','traphawk-performance-review','traphawk-cost-audit','traphawk-data-model','traphawk-ship','traphawk-status-board','AGENTS.md','agents/README.md','agents/daily-ops-check.md','agents/exec-assistant.md','agents/weekly-calibration-review.md','agents/monthly-cost-audit.md']) s where s not in (select name from skills)$sql$
where id = 15;

update build_queue
set detail = detail || ' RENAMED 2026-10-09: the daily build is the exec assistant (agents/exec-assistant.md, agent exec-assistant, trigger trig_01XJzYU2KWVus6U9YWWz5zHb unchanged). Owner attached the repository and the Supabase connector in the routines UI and set Opus, two dry runs passed. Notifications on the three analysis routines are the owner''s to turn off in the routines UI so the exec assistant is the one message.',
    updated_at = now()
where id = 87;
