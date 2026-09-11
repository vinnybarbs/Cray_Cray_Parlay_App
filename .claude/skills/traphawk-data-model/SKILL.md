---
name: traphawk-data-model
description: The TrapHawk (traphawk.io) domain model, database schema, tier system, and canonical queries. Load this FIRST for any question about TrapHawk picks, traps, legs, records, win rates, the ledger, the digest, ai_suggestions, game_analysis, mv_public_record, or any Supabase query against the TrapHawk project, even if the user just asks "why does the record say X" or "how many picks hit yesterday". Every public percentage has exactly one correct source and several tempting wrong ones, so consult this before writing any performance query.
---

# TrapHawk Data Model

Supabase project id: `pcjhulzyqmhrhsrgvwvx`. Query it with the Supabase `execute_sql` tool. Backend is Node/Express (`server.js`) on Railway, frontend is Vite/React in root `src/` (NOT `vite-project/`).

## The pipeline in one paragraph

Math picks the side, Claude narrates. `api/cron/pre-analyze-games.js` computes per-side edges (edge calculator for team sports, dedicated models in `docs/models/` for tennis, UFC, soccer), then calls Sonnet only to write the analysis. The LLM never chooses the side. Shadow sports (`SHADOW_SPORTS`: the soccer family plus NCAAF) store edges and analyses but never publish picks. `SOCCER_1X2_SPORTS` is a separate set that answers which model prices a game, `SHADOW_SPORTS` answers whether it publishes. Tennis left the shadow list 2026-08-10 and publishes through the ladder at a 0.50 multiplier, UFC left it 2026-08-25 on 81 graded shadow reads at 48-33 with measured k 4.43 (UFC picks are real but rare under the 2pp gate), and NFL went LIVE 2026-09-09 ahead of the opener with moneyline and spread publishing at multipliers 0.25 and 0.10 and totals muted at 0. None of those three is a shadow sport any more and none is judged against the promotion bar. NCAAF was planned to flip at the 2026-08-29 opener, the flip was not taken, and it stays shadowed as an open owner decision while the program strength prior accrues attribution. Shadow promotion for player sports is judged by `shadow_model_readiness()`: 75 graded publishable reads, actual at or above fair implied, AND positive publishable units. Never a raw read count.

## NFL player props (shadow, 2026-09-11)

`prop_reads` is the shadow record for NFL player props, one row per (event, market, player), written by `api/cron/analyze-nfl-props.js` twice daily and graded by the same endpoint with `?mode=grade` against `nfl_player_game_stats` (nflverse, the settlement truth, synced Tuesdays). The formula (`lib/services/prop-edge.js`) has the same shape as every team market: anchor at the devigged consensus over price at the median book line (`player_props`, 8 books), model from the player's own game log, damp the disagreement by `prop_claim_damp` times games over `prop_min_games`, band the pp. Every weight is an `NFL_props` row in `sport_dials`. Five over/under markets are modeled (pass yds, pass TDs, rush yds, rec yds, receptions); anytime TD is not. Nothing publishes: no ai_suggestions row, no digest tile, no alert, so `prop_reads` never touches mv_public_record. Judge it like any shadow sport: graded reads at 2pp+ against the anchor, won minus anchor implied, by market and by band.

## Tier system (CALIBRATED edge in percentage points vs implied probability)

| Tier | Rule |
|---|---|
| Sharp Take | published edge_pp >= 10pp. The tier is nothing but the pp band since 2026-09-10 (directive 16): price rails and the exposure guard deduct from the claim BEFORE the ladder (lib/services/price-penalties.js: -150 or heavier minus chalk_penalty_pp, +300 or longer minus longshot_penalty_pp scaled by price, floored at 2pp; exposure-guard.js: minus exposure_guard_pp after two straight graded team losses), and edge_pp stores the adjusted claim with a "Chalk price:", "Longshot price:", or "Exposure guard:" marker in reasoning. Rows stamped before 2026-09-10 carry the old label fence (no Sharp Take at -150 or heavier) and ceiling (nothing above Lean at +300 or longer) with an unpenalized edge_pp |
| Strong Play | edge 7-10pp. Merged into Play 2026-08-10 and RESTORED 2026-08-16 by owner decision (7pp is the betting floor, that band earns its own label); only rows stamped 08-10 to 08-16 carry Play for a 7-10pp edge |
| Play | edge 4-7pp |
| Lean | edge >= 2pp (2pp is the floor for a published pick) |
| Skip | edge between -2pp and 2pp |
| Trap | lure-based, side priced <= -2pp that casual bettors are drawn to (`lib/services/trap-detector.js`). NOT simply the inverse of a pick |
| Leg | model probability >= 65% to win but no 2pp edge (payout too thin). Tracked for parlay building |

Edges are calibrated by `edge_calibration` multipliers (keys `<Sport>:<market>`, `<Sport>`, `__global__`) before tiering, with a 0.25 floor on the weekly refit since 2026-08-24. Live multipliers are read from the table, never from this file: `select key, multiplier, measured_k, source, updated_at from edge_calibration order by key;` (the ops check found this paragraph stale on three keys on 2026-09-10, so numbers no longer live here). Decisions by date, for context only: MLB ml floored at 0.25 on 2026-08-24, MLB spreads re-entered 2026-08-10, MLB totals re-entered on probation 2026-08-31 under the band aware map (PR 110), Tennis:ml refit weekly since 2026-09-07, UFC:ml promoted out of shadow 2026-08-25 (claims average 0.35pp, so UFC is mostly a board, leg, and trap product, not a pick engine), NFL seeded 2026-09-09 at go-live with totals muted. Legs are GIMMES only: calibrated model probability 65% or better, no loosening (a market-anchored second path shipped and was reverted the same day, 2026-08-25, at owner direction). The quiet-day Discord content comes from the morning board's presentation-only high-percenter list (fairImplied 60%+ favorites the model agrees with, from game_analysis, never published or graded). A `reprice-pending-picks` cron demotes pending Play moneyline picks to Lean when the market fades their side by 1pp of implied probability inside 90 minutes of first pitch.

## Record domains in ai_suggestions

Rows are namespaced by `session_id` prefix, one row per game per domain per day:

- `auto_digest_YYYY-MM-DD` = published picks
- `auto_digest_trap_YYYY-MM-DD` = trap calls. Graded as the FADE: a won trap row means the named trap side lost
- `auto_digest_leg_YYYY-MM-DD` = legs (65%+ sides), outcomes read straight

A partial unique index (`uq_ai_suggestions_auto_digest_game`) dedupes on (session_id, home, away, game_date), and since 2026-08-12 the upsert matches on `odds_event_id` per domain FIRST, so a start-time re-emit revises the existing row instead of duplicating it (three tennis duplicates double counted the record before this). Rows with `voided_at` set are retroactively voided (published under a later-discovered defect, or duplicates) and excluded from mv_public_record; filter `voided_at is null` in any raw query that should match the public record. Key columns: sport, home_team, away_team, game_date, bet_type, pick, odds, edge_pp, tier, actual_outcome, reasoning, `odds_event_id` (the Odds API event the pick was priced from, on every row since 2026-08-09), and for traps lure_score plus trap_signals, for legs model_prob plus implied_prob.

THE FROZEN COHORT: 529 rows share `resolved_at = '2026-08-09 12:13:08.323644-06'`. They were regraded, then restored at owner direction the same day after six forensic audits returned a mixed verdict. NEVER re-flip them in any sweep. Details and row lists live in agent_reports (2026-08-09).

## Settlement and the one clock

Same-game identity resolves in strict order: `odds_event_id` (primary-key hit against `odds_api_scores`), then kickoff instant within 3 hours, then exact Denver calendar day. America/Denver is the ONLY timezone that may produce a calendar day anywhere in the pipeline, via `shared/site-day.js` (lib/services/sport-day.js delegates to it). A tripwire test fails the build on any new UTC day derivation. `game_results.date` rows stamped before 2026-07-25 were UTC-derived and can be one day late for evening games; do not treat them as ground truth for which night a game was played.

## mv_public_record is the ONLY source for public percentages

Every number shown to users (hero record, tier records, trap record, leg pool) comes from `mv_public_record`. Do not compute win rates from raw ai_suggestions and do not use `mv_model_accuracy` (full-history, reserved for calibration). The two will disagree and the MV is right: it starts at the graded era (May 10 2026), drops soccer v1, and dedupes per domain (picks, traps, legs separately).

Shape: one row per (period_bucket, dimension_type, dimension_value). period_bucket in `all | last_30d | last_7d | last_3d`. dimension_type in `overall | sport | bet_type | tier`. Count columns: won, lost, push, pending, total, plus roi_units, roi_pct, settled_with_odds.

```sql
select dimension_value, won, lost, push, pending
from mv_public_record
where period_bucket = 'last_30d' and dimension_type = 'tier';
```

CRITICAL gotcha: recreating the MV drops its grants. After any DROP plus CREATE, re-apply:

```sql
GRANT SELECT ON public.mv_public_record TO anon, authenticated, service_role;
```

Skipping this silently zeroes every public stat on the site.

## Other tables you will need

- `game_analysis`: one row per game, upserted per re-analysis (`analysis_version` increments, token counts are the LAST version only, so cron logs are the source for total spend). `context_hash` gates re-narration: unchanged inputs extend `expires_at` with no model call. `stale` is set by intel updates.
- `cron_job_logs`: `details` is TEXT, cast `details::jsonb` before extracting. Pre-analyze rows carry cost, analyzed, skipped_unchanged, games_found.
- `agent_intel`: integrity sweep output. kind in record_mismatch, injury, weather, record_check_summary, agent_debug, agent_error. agent_debug payloads carry per-sub-agent input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, web_searches.
- `house_parlays`: machine parlays with honest math (model_win_prob, fair_win_prob, ev_pct).
- `tennis_rankings`, `tennis_match_results`, `ufc_fighters`, `ufc_fight_results`: player-sport context synced from ESPN. Player keys are normalized: NFD strip accents, lowercase, strip punctuation ("Fábián Marozsán" becomes "fabian marozsan").
- `golf_field`: tournament fields with prices and research notes.
- `agent_reports`: the digital workers' shared blackboard. Every scheduled review, audit, ops check, and significant build session files a summary row here and reads recent rows before starting. When investigating anything, check it early: another worker may have already diagnosed it.
- `closing_lines`: closing prices captured every 15 minutes since 2026-07-11 (h2h, spreads, totals, per book, with `external_game_id` and real commence instants).
- `pick_clv` (view): closing line value per moneyline pick, joined by event id or kickoff instant. `clv_pp` positive means the pick beat the close. The earliest honest signal of edge drift.
- `odds_api_scores`: finals from The Odds API keyed by `event_id` with real commence instants. The settlement grader's first stop and the independent cross-check source against ESPN-backed `game_results`.
- `player_props`: raw props market rows (event, market, player_key, line, over/under/yes prices, per book), NFL preseason collection first. `player_game_stats`: ESPN box-score stats, football-shaped columns only.
- `edge_calibration` plus `market_shadow_calibration(since date)`: multipliers and the shadow grader that lets muted markets earn their way back (re-enable bar 52.4 percent at -110 on a real sample).

## Player sports are different on purpose

Tennis record columns store 30-DAY form, not season records. UFC records come from `ufc_fighters`. Never compare these to season standings (this caused false record-mismatch alarms). The integrity sweep's records verifier already excludes Tennis, UFC, and Golf. ESPN's UFC feed covers UFC events only, so PFL/ACA cards on the MMA odds feed have no fighter data.

## Cron architecture

pg_cron jobs fire `net.http_post` at Railway `/cron/*` endpoints authenticated by a secret in the URL. Extract it in SQL when triggering jobs manually:

```sql
SELECT net.http_post(
  url := 'https://craycrayparlayapp-production.up.railway.app/cron/<endpoint>?secret=' ||
    (SELECT substring(command FROM 'secret=([^&]+)') FROM cron.job WHERE jobname = 'pre-analyze-mlb' LIMIT 1),
  headers := jsonb_build_object('Content-Type','application/json'),
  body := '{}'::jsonb, timeout_milliseconds := 300000);
```

Job schedules live in `cron.job`. Some Claude-calling jobs (fact-check-picks, enrich-articles) do NOT write cron_job_logs, so absence of logs is not absence of runs.

## Writing style is enforced in code

`WRITING_STYLE` in `lib/services/claude.js` bans em dashes, en dashes, semicolons, and arrows in all model output. `complete()` injects it automatically. Any new raw `messages.create` call site must import and include it, and your own prose to the user follows the same rule.
