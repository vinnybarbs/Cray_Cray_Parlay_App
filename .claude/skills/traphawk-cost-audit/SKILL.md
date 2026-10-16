---
name: traphawk-cost-audit
description: Audit TrapHawk's Anthropic API spend from production records and reconcile against the console bill. Use whenever the user mentions API costs, the Anthropic bill, token spend, "where is the money going", cost per day, or asks whether a pipeline change moved the bill. Also run monthly as a scheduled review. Uses DB evidence, not guesses, and knows which call sites log spend and which are silent.
---

# TrapHawk API cost audit

All spend evidence lives in production (Supabase project `pcjhulzyqmhrhsrgvwvx`, `execute_sql` tool). The August 2026 baseline: $7.60/day before fixes, target under $3/day after caching, change-gating, and Open-Meteo weather.

Start by reading `agent_reports` for the last month (other workers may have already flagged a cost anomaly or shipped a change that moves the bill), and end by filing your own report with `agent = 'cost-audit'`, summary plus a findings json of the per-call-site table. The exact read and insert patterns are in the traphawk-ops-check skill.

## Where every dollar comes from

| Call site | Model | Logged where |
|---|---|---|
| Pre-analyze narration | Sonnet 5.5 (NARRATION) for Play, Strong Play, Sharp Take and Trap tiles, Haiku 5.5 (NARRATION_SMALL) for Lean, Leg and Skip tiles since 2026-10-13 (owner 2026-10-11, build_queue 91, narrationTierFor in api/cron/pre-analyze-games.js). Before that, Sonnet 5 for audience worthy games and Haiku 4.5 for the rest | cron_job_logs details.cost (Sonnet at the standard 3 and 15 per MTok, Haiku 5.5 at 0.10 and 0.50) and details.by_model with calls, input, output and cost per model |
| Narration checker (since 2026-10-15, shadow) | Haiku 5.5 (UTILITY), one call per fresh pre-analyze narration (lib/services/narration-checker.js, build_queue 90). MODELS.UTILITY moved from Haiku 4.5 to Haiku 5.5 the same day, so every complete() default call site bills at Haiku 5.5 from then | cron_job_logs pre-analyze details.checker (calls, input, output, cost at 0.10 and 0.50, included in details.cost but not in details.by_model) and narration_checks.cost_usd per row |
| NFL prop narration (since 2026-10-12) | Sonnet 5.5 (NARRATION) since 2026-10-13, Sonnet 5 before, one short call per shown prop read with v2_edge_pp 4 or more, re-run only when the read's side or line moves, at most 120 a run (api/cron/narrate-nfl-props.js, run after every analyze-nfl-props read) | cron_job_logs job narrate-nfl-props, details.input_tokens, output_tokens and est_cost_usd at standard Sonnet rates. Expect about $2 a week in season |
| Integrity sweep records + injuries | Sonnet 5 for lookup and injury judgment since 2026-10-01 (lib/services/data-integrity-agent.js 40 to 41) | agent_intel agent_debug token payloads |
| Parlay generator and pick builder | Sonnet 5.5 (MODELS.NARRATION through ANALYST_MODEL in lib/agents/analyst-agent.js), on demand from /api/generate-parlay and /api/suggest-picks via lib/agents/coordinator.js | NOT logged |
| Web search fees | n/a | console only, $10 per 1000 searches, agent_debug has per-agent search counts |
| Fact-check picks | Sonnet 5.5 (NARRATION) since 2026-10-13, Sonnet 5 before | NOT logged, count via ai_suggestions.fact_checked_at |
| Golf notes | Sonnet | RETIRED 2026-10-12 (owner, build_queue 92): analyze-golf unscheduled and its route removed, so this line is zero from that date. Before it, NOT logged, 1 call per tournament per run, 3 runs/day |
| Enrich articles, news summarizer | Haiku | RETIRED 2026-09-14 (owner, build_queue 36): both jobs unscheduled and the code removed, so this line is zero from that date. Before it, count news_articles.betting_summary |
| Learning analyzer | Opus 4.8 | RETIRED 2026-09-15 (owner): analyze-outcomes-daily unscheduled, so this line is zero from that date. Its routes and the parlay coordinator lessons read were removed 2026-10-12 (build_queue 92). Before it, five picks a day into ai_suggestions.post_analysis |
| De-Genny chat | Sonnet | OFF since 2026-09-21 (owner): /api/chat-picks answers 503 unless DEGENNY_CHAT=on, so this line is zero from that date. It had answered anonymous prompts behind only a per address rate limit |

Weather costs zero (Open-Meteo API since Aug 2026). Pricing changes matter: Sonnet 5 intro pricing ($2/$10 per MTok) ends 2026-08-31, standard is $3/$15. Opus 4.8 is $5/$25, Haiku 4.5 $1/$5. Sonnet 5.5 lists at $2/$10 and Haiku 5.5 at $0.10/$0.50. The logged `cost` field prices Sonnet at $3/$15 and, since 2026-10-13, Haiku 5.5 at its own rate, so billed Sonnet narration runs lower than logged.

## The queries

Narration by day and sport:

```sql
select date(created_at) as day,
       round(sum((details::jsonb->>'cost')::numeric), 2) as cost_std_rates,
       sum((details::jsonb->>'analyzed')::int) as analyzed,
       sum((details::jsonb->>'skipped_unchanged')::int) as skipped
from cron_job_logs
where job_name like 'pre-analyze%' and status in ('completed','partial')
  and created_at >= date_trunc('month', now())
group by 1 order by 1;
```

Sweep tokens per sub-agent (cache efficiency included):

```sql
select payload->>'label' as agent,
       sum((payload->>'input_tokens')::int) as uncached_in,
       sum((payload->>'cache_read_tokens')::int) as cache_reads,
       sum((payload->>'cache_write_tokens')::int) as cache_writes,
       sum((payload->>'output_tokens')::int) as out_tokens,
       sum((payload->>'web_searches')::int) as searches
from agent_intel
where kind = 'agent_debug' and payload ? 'input_tokens'
  and created_at >= date_trunc('month', now())
group by 1;
```

Cache reads bill at 10% of input rate, writes at 125%. A healthy loop shows reads several times larger than uncached input. Injury scout chunks nest their telemetry inside `payload->'chunks'`, unnest when totals look too small.

Silent call sites, count and estimate:

```sql
select
  (select count(*) from ai_suggestions where fact_checked_at >= date_trunc('month', now())) as fact_checks,
  (select count(*) from news_articles where betting_summary is not null
     and published_at >= date_trunc('month', now())) as articles_enriched;
```

Estimate fact-check at roughly 3k in / 1.5k out Sonnet tokens per check, golf at 2k in / 3k out per tournament call (only for months before 2026-10-12), enrichment at about 1.5k Haiku tokens per article (only for months before 2026-09-14; the news path has no model call since then).

## Reconciliation

Build a where-the-money-goes table in dollars per day per call site, sum it, and compare against the console (console.anthropic.com, Cost page, filter to the Cray key). Token cost and web search cost are separate console lines. If the console exceeds your bottom-up sum by more than about 20%, something is calling the API without logging: check for new code paths since the last audit (`git log` on lib/services and api/cron) before assuming rate changes.

The console chart grouped by model is the fastest cross-check: Sonnet should dominate, Opus should be near zero (the injury scout moved to Sonnet 5 on 2026-10-01 and the learning analyzer, the last Opus caller, retired 2026-09-15). An Opus surge means a model assignment regressed.

## Flags worth raising

- Any call site growing more than 30% month over month without a product reason.
- skipped_unchanged at zero (gate dead, see traphawk-ops-check).
- cache_read_tokens at zero on sweep agents (caching dead).
- Re-analysis churn: `select sport, avg(analysis_version) from game_analysis group by 1` creeping up means games are re-narrating too often even with the gate.
- Anything new calling `messages.create` without logging tokens somewhere queryable.

Plain punctuation in the report, no em dashes, en dashes, semicolons, or arrows.
