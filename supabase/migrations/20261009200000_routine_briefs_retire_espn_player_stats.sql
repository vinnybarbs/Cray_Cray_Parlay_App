-- 2026-10-09: routine briefs live in the repo under agents/ (the Aloe
-- arrangement), and the ESPN box score cacher is retired.
--
-- 1. sync-nfl-player-stats never wrote a row in its life: it fetched the
--    raw ESPN summary and then checked for an array, so players_cached
--    was 0 on every run while the status said completed. nflverse
--    (sync-nflverse-player-stats, Tuesdays) is the settlement truth and
--    the only NFL stat line writer. The route and file are gone from the
--    repo in the same change, so the cron job goes too.
select cron.unschedule(jobid) from cron.job where jobname = 'sync-nfl-player-stats';

-- 2. Directive 15 extends to the briefs: one file per routine under
--    agents/, synced to the skills table as agents/<file>, loaded by a
--    one line trigger prompt. Amended, not contradicted.
update directives
set directive = 'Skills are edited only in the repo under .claude/skills, and the cloud routine briefs only in the repo under agents/. Every deploy syncs both into the skills table (a skill by its name, a brief as agents/<file>), each routine prompt is one line that loads its brief from that table, and nothing about a skill or a brief is ever typed into the desktop app or the routines UI.',
    enforcement = 'lib/services/skill-sync.js at server start and /cron/sync-skills (skills, AGENTS.md and agents/*.md). Each trigger prompt is one line that selects its agents/<file> row. __tests__/lib/skill-sync.test.js pins the brief rows. This check.',
    check_sql = $sql$select name, synced_at from skills where synced_at < now() - interval '14 days' union all select 'missing: ' || s as name, null from unnest(array['traphawk-ops-check','traphawk-performance-review','traphawk-cost-audit','traphawk-data-model','traphawk-ship','traphawk-status-board','AGENTS.md','agents/README.md','agents/daily-ops-check.md','agents/daily-build.md','agents/weekly-calibration-review.md','agents/monthly-cost-audit.md']) s where s not in (select name from skills)$sql$
where id = 15;

-- 3. The queue.
update build_queue
set detail = detail || ' RESOLVED 2026-10-09: sync-nfl-player-stats retired (cron job unscheduled, route and file removed). It never cached a row, the job fetched the raw ESPN summary and checked for an array. nflverse (sync-nflverse-player-stats) is the settlement truth and the only NFL stat line writer, so the props pipeline loses nothing.',
    updated_at = now()
where id = 6;

insert into build_queue (title, detail, priority, status)
values (
  'Routine briefs in the repo under agents/, one line trigger prompts',
  'DONE 2026-10-09 (owner, the Aloe arrangement). agents/daily-ops-check.md, daily-build.md, weekly-calibration-review.md, monthly-cost-audit.md and README.md sync into the skills table as agents/<file> on every deploy. The four triggers carry one line prompts that load their brief. The daily build brief sweeps agents/*.md and .claude/skills against the code for facts only. Directive 15 amended. Open: the daily build trigger (trig_01XJzYU2KWVus6U9YWWz5zHb) has no MCP connections because create_trigger could not attach connectors in this organization, so the owner attaches Supabase and Claude Code Remote to it in the routines UI.',
  'medium', 'done'
);
