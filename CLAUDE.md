# TrapHawk (traphawk.io)

Sports betting research model. Node/Express server.js on Railway (auto
deploys from main in 2 to 4 minutes), Vite/React frontend in src/,
Supabase Postgres project pcjhulzyqmhrhsrgvwvx (pg_cron fires Railway
/cron/* endpoints via pg_net). Tests:
`SUPABASE_URL=https://example.supabase.co SUPABASE_SERVICE_ROLE_KEY=dummy npx jest --forceExit`.

## Shared state lives in the database, not in chat

Chat is not memory. Before changing model behavior, read these four
tables; after any significant change, write the relevant ones:

- `directives`: the standing owner decisions, dated, with enforcement
  and compliance checks. Never silently contradict an active directive;
  propose changing it instead. The daily ops check runs every
  check_sql.
- `sport_dials`: every tunable factor weight, per sport. Weight changes
  happen HERE (plus a `model_weight_changes` row with evidence), never
  as silent constant edits. Moves follow the three test counterfactual
  protocol in the performance review skill.
- `build_queue`: the running to-do and decision list. Keep it current
  when work starts, finishes, or is discovered.
- `agent_reports`: the blackboard. File a report after every
  significant change. No analysis that reports only to one person.

## Per change pipeline

The traphawk-ship skill is authoritative: test, migrate (repo file AND
apply to production), commit, PR, squash merge, reset the working
branch onto origin/main, verify live behavior, file the blackboard row.
Migrations that changed production must exist in supabase/migrations.

## Hard rules

- Grades never auto re-flip. Regrades only via the allow_regrade
  transaction plus a cron_job_logs entry. The frozen cohort
  (resolved_at 2026-08-09 12:13:08.323644-06, 529 rows) is untouchable.
  No ledger modifications to picks with game_date before 2026-07-01.
- All public record numbers come from mv_public_record only.
- When a change alters how edge claims are GENERATED, the band
  calibration is a new regime: reset affected maps to identity and
  advance the fit floor (see directives).
- Secrets (API keys) never enter the repo or committed content.
- Plain punctuation in all prose, including commit messages and UI
  copy: no em dashes, en dashes, semicolons, or arrows.
