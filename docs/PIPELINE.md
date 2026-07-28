# Pipeline Inventory

Single source of truth for "what runs when." Snapshot of the **live**
`cron.job` table in Supabase, taken 2026-07-28. If you add, remove, or
reschedule a job, update this file in the same change.

All scheduling lives in **pg_cron inside Supabase**. There are no Railway
crons (the last one — daily `populate-apisports.js` — was removed 2026-07-28;
API-Sports is banned from this stack) and no Vercel crons. pg_cron jobs come
in two flavors:

- **SQL jobs** run a function or statement directly in Postgres.
- **HTTP jobs** use `net.http_post` to call a Railway API endpoint
  (`craycrayparlayapp-production.up.railway.app`) or a Supabase edge function.

No job reports to a coordinator. Every loop closes through tables: a job
writes rows, and downstream readers (the pick engine, the UI APIs) read them
on their own schedule.

Schedules are UTC. Game-day bucketing everywhere uses the US Eastern
game-day helper (`lib/services/sport-day.js`).

## The pick engine (the one brain)

`api/cron/pre-analyze-games.js` is the only pick generator. Per sport it:
reads `odds_cache` → runs `EdgeCalculator` (+ dedicated tennis/UFC/soccer
models) with `edge_calibration` multipliers → Claude narrates → writes
`game_analysis` and `ai_suggestions` (session `auto_digest_<eastern-day>`).

| Job | Schedule | Sport |
|---|---|---|
| pre-analyze-mlb | 45 */3 * * * | MLB |
| pre-analyze-nba | 0 */2 * * * | NBA |
| pre-analyze-ncaab | 30 */2 * * * | NCAAB |
| pre-analyze-nhl | 15 */2 * * * | NHL |
| pre-analyze-soccer | 5 */2 * * * | EPL/MLS (unified) |
| pre-analyze-Tennis | 25 */4 * * * | Tennis |
| pre-analyze-UFC | 55 */4 * * * | UFC |

The legacy multi-agent generator (`MultiAgentCoordinator` + odds/research/
analyst agents, `/api/generate-parlay`, `/api/suggest-picks`) was retired
2026-07-28 — recover from git history if ever needed.

## Data ingestion (HTTP jobs → Railway `/cron/*` unless noted)

| Job | Schedule | Endpoint | Writes |
|---|---|---|---|
| refresh-odds-hourly | */20 * * * * | edge fn `refresh-odds` | odds_cache |
| fetch-espn-intelligence-3h | 20 */3 * * * | /cron/fetch-espn-intelligence | news_cache |
| sync-ncaab-data-2hourly | 30 */2 * * * | /cron/sync-ncaab-data | game_results, rankings_cache, teams |
| sync-standings | 30 */2 * * * | /cron/sync-standings | standings |
| backfill-game-results-6h | 30 */6 * * * | /cron/backfill-game-results | game_results |
| ingest-news-lite-2hr | 0 */2 * * * | edge fn `ingest-news-lite` | news articles |
| enrich-articles-4h | 45 */4 * * * | /cron/enrich-articles | article enrichment |
| analyze-golf | 30 10,16,22 * * * | /cron/analyze-golf | golf field/leaderboard |
| probe-data-sources-6h | 15 */6 * * * | /cron/probe-data-sources | source health |

## Settlement & outcomes

| Job | Schedule | Runs | Writes |
|---|---|---|---|
| settlement_daily_safety | 15 6 * * * | SQL `run_settlement()` | ai_suggestions outcomes |
| check-parlays-2h | 40 */2 * * * | /api/cron/check-parlays | user parlay outcomes |
| analyze-outcomes-daily | 0 8 * * * | /api/analyze-outcomes | outcome analysis |
| fact-check-picks-2h | 30 */2 * * * | /cron/fact-check-picks | pick fact checks |
| settle-house-parlays | 20 * * * * | /cron/settle-house-parlays | house_parlays |
| build-house-parlays | 45 15,19 * * * | /cron/build-house-parlays | house_parlays |

House parlays: still building/settling in shadow while benched from the UI
(2026-07-28) — the record accrues, the ledger shows a placeholder.

There's also a Supabase edge function `check-outcomes` (Deno) that fetches
ESPN results and settles suggestions; it duplicates parts of the Node path
and is a consolidation candidate.

## Learning loop & rollups (SQL jobs)

| Job | Schedule | Runs | Feeds |
|---|---|---|---|
| edge_calibration_weekly | 30 6 * * 1 | `refresh_edge_calibration()` | `edge_calibration` → read by EdgeCalculator at pick time |
| refresh_public_rollups_hourly | 50 * * * * | `refresh_mv_model_accuracy()` | mv_model_accuracy, mv_public_record → digest hero, landing, ledger |
| capture_closing_lines | */15 * * * * | `capture_closing_lines()` | closing lines / CLV |
| capture_odds_parsing_failures | 5 * * * * | `capture_odds_parsing_failures()` | odds QA |
| refresh_normalized_odds_outcomes | */30 * * * * | refresh MV | normalized_odds_outcomes |
| refresh_team_latest_record | */15 * * * * | refresh MV | team_latest_record |
| refresh_player_recent_form | */15 * * * * | proc (batch 50) | player_recent_form |
| refresh_player_recent_form_hourly | 0 * * * * | proc (batch 100) | player_recent_form |
| shadow_model_150_check | 10 15 * * * | inline SQL | shadow-model sample-size log |

Calibration semantics: multiplier = clamp(k, 0, 1.2) where k is the
regression slope of realized excess win rate on claimed edge, per
`<Sport>:<market>` (needs 80 settled v6+ picks / 120d), per `<Sport>`
(needs 150), and `__global__` (needs 300). Suspended sports (multiplier 0,
e.g. EPL/MLS pending 3-way support) are never auto-resurrected.

## Data quality

| Job | Schedule | Endpoint |
|---|---|---|
| data_integrity_morning | 45 10 * * * | /cron/data-integrity |
| data_integrity_midday | 0 17 * * * | /cron/data-integrity |

## Request-time surfaces (no schedule — read what the jobs wrote)

- `/api/digest` — gamesBySport from `game_analysis`, accuracy from MVs
- `/api/public-stats`, `/api/public-ticker`, `/api/public-pod` — landing page
- `/api/public-ledger` — House Ledger (picks, traps, parlay record)
- `/api/board-history` — yesterday's board (`auto_digest_<day>` sessions)
- `/api/chat-picks` — De-Genny chat (reads the same graded data)
- `/api/pipeline-health`, `/api/admin-dashboard` — ops views

## One-time / repair

- `scripts/repair-game-result-dates.js` — refetch-based repair for
  `game_results.date` rows written before the Eastern game-day fix
  (dry-run by default, `--apply` to write).
