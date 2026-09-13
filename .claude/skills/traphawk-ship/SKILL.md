---
name: traphawk-ship
description: How to safely build, test, migrate, deploy, and verify changes to the TrapHawk repo (Cray_Cray_Parlay_App). Use this for ANY code change, migration, PR, deploy, or "why isn't my change live" question on TrapHawk, even a one-line fix. It encodes the deploy pipeline (Railway auto-deploy from main), the test suite quirks, the migration gotchas that have silently broken production before, and the end-to-end verification pattern.
---

# Shipping TrapHawk changes

## The pipeline

Merge to `main` triggers Railway auto-deploy of the Express backend (2 to 4 minutes). The Vite frontend in root `src/` ships with it. There is no staging environment: main is production, so verification after deploy is part of every change, not optional.

## Build and test

- Run tests with `npx jest --forceExit`. The suite has a pre-existing open-handle leak and hangs forever without the flag. If `npx jest` fails outright, `npm install` first.
- Modules that require Supabase env at load time (for example build-house-parlays) cannot be required in a sandbox. Use `node --check <file>` for syntax validation instead.
- Never put `*/4`-style cron fragments inside a JS block comment. The `*/` terminates the comment. Write "every 4 hours" in words.

## Migrations

SQL files live in `supabase/migrations/` with `YYYYMMDDHHMMSS_name.sql` names. The file in the repo is documentation; production only changes when you apply it with the Supabase MCP `apply_migration` tool against project `pcjhulzyqmhrhsrgvwvx`. Do both, same content.

The gotcha that has bitten before: any DROP plus CREATE of `mv_public_record` (or any view or MV the site reads) loses its grants and silently zeroes every public stat. Always finish with:

```sql
GRANT SELECT ON public.mv_public_record TO anon, authenticated, service_role;
```

## Nothing changes in a vacuum (directive 22, the propagation table)

Every change moves every surface that sees it, BEFORE merge, and the PR body carries the filled-in row so a skipped surface shows in review. Find the row for what you changed and touch every surface on it:

| You changed | Move all of these |
|---|---|
| A dial value or a new dial | sport_dials row; model_weight_changes row with evidence; the dial list in traphawk-performance-review; the code default that mirrors it (DIAL_DEFAULTS, price-penalties, prop-edge, publish-markets); the Edge Anatomy dial board; the replay harness if the sweep should vary it |
| A rule, gate, fence or rail | directives (text, enforcement, check_sql); the traphawk-ops-check section that reads it; the code constant AND its client mirror (src/lib/tiers.js, src/lib/publish-flags.js); the mirror test in __tests__/lib |
| The formula or what a read is based on | directive 19 factor audit in the PR; band map regime reset and fit floor; traphawk-performance-review; Edge Anatomy chain and traces; lib/replay if a new dial must be replayable |
| A table, view or function | traphawk-data-model; every skill query that reads it; the tripwire or readiness function that should see it; the migration file in supabase/migrations AND applied to production |
| A cron job or routine | cron.job (secret stays there, never in the repo); traphawk-ops-check silent witnesses; the migration file |
| Anything user facing | the digest API payload, the DailyDigest render, the shadow and publish flags, the Edge Anatomy note |
| Anything at all | agent_reports row; the build_queue item opened or closed |

The mechanical half runs without you: `select * from public.doc_drift_findings()` reports an undocumented dial, a dead enforcement function or a broken directive check every morning (directive 22), and `__tests__/lib/drift.test.js` fails the build when a server constant and its client or SQL mirror disagree (shadow list, season floors, tier ladder, rail defaults) or a dial default is named in no skill.

## Branch and PR flow

Work on the session's designated claude/ branch. After a squash merge, the branch must be restarted from origin/main before new work (`git fetch origin main && git checkout -B <branch> origin/main`), then push with `--force-with-lease`. Never stack on merged history. PRs merge by squash.

## Sandbox limits (things that fail locally but work in production)

- ESPN APIs (site.api.espn.com, sports.core.api.espn.com) are blocked by the dev proxy. Code against recorded payload shapes, verify in prod.
- External APIs generally: test through mocked fetch, then verify live after deploy.

## File a build report

A session that ships anything substantive (new feature, data correction, calibration change, cost change) ends by writing one row to `agent_reports` with `agent = 'build-session'`: two or three sentences on what shipped and anything a scheduled review should know (for example "MLB spread picks voided retroactively, record moved, expect the spread bucket to look different this week"). This is how the scheduled workers stay on the same page without Vince ferrying context between chats.

## Post-deploy verification pattern

Do not declare a change live until you have production evidence. The standard loop:

1. Wait about 3 minutes after merge for Railway.
2. Trigger the relevant cron endpoint manually via SQL (secret extraction pattern is in the traphawk-data-model skill). A 404 like "Cannot POST /cron/x" usually means the deploy has not landed yet, wait and retry once.
3. Query the evidence: `cron_job_logs` for the run's details JSON, plus whatever table the change writes.
4. Report the actual numbers, not "should be working".

## LLM call sites

All Claude usage goes through `lib/services/claude.js` (MODELS map, WRITING_STYLE injection via `complete()`). New model calls: prefer `complete()`, and if you must use raw `messages.create`, import and include WRITING_STYLE in the system prompt. Narration cost logs into cron_job_logs at standard Sonnet rates. Any new recurring call site must log enough to be auditable (tokens or cost in cron_job_logs or agent_intel), because the monthly cost audit reconciles DB records against the Anthropic console.

## Base changes re-audit every factor (directive 19)

Any change to what a read is based on (the market anchor, the record blend, a new anchor source, a new sport model) lists every factor in the stack in the PR and says, per factor, whether the new base already prices it. A factor that prices the same thing as the base is a double count and comes off the anchored path before the change ships. The market anchor landed 2026-09-02 without this list, home advantage counted twice for ten days, and 36 of 47 anchor-era MLB moneyline picks went to the home side beating the close 22 percent of the time. After the deploy, run `select * from model_sanity_findings()` and confirm the anchored_mean_raw and side_balance wires stay quiet for the sport.

## Cost guardrails on changes

Before adding or re-scheduling any Claude-calling job, estimate its daily cost (calls per day times tokens times rate) and say the number out loud in the PR. The August 2026 audit traced a $7.60/day bill to unexamined defaults: a 3-hour re-narration clock, web search for data already synced, and uncached multi-turn search loops. New work should not reintroduce those patterns: cache multi-turn loops, gate regeneration on input change, and use a plain API when the task is a lookup rather than a judgment.
