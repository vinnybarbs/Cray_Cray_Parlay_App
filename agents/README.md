# TrapHawk routine briefs

One file per cloud routine, each holding that routine's complete brief.
The routine itself (a Claude Code Remote Routine, managed by trigger id
through the Claude Code Remote connector) carries a one line prompt
that names its brief and says to read it first and follow it exactly.
Everything the routine does, in what order, what it may write and how
it reports is in the brief, so the brief is the only thing that ever
needs editing. Arrangement borrowed from Aloe on 2026-10-09.

## How a brief reaches a routine

The analysis routines (ops check, calibration review, cost audit) run
as fresh cloud sessions with the Supabase connector and no repository
checkout. The repo still reaches them: every Railway deploy of main
upserts every file here into the `skills` table as row `agents/<file>`
(lib/services/skill-sync.js at server start, and /cron/sync-skills on
demand), next to the `.claude/skills/*/SKILL.md` rows and the
`AGENTS.md` row. The routine's one line prompt loads its brief with
`select content from skills where name = 'agents/<file>'`. The deploy
is the sync: a merged brief change is live at the next firing with no
UI edit and nothing for the owner to remember. Directive 15 covers it
and the ops check verifies the table every morning.

The exec assistant routine fires in the code environment with the
repository and the Supabase connector attached to its trigger in the
claude.ai routines UI (create_trigger could not attach either in this
organization on 2026-10-09). Its prompt reads agents/exec-assistant.md
from the checkout first and falls back to the same skills row.

## One voice to the owner

The exec assistant is the only routine that writes to the owner (owner
2026-10-09). The ops check, the calibration review and the cost audit
report to the blackboard and the exec assistant reads them there, ships
what is code, and brings the owner one phone sized message a day: the
record, what shipped, what the machine found, and the choices that are
his, each with the number it rests on and a recommendation. A choice
stays on that list every day until he answers it. Notifications on the
three analysis routines are turned off in the routines UI so the one
message is the only one.

A routine whose brief row is missing, or whose Supabase tools are
absent, stops and says so loudly instead of guessing. That line is in
every prompt and every brief.

## The schedule

| Routine | Trigger id | Brief | Cron | Local (MDT) | Model | Writes |
|---|---|---|---|---|---|---|
| TrapHawk daily ops check | trig_015qoYxVhMJyekxCgUaV1atQ | daily-ops-check.md | `0 14 * * *` UTC | 08:00 daily | Opus | one agent_reports row |
| TrapHawk exec assistant | trig_01XJzYU2KWVus6U9YWWz5zHb | exec-assistant.md | `57 8 * * *` America/Denver | 08:57 daily | Opus | code through the ship pipeline, build_queue, one agent_reports row, the one daily message to the owner |
| TrapHawk weekly calibration review | trig_01XdGMb6AvwbjCHJWNGJPTFn | weekly-calibration-review.md | `0 12 * * 1` UTC | 06:00 Mondays | Opus | one agent_reports row |
| TrapHawk monthly API cost audit | trig_01LP5t3AcowYb1vXr7XSNdCW | monthly-cost-audit.md | `0 15 2 * *` UTC | 09:00 on the 2nd | Opus | one agent_reports row |

The three analysis routines are read only apart from their one row
(directive 13). The exec assistant is the code shipping session: it ships
the asks the analysis routines filed and never decides what is the
owner's (dials, directives, regrades, sweep candidates, publish flags).

Three of the four crons are UTC and do not follow Mountain time. After
2026-11-01 (MST, UTC-7) shift the daily ops check, the weekly and the
monthly one hour later (`0 15`, `0 13`, `0 16`) to hold the local
times, and reverse it in March. The exec assistant carries its own time
zone and needs no shift.

Nothing shares a window. The ops check finishes by about 08:15 MT and
the exec assistant starts at 08:57 MT so it reads a finished ops row. Two
TrapHawk sessions in the same window read each other's half written
agent_reports state, so check this table before adding a fifth.

## The one line prompts

Each trigger's prompt is exactly this shape, with its own name, file
and summary of what the brief holds:

"You are the TrapHawk daily ops check (repository
vinnybarbs/Cray_Cray_Parlay_App, Supabase project pcjhulzyqmhrhsrgvwvx).
Your full brief is the repository file agents/daily-ops-check.md,
synced into the skills table on every deploy. Load it first with the
Supabase MCP execute_sql tool: select content from skills where name =
'agents/daily-ops-check.md'. Read it in full and follow it exactly: it
holds which skill to load, the directive sweep, the window, the one row
you may write and the report format. If the row is missing or empty, or
the Supabase MCP tools are unavailable, stop and say so loudly in your
final message instead of guessing."

Schedule, model, notifications, allowed tools and MCP connections live
on the trigger and are changed through update_trigger by id, never by
recreating the routine (recreation loses the attached connectors and
the run history).

## Editing rules

- Facts about the stack (model names, tiers, file paths, table and
  column names, cron names and times, dial names, trigger ids, feature
  claims) may be corrected by anyone, the exec assistant's fact sweep
  included, with the evidence in the pull request.
- Mission, schedule, deliverable format, writing rules and safety rules
  change only by a deliberate commit from the owner. A routine that
  finds one of those wrong says so in its report and leaves it alone.
- A brief is edited here and only here. Never in the routines UI, never
  in the desktop app, never in a chat. Directive 15.
- Plain business English. No em dashes, en dashes, semicolons, dramatic
  colons, arrows or AI filler, in the briefs, the prompts, the
  blackboard rows or the reports they produce.
- Every brief ends by filing exactly one agent_reports row (columns
  agent, summary, findings) that begins with the words "skills from
  supabase", so the blackboard shows which source it ran on.

## Telling which build is serving

Every server start writes one cron_job_logs row, job_name server-start,
whose details carry the Railway commit sha, branch and deployment id:
`select created_at, details from cron_job_logs where job_name = 'server-start' order by created_at desc limit 3`.
That is the deploy witness. Compare the commit against the latest main
merge. A server-start older than the merge by more than 30 minutes is a
finding for the ops check. The skills table synced_at is secondary (its
start sync is best effort with retries). POST /cron/sync-skills with
the cron secret re-syncs skills and briefs from whatever build is
serving.
