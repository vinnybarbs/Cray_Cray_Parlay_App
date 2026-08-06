---
name: traphawk-data-model
description: The TrapHawk (traphawk.io) domain model, database schema, tier system, and canonical queries. Load this FIRST for any question about TrapHawk picks, traps, legs, records, win rates, the ledger, the digest, ai_suggestions, game_analysis, mv_public_record, or any Supabase query against the TrapHawk project, even if the user just asks "why does the record say X" or "how many picks hit yesterday". Every public percentage has exactly one correct source and several tempting wrong ones, so consult this before writing any performance query.
---

# TrapHawk Data Model

Supabase project id: `pcjhulzyqmhrhsrgvwvx`. Query it with the Supabase `execute_sql` tool. Backend is Node/Express (`server.js`) on Railway, frontend is Vite/React in root `src/` (NOT `vite-project/`).

## The pipeline in one paragraph

Math picks the side, Claude narrates. `api/cron/pre-analyze-games.js` computes per-side edges (edge calculator for team sports, dedicated models in `docs/models/` for tennis, UFC, soccer), then calls Sonnet only to write the analysis. The LLM never chooses the side. Shadow sports (Tennis, UFC, soccer family in `SHADOW_SPORTS`) store edges and analyses but never publish picks to the record; they graduate after 150 graded shadow reads.

## Tier system (edge in percentage points vs implied probability)

| Tier | Rule |
|---|---|
| Sharp Take | edge >= 10pp |
| Strong Play | edge >= 7pp |
| Play | edge >= 4pp |
| Lean | edge >= 2pp (2pp is the floor for a published pick) |
| Skip | edge between -2pp and 2pp |
| Trap | lure-based, side priced <= -2pp that casual bettors are drawn to (`lib/services/trap-detector.js`). NOT simply the inverse of a pick |
| Leg | model probability >= 65% to win but no 2pp edge (payout too thin). Tracked for parlay building |

## Record domains in ai_suggestions

Rows are namespaced by `session_id` prefix, one row per game per domain per day:

- `auto_digest_YYYY-MM-DD` = published picks
- `auto_digest_trap_YYYY-MM-DD` = trap calls. Graded as the FADE: a won trap row means the named trap side lost
- `auto_digest_leg_YYYY-MM-DD` = legs (65%+ sides), outcomes read straight

A partial unique index (`uq_ai_suggestions_auto_digest_game`) dedupes on (session_id, home, away, game_date). Rows with `voided_at` set are retroactively voided (published under a later-discovered defect) and excluded from mv_public_record; filter `voided_at is null` in any raw query that should match the public record. Key columns: sport, home_team, away_team, game_date, bet_type, pick, odds, edge_pp, tier, actual_outcome, reasoning, fact_check fields, and for traps lure_score plus trap_signals, for legs model_prob plus implied_prob.

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
