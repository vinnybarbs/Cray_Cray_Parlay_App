---
name: traphawk-ops-check
description: Daily operational health check for TrapHawk production. Run this whenever the user asks to check on the site, review the routines, see if the crons ran, whether anything failed overnight, "how are things looking", or any scheduled morning ops sweep. Also trigger it when something seems stuck (record frozen, no picks today, stale analyses) before diving into code, because most incidents show up in these queries first.
---

# TrapHawk daily ops check

Read-only sweep of production (Supabase project `pcjhulzyqmhrhsrgvwvx`, use the `execute_sql` tool). Do not change code or data during the check, report findings and propose fixes separately (the one exception is filing your own report at the end). Lead the report with ALL CLEAR or the problems in severity order. The tier definitions and table shapes are in the traphawk-data-model skill.

## 0. Read the blackboard first

`agent_reports` is the shared memory of every digital worker (reviews, audits, build sessions, prior ops checks). Read it before anything else so you do not rediscover settled findings or miss context that changes what a number means:

```sql
select created_at, agent, summary from agent_reports
where created_at >= now() - interval '7 days'
order by created_at desc limit 20;
```

Fold anything relevant into your brief under a short "From the other workers" note, especially findings from the last 24 hours that Vince has not acted on yet.

## 0b. Directive compliance sweep

The `directives` table is the standing law of the system: every owner decision that must not evaporate, with where it is enforced and, for the mechanical ones, a `check_sql` that returns violating rows. Run the sweep every check:

```sql
select id, left(directive, 80) as directive, check_sql
from directives where status = 'active' and check_sql is not null;
```

Execute each `check_sql` exactly as stored. Any returned row is a FINDING named after its directive, reported at the top of the brief next to cron failures, never buried. An empty result on every check gets one line: "directive compliance clean, N checks". Also flag any active directive whose enforcement you know to be gone (a fence removed from code, a protocol nobody runs): a directive with dead enforcement is a finding even with no violating rows. Never edit the directives table during a check; propose changes to the owner.

## 1. Cron completions, last 24h

```sql
select job_name, status, count(*),
       max(created_at) as last_run
from cron_job_logs
where created_at >= now() - interval '24 hours'
group by 1, 2 order by 1;
```

Flag any `failed` or `partial` status. Then check for silence: these jobs should appear in every 24h window during their season: pre-analyze for each in-season sport, data_integrity_sweep (2 started plus 2 terminal rows), run_settlement, sync-tennis-data, sync-ufc-data, sync-standings, build-house-parlays, analyze-golf. Each sweep run writes a started row and a terminal row; an unmatched started row means a hung run. Absence of a job that has games in season is a finding even with zero failures. Note: fact-check-picks and enrich-articles do not log here, silence from them is normal.

## 2. Cost and the change gate

```sql
select date(created_at) as day,
       round(sum((details::jsonb->>'cost')::numeric), 2) as narration_cost,
       sum((details::jsonb->>'analyzed')::int) as analyzed,
       sum((details::jsonb->>'skipped_unchanged')::int) as skipped
from cron_job_logs
where job_name like 'pre-analyze%' and status in ('completed','partial')
  and created_at >= now() - interval '48 hours'
group by 1 order by 1;
```

The ONLY cost threshold is 6.00 dollars per day: above it is a cost regression. (The owner set 6.00 on 2026-08-18; the earlier 2.50 figure is retired and must not be reported as a second threshold or a conflict.) The full tennis draw narrates by design and lands a normal day near 5. Separately, skipped = 0 across a full day for a sport means the change gate is not firing for it (a churning input in the context hash). Since 2026-09-09 every analysis stores `context_parts`, a per-input fingerprint map (odds, rank, news, injuries, trends, stats, tennis, pitchers, edge, pick, traps). To name the churning input, compare the parts of two consecutive versions of the same game:

```sql
select game_key, analysis_version, generated_at, context_parts
from game_analysis where sport = 'MLB' and analysis_version > 1
order by generated_at desc limit 10;
```

The key whose fingerprint changed between versions while nothing real changed is the culprit; report it by name. Healthy state after August 2026: a meaningful share of stale games skip in every sport.

## 3. Integrity sweep findings

```sql
select kind, severity, count(*)
from agent_intel
where created_at >= now() - interval '24 hours'
group by 1, 2 order by 2 desc, 1;
```

- Any `agent_error`: pull the payloads and read them.
- `record_mismatch`: list team, ours vs actual. One or two from games that just ended is normal timing lag. A wave of them, or repeats across runs, means a data problem.
- Confirm caching is alive: latest `agent_debug` payloads should show `cache_read_tokens` well above zero for records-verifier and injury-scout chunks. Zero reads after the first run of a day means the cache breakpoints regressed and the sweep is billing full price again.
- Confirm `weather` rows exist with `payload->>'source' = 'open-meteo'` on days with MLB or MLS games.

## 4. Settlement movement

```sql
select period_bucket, won + lost + push as settled, pending
from mv_public_record
where dimension_type = 'overall';
```

Compare against yesterday's check if available. Pending growing while settled is frozen for 24h or more is a settlement stall: check run_settlement logs and game_results freshness next. Also spot-check that yesterday's graded games each show on the board (every graded game displays, per product rule).

## 5. Board freshness

```sql
select sport, count(*) as games, max(generated_at) as newest,
       count(*) filter (where stale) as stale_rows
from game_analysis
where game_date >= now() and game_date <= now() + interval '36 hours'
group by 1;
```

An in-season sport with games in the window but analyses older than 6 hours (and not gate-skipped) means pre-analyze is not covering the board.

## 6. Odds cache starvation

pg_cron records success when the HTTP post succeeds, even if the edge function times out, so refresh-odds failures are invisible in job status. The 2026-08-12 incident: football markets opening blew the function's time limit after its global delete, MLB and tennis vanished from odds_cache for a whole day, and every fire read as success. Check the cache directly:

```sql
select sport, count(*) as future_rows,
       round(extract(epoch from (min(commence_time) - now())) / 3600, 1) as first_game_hrs
from odds_cache where commence_time > now()
group by sport order by min(commence_time);
```

An in-season sport with zero future rows, or a first game hundreds of hours out, means the refresher is failing regardless of what cron says. Cross-check edge gateway status codes in the Supabase function logs if it looks wrong. pre-analyze games_found 0 with no error on an in-season sport is the same failure seen from downstream.

## 7. Silent-witness outputs

Some jobs write no cron_job_logs at all; their output table is the only witness. Check each has produced rows on its expected cadence:

```sql
select 'house_parlays' as job, max(created_at) as newest from house_parlays
union all
select 'closing_lines', max(captured_at) from closing_lines
union all
select 'player_props', max(last_updated) from player_props;
```

closing_lines captures every 15 minutes. A stale newest is a finding even when every logged job reads green. house_parlays is NO LONGER a silent witness: since 2026-08-18 build-house-parlays files a cron_job_logs row per run with per-size outcomes (built, already_published, pool_short, no_heavy_favorites, negative_edge, each with the pool count). Read those rows instead of inferring from row timestamps, and know the design: since 2026-09-09 the builds run at 04:58, 09:58 and 13:58 MT, 13 minutes behind the analysis slots, the first run builds the day's 2-leg and 3-leg and the later runs are catch-ups that only build a size the earlier ones missed. A later run that writes no new parlay while both sizes exist is HEALTHY (the Aug 14-16 "afternoon build failures" were this misread). The pool is every pending published pick or Leg whose game sits inside the 30 hour board window, whatever day it was published. The real alert conditions: a day that never gets both sizes, or no_heavy_favorites repeating across runs while heavies (Leg tier or implied 65 percent or more) are visibly on the board.

## Reporting

Keep it terse. ALL CLEAR plus the two or three numbers that prove it, or findings ranked by user impact (public stats wrong beats a noisy log). Plain punctuation, no em dashes, en dashes, semicolons, or arrows.

## File your report

Always end by writing to the blackboard, even on an ALL CLEAR, so tomorrow's workers know the last known-good state:

```sql
insert into agent_reports (agent, summary, findings)
values ('ops-check', '<two or three sentences: verdict plus anything another worker should know>',
        '<compact json of key numbers, or null>');
```
