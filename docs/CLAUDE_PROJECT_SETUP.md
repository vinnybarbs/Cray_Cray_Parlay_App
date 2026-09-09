# TrapHawk Claude Project Setup

The complete kit for the TrapHawk.io Claude desktop project. Everything
here is versioned in the repo on purpose: the repo is the source of
instructions, the database is the source of state, and nothing else is
a source. When this file and a project setting disagree, fix the project.

## 1. Folder selection

The project's one context folder is a clean clone of this repository,
checked out on `main`, at a stable path with no spaces, for example
`~/Projects/Cray_Cray_Parlay_App`. Rules:

- One clone. Not a copy inside a synced cloud folder (iCloud, Dropbox,
  OneDrive), those rewrite files under git and break pulls.
- Nothing else in the folder. No personal notes, no downloads, no second
  checkout.
- The clone must track `origin/main`. The project's shell cannot modify
  or delete existing files in the folder (verified 2026-09-09), which is
  a feature: the project can never edit code or skills. It also means
  the project cannot `git pull`. YOU run the pull, from a terminal,
  before starting project work, and the project verifies freshness and
  stops if the folder is behind. The owner's pull is:
  `cd ~/GHRepositories/Cray_Cray_Parlay_App && rm -f .git/index.lock && git pull`.
- The `.claude/skills` directory in the clone is what the project runs.
  Skills are updated only through pull requests, never edited in the
  clone.

Verify with the prompt in section 6 before scheduling anything.

## 2. Connectors

- Supabase MCP connected to project `pcjhulzyqmhrhsrgvwvx`, read access
  is all the analysts need. The code shipping session holds write
  access; the project does not need it and should not have it.
- GitHub is optional for the project. Analysts do not open pull
  requests.

## 3. Project instructions (paste verbatim)

You are a read-only analyst for TrapHawk (traphawk.io). All state lives
in Supabase project pcjhulzyqmhrhsrgvwvx, never in memory files or prior
chats. Before any analysis, read the active directives (select id,
directive, enforcement from directives where status = 'active') and the
blackboard (agent_reports, last 14 days). Never contradict an active
directive; propose changing it by id. The dial board (sport_dials), the
build queue (build_queue), and the public record (mv_public_record only,
never raw arithmetic over ai_suggestions) are the sources for weights,
work, and results. You never change code or data; your only write is
your own agent_reports row at the end of every run, and every scheduled
run must file one. Code and data changes go to the code shipping session
through the build queue or the blackboard. Follow the repo skills in
.claude/skills exactly. At the start of every chat run git fetch origin
and git status -uno in the project folder; if the folder is behind
origin/main or not on main, stop and ask me to run the pull myself,
never attempt to pull, modify, or delete files in the folder. The
scheduled analysts are cloud Routines outside this project; never
create schedules here. When repo skills change, package them and ask
me to confirm the account save. Plain punctuation in everything you
write: no em dashes, en dashes, semicolons, or arrows.

## 4. Memory (the only file, paste verbatim as MEMORY.md)

TrapHawk state is never remembered here. Query it: directives,
sport_dials, build_queue, agent_reports, mv_public_record. Instructions
live in the repo skills. If anything in memory disagrees with the
database, the database is right.

Do not create per topic memory files. The old project accumulated seven
traphawk_*.md files that all went stale within a week.

## 5. The scheduled analysts are cloud Routines, not project schedules

The three TrapHawk analysts run as Claude Code Remote Routines: fresh
cloud sessions with the account skills and the Supabase connector and
no repository folder at all. They are NOT project schedules, the
project's Scheduled panel stays empty on purpose, and they must never
be recreated inside the project. Manage them through the Claude Code
Remote connector (list_triggers, update_trigger), by id:

| Routine | Trigger id | Cron (UTC) | Local (MDT) |
|---|---|---|---|
| TrapHawk daily ops check | trig_015qoYxVhMJyekxCgUaV1atQ | `0 14 * * *` | 08:00 daily |
| TrapHawk weekly calibration review | trig_01XdGMb6AvwbjCHJWNGJPTFn | `0 12 * * 1` | 06:00 Mondays |
| TrapHawk monthly API cost audit | trig_01LP5t3AcowYb1vXr7XSNdCW | `0 15 2 * *` | 09:00 on the 2nd |

Each prompt invokes its skill by name and files exactly one
agent_reports row. Cron is UTC and does not follow Mountain time: after
2026-11-01 (MST, UTC-7) shift each schedule one hour later (`0 15`,
`0 13`, `0 16`) to hold the same local times, and reverse it in March.
Full history in docs/SCHEDULED.md.

How the repo reaches them: the routines cannot attach a repository, but
they all have Supabase, so every Railway deploy of main upserts each
`.claude/skills/*/SKILL.md` into the `skills` table and each routine
loads its skill from that table by name. The deploy is the sync
(directive 15, verified by the ops check every morning). Nothing about
a routine is created or edited in a UI; the code shipping session
updates their prompts from docs/routines through the Claude Code
Remote connector whenever a prompt file changes.

## 5b. Skills reach the desktop project through the folder

The routines no longer depend on the account skill copies. The desktop
project reads the same `.claude/skills` files from its folder, kept
current by the owner's pull. Confirming a "Skills update verification"
save is optional polish for ad hoc chats, never a prerequisite for
anything scheduled.

## 5b. How skills reach the routines

The routines load skills from the ACCOUNT skills folder, not from the
repo. The chain is: a skill changes in `.claude/skills` through a pull
request; the desktop project packages the changed skills and opens a
"Skills update verification" chat asking you to confirm the save to
your account; until you confirm, every routine runs the previous
version. Confirm every skills save the same day it appears. The
packaged `.skill` files are derived artifacts and are not committed to
the repo; `.claude/skills` is the only source.

The project itself has three jobs and no schedules: packaging skill
updates for your confirmation, ad hoc analysis chats against the same
four tables the routines use, and the status board.

## 6. First chat in the new project: verification prompt (paste verbatim)

Verify this project is set up correctly and report each line as PASS or
FAIL with the evidence. Do not pull, modify, or delete anything in the
folder; if it is behind, that is a FAIL I fix myself. In the project
folder run: git rev-parse --abbrev-ref HEAD (must be main); git fetch
origin and git status -uno (must be clean and not behind); git remote get-url origin (must be the
vinnybarbs/Cray_Cray_Parlay_App repository); ls .claude/skills (must list
traphawk-cost-audit, traphawk-data-model, traphawk-ops-check,
traphawk-performance-review, traphawk-ship, traphawk-status-board);
confirm the folder path has
no spaces and is not inside a cloud synced directory. Then through the
Supabase connector run select count(*) from directives where status =
'active' (must be at least 13), select count(*) from sport_dials (must be
at least 70), select max(created_at) from agent_reports (must be within
the last 2 days), and select 1 from mv_public_record limit 1. Finish
with one line: READY or NOT READY and what to fix.

## 7. The status board is a skill

There is no saved prompts panel in the project, and a prompt would be
one more copy of instructions outside the repo. The status board is the
repo skill `.claude/skills/traphawk-status-board`, which the project
packages for your account save like every other skill. Once saved, say
"status board" in any chat and it runs the four panels: the standing
directives, the blackboard, the build queue, and the dial board with
recent weight moves. It writes nothing.

## 8. What the old project got wrong, so it is not repeated

- Memory files duplicated database state and rotted within days.
- Project instructions were one line about writing style and did not
  encode the operating model.
- Three local Claude Code routines duplicated the project schedules and
  reported only to the owner, invisible to the blackboard.
- Nothing enforced that the clone was on main before a chat, and a
  month of uncommitted code sat on a side branch in the folder.
- The three analysts were assumed to be project schedules; they are
  cloud Routines and were never missing. Skill updates reach them only
  through the account save, which sat unconfirmed.
