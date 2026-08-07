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
| Pre-analyze narration | Sonnet (NARRATION) | cron_job_logs details.cost, at STANDARD rates |
| Integrity sweep records + injuries | Sonnet lookup, Opus 4.8 injury judgment | agent_intel agent_debug token payloads |
| Web search fees | n/a | console only, $10 per 1000 searches, agent_debug has per-agent search counts |
| Fact-check picks | Sonnet | NOT logged, count via ai_suggestions.fact_checked_at |
| Golf notes | Sonnet | NOT logged, 1 call per tournament per run, 3 runs/day |
| Enrich articles, news summarizer | Haiku | NOT logged, count news_articles.betting_summary |
| Learning analyzer | Opus 4.8 | daily |
| De-Genny chat | Sonnet | user-driven, usually zero |

Weather costs zero (Open-Meteo API since Aug 2026). Pricing changes matter: Sonnet 5 intro pricing ($2/$10 per MTok) ends 2026-08-31, standard is $3/$15. Opus 4.8 is $5/$25, Haiku 4.5 $1/$5. The logged `cost` field always uses standard Sonnet rates, so billed narration cost is lower than logged until the intro window closes.

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

Estimate fact-check at roughly 3k in / 1.5k out Sonnet tokens per check, golf at 2k in / 3k out per tournament call, enrichment at about 1.5k Haiku tokens per article.

## Reconciliation

Build a where-the-money-goes table in dollars per day per call site, sum it, and compare against the console (console.anthropic.com, Cost page, filter to the Cray key). Token cost and web search cost are separate console lines. If the console exceeds your bottom-up sum by more than about 20%, something is calling the API without logging: check for new code paths since the last audit (`git log` on lib/services and api/cron) before assuming rate changes.

The console chart grouped by model is the fastest cross-check: Sonnet should dominate, Opus should be a sliver (injury scout plus learning analyzer). An Opus surge means a model assignment regressed.

## Flags worth raising

- Any call site growing more than 30% month over month without a product reason.
- skipped_unchanged at zero (gate dead, see traphawk-ops-check).
- cache_read_tokens at zero on sweep agents (caching dead).
- Re-analysis churn: `select sport, avg(analysis_version) from game_analysis group by 1` creeping up means games are re-narrating too often even with the gate.
- Anything new calling `messages.create` without logging tokens somewhere queryable.

Plain punctuation in the report, no em dashes, en dashes, semicolons, or arrows.
