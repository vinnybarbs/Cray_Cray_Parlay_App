# Operations

The living map of how production runs. Written 2026-07-11 after the
calibration overhaul. Backlog lives in TODO.md; schema history in
supabase/migrations/.

## Infra

- Production: https://craycrayparlayapp-production.up.railway.app
  (Railway auto-deploys pushes to main; note a redeploy kills any in-flight
  background job, including a running data-integrity sweep)
- Database: Supabase project `pcjhulzyqmhrhsrgvwvx` (provisioned through the
  Vercel marketplace; Vercel is otherwise unused)
- All pg_cron schedules are in UTC. Denver is UTC-6 in summer.

## Secrets

| Secret | Lives in | Used for |
|---|---|---|
| CRON_SECRET | Railway env (also embedded in pg_cron job commands) | authenticates /cron/* endpoints |
| ANTHROPIC_API_KEY | Railway env | ALL LLM calls: pick narration, De-Genny chat, parsing/extraction, learning analysis, data-integrity agent (migrated off OpenAI 2026-07-11) |
| report_secret | app_config table | read-only auth for /api/review-bundle |
| Supabase service role | Railway env | backend DB access (bypasses RLS) |

The anon key ships in the frontend bundle by design. The 2026-07-11 RLS
lockdown made that safe: deny-all on backend tables, invoker-security views,
API roles stripped from RPC functions.

## Scheduled pipeline (UTC)

| Job | Schedule | What it does |
|---|---|---|
| refresh-odds-hourly | */20 | refresh odds_cache (name is historical) |
| sync-standings | :30 every 2h | ESPN standings, the season-record source of truth; must lead the analyses |
| pre-analyze-mlb (and per-sport peers) | :45 every 3h | math picks edges (devig baselines + calibration multipliers), LLM narrates, writes game_analysis + ai_suggestions with edge snapshot (pipeline_version 6) |
| settlement | trigger on game_results + 06:15 safety | grades picks, refreshes MV |
| capture_closing_lines | */15 | snapshot odds for games starting within 90 min (CLV) |
| refresh_edge_calibration | Mon 06:30 | re-estimates reliability multipliers from settled v6 picks; suspended sports (EPL/MLS at 0) never auto-resurrect |
| data_integrity_morning / _midday | 10:00 / 17:00 | Claude agent sweep (below) |
| mv refresh | 00:10 / 06:10 + post-settlement | mv_model_accuracy |

## Data-integrity agent

`lib/services/data-integrity-agent.js`, triggered via
`POST /cron/data-integrity?secret=CRON_SECRET` (responds 202, runs async).
Three sub-agents on the Anthropic API with server-side web search:

- injury scout: claude-opus-4-8 (judgment-heavy)
- records verifier, weather scout: claude-sonnet-5 (lookups)

Writes `agent_intel` (kinds: record_mismatch, injury, weather, agent_error)
and logs started/skipped/summary rows to `cron_job_logs`
(`job_name='data_integrity_sweep'`). pre-analyze injects fresh intel into the
narration prompt as VERIFIED INTEL. Intel does not move the math edge until
calibration proves a signal. Cost roughly $1.50-2/day. Caps: 14 games/run,
8-10 searches per sub-agent.

## Weekly review routine

A scheduled Claude routine (`parlay-weekly-model-review`, Mondays 08:00
Denver, runs on the Max plan) fetches `/api/review-bundle?secret=<report_secret>`
and writes a plain-English readout: calibration moves, tier report card
against the Sharp Take baseline (63.5% win, +23% ROI all-time), CLV verdict,
hygiene flags. Strictly read-only.

## Public API surface

| Endpoint | Serves |
|---|---|
| /api/public-stats | overall + bySport + tiers + sharpTakeAllTime (landing + track record) |
| /api/public-ticker | real edges for the ticker + in-season league list |
| /api/public-pod | the free Pick of the Day (freshest digest generation only, >= 7pp, +300 ML fence, sanitized "show the work" payload) |
| /api/review-bundle | analytics bundle for the weekly routine (secret) |

## House rules learned the hard way

- Season records come from standings, never from the 20-game game_results
  window (the White Sox 9-11 incident).
- No internal identifiers in user-facing copy: no file paths, table names,
  or model vendor names.
- A sport is either on the board with working edges and settlement, or it is
  not claimed as covered.
- Signals earn their way into the math through measured calibration, not
  intuition. Narration context is the on-ramp.

## Quick health check

```sh
for ep in public-stats public-ticker public-pod; do
  curl -s -o /dev/null -w "$ep: %{http_code}\n" \
    https://craycrayparlayapp-production.up.railway.app/api/$ep
done
```

```sql
select jobname, schedule, active from cron.job order by jobname;
select * from cron.job_run_details order by end_time desc limit 10;
select created_at, status, details from cron_job_logs
 where job_name = 'data_integrity_sweep' order by created_at desc limit 5;
```
