# TrapHawk cloud routines

The three scheduled analysts. Each is a Claude Code Remote Routine that
fires a fresh cloud session with the Supabase connector and no
repository. The repo still reaches them: every Railway deploy of main
upserts each `.claude/skills/*/SKILL.md` into the `skills` table
(lib/services/skill-sync.js at server start, and /cron/sync-skills on
demand), and each routine reads its skill from that table by name. The
deploy is the sync. A merged skill change is live at the next firing
with no account skill save, no UI edit, and nothing for the owner to
remember. Directive 15 enforces it and the ops check verifies the
table every morning.

Nothing about these routines is created or edited in a UI once set up.
The code shipping session updates their prompts through the Claude
Code Remote connector (update_trigger) whenever a prompt file here
changes, in the same ship as the change.

| Routine | Trigger id | Prompt file | Cron (UTC) | Local (MDT) |
|---|---|---|---|---|
| TrapHawk daily ops check | trig_015qoYxVhMJyekxCgUaV1atQ | daily-ops-check.md | `0 14 * * *` | 08:00 daily |
| TrapHawk weekly calibration review | trig_01XdGMb6AvwbjCHJWNGJPTFn | weekly-calibration-review.md | `0 12 * * 1` | 06:00 Mondays |
| TrapHawk monthly API cost audit | trig_01LP5t3AcowYb1vXr7XSNdCW | monthly-cost-audit.md | `0 15 2 * *` | 09:00 on the 2nd |

Cron is UTC. After 2026-11-01 (MST) shift each one hour later (`0 15`,
`0 13`, `0 16`) to hold the local times, and reverse it in March.

Each routine files exactly one agent_reports row and begins it with
"skills from supabase" so the blackboard shows which skill source it
ran on. The account skill copies and the desktop project's skills save
no longer matter to the routines; the desktop project reads the same
files from its folder.
