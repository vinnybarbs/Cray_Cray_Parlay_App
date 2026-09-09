# TrapHawk cloud routines

The three scheduled analysts. Each is a Claude Code Remote Routine that
fires a fresh cloud session. The goal state is that every routine
clones this repository on main at fire time and reads its skill from
`.claude/skills` in the checkout, so a merged skill change is live at
the next firing with no account skill save and nothing for the owner
to remember.

## Why they must be created from the claude.ai Routines UI

A routine created from inside a Claude Code session cannot carry a
Supabase connector or a repository source (verified 2026-09-09, the
tool refuses connectors and stores no sources). A routine created in
the Routines UI can carry both. So the owner creates each routine once
in the UI with these settings, and from then on the repo is the sync.

## Settings for all three

- Source: repository `vinnybarbs/Cray_Cray_Parlay_App`, branch `main`.
- Connector: Supabase (project pcjhulzyqmhrhsrgvwvx). Nothing else.
- Model: Claude Opus 5 (matches the routines these replace).
- Notifications: push on, email off.
- Fresh session per firing.
- Prompt: the full text of the matching file in this folder, verbatim.

| Routine | Prompt file | Cron (UTC) | Local (MDT) |
|---|---|---|---|
| TrapHawk daily ops check | daily-ops-check.md | `0 14 * * *` | 08:00 daily |
| TrapHawk weekly calibration review | weekly-calibration-review.md | `0 12 * * 1` | 06:00 Mondays |
| TrapHawk monthly API cost audit | monthly-cost-audit.md | `0 15 2 * *` | 09:00 on the 2nd |

Cron is UTC. After 2026-11-01 (MST) shift each one hour later (`0 15`,
`0 13`, `0 16`) to hold the local times, and reverse it in March.

## Cutover

1. Create the three new routines in the UI from these files.
2. Fire the new daily one once by hand and confirm it files an
   agent_reports row as ops-check that mentions reading the skill from
   the checkout.
3. The code shipping session then disables (never deletes) the three
   originals: trig_015qoYxVhMJyekxCgUaV1atQ, trig_01XdGMb6AvwbjCHJWNGJPTFn,
   trig_01LP5t3AcowYb1vXr7XSNdCW.
4. Record the new trigger ids in docs/CLAUDE_PROJECT_SETUP.md section 5.

Until the cutover, the originals keep running on the account skill
copies, and their prompts already carry the directives-first and dial
board procedure directly, so a lagging skill copy costs polish, not
correctness.
