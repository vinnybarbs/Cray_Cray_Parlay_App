# SQL Settlement Function — Design

**Date:** 2026-04-21
**Status:** Approved, pending implementation plan
**Owner:** Vinny
**Spec 1 of 2** — follow-up spec covers ESPN backfill coverage (UFC parser, EPL, Tennis)
**Related code:** [lib/services/parlay-outcome-checker.js](../../../lib/services/parlay-outcome-checker.js), [lib/services/ai-suggestion-outcome-checker.js](../../../lib/services/ai-suggestion-outcome-checker.js), [supabase/functions/check-outcomes/index.ts](../../../supabase/functions/check-outcomes/index.ts), [supabase/functions/check-parlay-outcomes/index.ts](../../../supabase/functions/check-parlay-outcomes/index.ts)

## Problem

The current settlement pipeline has four interconnected defects:

1. **Duplicate writers, inconsistent state on `parlay_legs`.** Railway `ParlayOutcomeChecker` writes `outcome` + `settled_at`; Supabase edge function `check-parlay-outcomes` writes `game_completed` + `leg_result` + `resolved_at`. All 124 existing rows have the first set and the second NULL — the edge function never matched anything. Two code paths that both claim to settle legs.
2. **`check-outcomes` edge function's `checkUserParlays()` is a TODO stub** returning `{checked: 0, resolved: 0}` hardcoded. The "parlays_checked: 0" every run in `cron_job_logs` is by design, not a bug we could fix in place.
3. **`games_fetched: 0` every run** — the same edge function's `cacheGames()` upsert silently fails (missing NOT-NULL columns). `game_results` gets populated by a separate Railway cron `backfill-game-results-daily` instead; the edge function's fetch path is dead code.
4. **Sport coverage gaps** surface as ~400 stale pending AI suggestions. EPL and Tennis are not in the edge function's sport list; UFC is in the list but `parseGames()` silently returns 0 (MMA event format has no home/away). These coverage gaps are **out of scope for this spec** — they're handled in the follow-up Spec 2 (ESPN backfill coverage). What this spec fixes: once game_results rows land (from any source), they settle correctly.

Plus two architectural consequences:

- Settlement logic lives across Node Railway services, a Deno edge function (mostly broken), and a second Deno edge function (also broken for user parlays). One conceptual task, three implementations.
- Team-matching and bet-type-outcome logic is duplicated between `ai_suggestions` settlement and `parlay_legs` settlement, even though **every `parlay_legs` row is conceptually a locked-in `ai_suggestions` row** (same pick, same game, same team, same bet type).

## Goals

- A single canonical settlement pipeline in Postgres, using set-based SQL against `game_results`. Trigger-driven, runs the instant Railway's backfill lands scores.
- `parlay_legs` outcomes propagate from their source `ai_suggestions` (after a linkage backfill), eliminating the duplicate settlement logic.
- `parlay_legs` rows write all state columns atomically in one UPDATE: `outcome`, `settled_at`, `game_completed`, `leg_result`, `resolved_at`. No more half-settled rows.
- Multi-day parlays resolve correctly: a single losing leg marks the whole parlay lost immediately, even with pending later legs.
- Retire the two Supabase edge functions (`check-outcomes`, `check-parlay-outcomes`) and their pg_cron schedules. They will be deleted in the same migration.
- Deploy triggers an immediate settlement of the ~400 stale pending backlog so the dashboard shows movement within seconds of merge.

## Non-goals

- **UFC, EPL, Tennis sport-coverage fixes.** Those are fixes to Railway's ESPN scrapers (populating `game_results`), separate concern. This spec's settlement function will settle any sport whose game_results rows exist and match a pick — solving the coverage gap is Spec 2.
- **Player Props settlement.** 79 picks (4% of dataset) need a player-stats lookup path. Deferred to its own followup spec.
- **Real-time / live game settlement.** Current Railway backfill runs once a day at 5 AM UTC. Same cadence post-spec. If we later want minute-by-minute live resolution, that's a Railway cron cadence change.
- **Enforcing `ai_suggestions.parlay_id` reverse link.** The reverse linkage (`ai_suggestions.parlay_id` pointing back to the parent parlay) stays partially-populated legacy data. This spec uses the forward linkage only (`parlay_legs.suggestion_id`).

## Design

### Architecture

```
                 ┌───────────────────────┐
                 │  Railway Node cron    │
                 │ backfill-game-results │ (unchanged — fires once/day 5 UTC)
                 │   → game_results      │
                 └───────────┬───────────┘
                             │ INSERT/UPDATE
                             ▼
               ┌────────────────────────────┐
               │ TRIGGER: run_settlement()  │  (statement-level)
               └─────────────┬──────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
  settle_ai_            settle_parlay_      settle_parlays()
  suggestions()         legs()              (rollup; early-loss)
        │                    │                    │
        ▼                    ▼                    ▼
  ai_suggestions        parlay_legs            parlays
  .actual_outcome       (all 5 cols atomic)    .status / .final_outcome

       + pg_cron daily safety net at 06:15 UTC calls run_settlement()
```

### SQL object inventory

All in `public` schema. Five functions, one trigger, one cron safety net.

| Object | Type | Purpose |
|---|---|---|
| `determine_outcome(pick, bet_type, point, home_team, away_team, home_score, away_score)` | IMMUTABLE function | Given a pick + game result, return `'won'`, `'lost'`, or `'push'`. Handles Moneyline, Spread, Total, Puck Line. |
| `settle_ai_suggestions()` | plpgsql function, returns `int` | Join pending suggestions to finalized game_results; UPDATE `actual_outcome` + `resolved_at` via `determine_outcome()`. Returns number of rows updated. |
| `settle_parlay_legs()` | plpgsql function, returns `int` | UPDATE legs where `suggestion_id` is set AND the leg is not already in sync with its source suggestion's outcome. Writes all 5 state columns atomically. |
| `settle_parlays()` | plpgsql function, returns `int` | Rollup from legs to parent parlay. Marks `'lost'` early if any leg lost; marks `'completed'` / `'won'` when all non-push legs are won. |
| `run_settlement()` | plpgsql function, returns `table(suggestions_settled int, legs_settled int, parlays_settled int)` | Coordinator. Calls the three in order, logs result to `cron_job_logs`. |
| `trg_settle_on_game_results` | trigger on `game_results` | `AFTER INSERT OR UPDATE ... FOR EACH STATEMENT EXECUTE FUNCTION run_settlement()`. |
| `settlement_daily_safety` | pg_cron job, schedule `15 6 * * *` | Calls `run_settlement()` once a day at 06:15 UTC (right after Railway's backfill). Catches anything the trigger missed. |

### Schema change

One new column on `parlay_legs`:

```sql
ALTER TABLE public.parlay_legs
  ADD COLUMN suggestion_id BIGINT REFERENCES public.ai_suggestions(id);

CREATE INDEX idx_parlay_legs_suggestion_id ON public.parlay_legs(suggestion_id);
```

No NOT NULL constraint — some legacy legs may remain NULL if they can't be backfilled cleanly. New parlay-creation code paths (Spec 1 scope) will set this column going forward.

### Data cleanup — already executed

Before writing this spec, the following happened in the brainstorming session (atomic transaction, verified):

- 11 orphan `parlay_legs` rows deleted (no matching `ai_suggestions` by sport/teams/pick/date).
- Parlay `98a8c85b-21f1-4e4a-91f6-f8c5dde8ec0c` deleted (all 3 of its legs were orphans; would have been left leg-less).
- `parlay_total_legs` corrected on 3 completed parlays to match remaining leg counts (7→3, 12→9, 9→8).

Post-cleanup state: 113 parlay_legs across 20 parlays, zero orphans.

### Linkage backfill (runs once, during migration)

For the 113 remaining legs, populate `suggestion_id`:

```sql
WITH leg_matches AS (
  SELECT
    pl.id AS leg_id,
    (
      SELECT s.id
      FROM public.ai_suggestions s
      WHERE s.sport = pl.sport
        AND LOWER(s.home_team) = LOWER(pl.home_team)
        AND LOWER(s.away_team) = LOWER(pl.away_team)
        AND LOWER(s.pick) = LOWER(pl.pick)
        AND s.game_date::date = pl.game_date
      ORDER BY s.created_at ASC   -- earliest-created_at tiebreaker
      LIMIT 1
    ) AS matched_suggestion_id
  FROM public.parlay_legs pl
  WHERE pl.suggestion_id IS NULL
)
UPDATE public.parlay_legs pl
SET suggestion_id = lm.matched_suggestion_id
FROM leg_matches lm
WHERE pl.id = lm.leg_id
  AND lm.matched_suggestion_id IS NOT NULL;
```

Expected: all 113 legs get `suggestion_id` set (70 unique-match + 43 multi-match, tiebroken by earliest `ai_suggestions.created_at`).

### Code changes beyond SQL

**Update [services/parlay-tracker.js](../../../services/parlay-tracker.js) (or wherever `parlay_legs` rows get inserted)** to write `suggestion_id` for new legs. When the user locks a generator pick into a parlay, the code already has the `ai_suggestions.id` in hand; it just needs to include it in the insert payload.

Exact file location and insert call need to be located during implementation. Grep for `from\('parlay_legs'\)\s*\.insert|INSERT INTO parlay_legs` turned up:
- `services/parlay-tracker.js` — expected primary location
- `create_parlay_legs_table.js` — one-shot setup script, ignore

### Retirement of Supabase edge functions

Same migration that creates the SQL functions will:

```sql
SELECT cron.unschedule('check-outcomes-midnight');
SELECT cron.unschedule('check-outcomes-morning');
SELECT cron.unschedule('check-parlay-outcomes-30min-generous');
SELECT cron.unschedule('check-parlay-outcomes');  -- Railway-facing one
```

The last one is the Railway-facing cron (`0 * * * *` calling `api/cron/check-parlays`). With the new SQL pipeline, Railway's `ParlayOutcomeChecker` and `AISuggestionOutcomeChecker` become dead code — their functionality lives in Postgres now.

**Edge function source files** (`supabase/functions/check-outcomes/`, `supabase/functions/check-parlay-outcomes/`) are not deleted by this spec — they stay in the repo as archived code. A followup cleanup PR can delete them once we've observed the new pipeline is stable for a week.

### The `determine_outcome()` function details

```sql
CREATE OR REPLACE FUNCTION public.determine_outcome(
  pick TEXT,
  bet_type TEXT,
  point NUMERIC,
  home_team TEXT,
  away_team TEXT,
  home_score INT,
  away_score INT
) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  pick_lower TEXT := LOWER(pick);
  home_lower TEXT := LOWER(home_team);
  away_lower TEXT := LOWER(away_team);
  picked_home BOOLEAN;
  total INT;
  adjusted_home NUMERIC;
BEGIN
  -- Null / missing score guard
  IF home_score IS NULL OR away_score IS NULL THEN
    RETURN 'pending';
  END IF;

  CASE bet_type
    WHEN 'Moneyline' THEN
      IF home_score = away_score THEN
        RETURN 'push';
      END IF;
      IF home_score > away_score THEN
        -- Home won
        RETURN CASE WHEN pick_lower LIKE '%' || home_lower || '%' THEN 'won' ELSE 'lost' END;
      ELSE
        -- Away won
        RETURN CASE WHEN pick_lower LIKE '%' || away_lower || '%' THEN 'won' ELSE 'lost' END;
      END IF;

    WHEN 'Spread', 'Puck Line' THEN
      picked_home := pick_lower LIKE '%' || home_lower || '%';
      adjusted_home := home_score + (CASE WHEN picked_home THEN COALESCE(point, 0) ELSE -COALESCE(point, 0) END);
      IF adjusted_home = away_score THEN RETURN 'push';
      ELSIF adjusted_home > away_score THEN RETURN 'won';
      ELSE RETURN 'lost';
      END IF;

    WHEN 'Total', 'Totals' THEN
      total := home_score + away_score;
      IF total = COALESCE(point, 0) THEN RETURN 'push';
      ELSIF pick_lower LIKE '%over%' THEN
        RETURN CASE WHEN total > point THEN 'won' ELSE 'lost' END;
      ELSIF pick_lower LIKE '%under%' THEN
        RETURN CASE WHEN total < point THEN 'won' ELSE 'lost' END;
      ELSE
        RETURN 'pending';  -- Pick text doesn't specify over/under
      END IF;

    ELSE
      RETURN 'pending';  -- Unknown bet_type (e.g., Player Props) stays pending
  END CASE;
END;
$$;
```

Mirrors the JavaScript logic in [lib/services/ai-suggestion-checker.js](../../../lib/services/ai-suggestion-checker.js) (`determineMoneylineOutcome`, `determineSpreadOutcome`, `determineTotalsOutcome`) so behavior is identical to today's Railway flow, just in SQL.

### The `settle_ai_suggestions()` function

```sql
CREATE OR REPLACE FUNCTION public.settle_ai_suggestions()
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  updated_count INT;
BEGIN
  WITH matched AS (
    SELECT
      s.id AS suggestion_id,
      public.determine_outcome(
        s.pick, s.bet_type, s.point,
        gr.home_team_name, gr.away_team_name,
        gr.home_score, gr.away_score
      ) AS computed_outcome
    FROM public.ai_suggestions s
    JOIN public.game_results gr
      ON gr.sport = s.sport
     AND gr.status = 'final'
     AND gr.date BETWEEN s.game_date::date - 1 AND s.game_date::date + 1
     AND (
       (LOWER(gr.home_team_name) = LOWER(s.home_team) AND LOWER(gr.away_team_name) = LOWER(s.away_team))
       OR
       (LOWER(gr.home_team_name) = LOWER(s.away_team) AND LOWER(gr.away_team_name) = LOWER(s.home_team))  -- neutral-site / reversed
     )
    WHERE s.actual_outcome = 'pending'
  )
  UPDATE public.ai_suggestions s
  SET actual_outcome = m.computed_outcome,
      resolved_at = NOW()
  FROM matched m
  WHERE s.id = m.suggestion_id
    AND m.computed_outcome IN ('won', 'lost', 'push');  -- skip 'pending' returns

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
```

Team match uses case-insensitive exact comparison on full team name, with ±1-day date window for timezone edge cases. This is stricter than the current JS fuzzy `.includes()` match and will miss fewer false positives. Known-unmatched NCAAB picks and others remain a Spec 2 problem (game_results population).

### The `settle_parlay_legs()` function

```sql
CREATE OR REPLACE FUNCTION public.settle_parlay_legs()
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  updated_count INT;
BEGIN
  UPDATE public.parlay_legs pl
  SET outcome = s.actual_outcome,
      leg_result = s.actual_outcome,
      game_completed = TRUE,
      resolved_at = NOW(),
      settled_at = COALESCE(pl.settled_at, NOW())
  FROM public.ai_suggestions s
  WHERE pl.suggestion_id = s.id
    AND s.actual_outcome IN ('won', 'lost', 'push')
    AND (
      pl.outcome IS DISTINCT FROM s.actual_outcome
      OR pl.leg_result IS NULL
      OR pl.game_completed IS NOT TRUE
      OR pl.resolved_at IS NULL
    );

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
```

Idempotent: re-running doesn't touch already-consistent rows. The `IS DISTINCT FROM` handles the case where a leg already has an outcome but other state columns are stale (i.e., the 113 half-settled legs in current data).

### The `settle_parlays()` function

```sql
CREATE OR REPLACE FUNCTION public.settle_parlays()
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  early_loss_count INT;
  all_won_count INT;
BEGIN
  -- Mark any pending parlay as LOST if any of its legs lost
  -- (early-loss detection — don't wait for remaining legs to play out)
  -- Stake assumed at $100 flat (no bet_amount column on parlays table today;
  -- matches existing Railway ParlayOutcomeChecker behavior).
  UPDATE public.parlays p
  SET status = 'completed',
      final_outcome = 'lost',
      hit_percentage = (
        SELECT 100.0 * COUNT(*) FILTER (WHERE outcome = 'won') / NULLIF(COUNT(*), 0)
        FROM public.parlay_legs WHERE parlay_id = p.id
      ),
      profit_loss = -100  -- lost stake
  WHERE p.status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.parlay_legs
      WHERE parlay_id = p.id AND outcome = 'lost'
    );
  GET DIAGNOSTICS early_loss_count = ROW_COUNT;

  -- Mark any pending parlay as WON if all non-push legs won and no legs pending
  UPDATE public.parlays p
  SET status = 'completed',
      final_outcome = 'won',
      hit_percentage = 100.0,
      profit_loss = COALESCE(p.potential_payout, 0) - 100  -- net profit = payout - stake
  WHERE p.status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.parlay_legs
      WHERE parlay_id = p.id AND (outcome IS NULL OR outcome = 'pending')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.parlay_legs
      WHERE parlay_id = p.id AND outcome = 'lost'
    )
    AND EXISTS (
      SELECT 1 FROM public.parlay_legs
      WHERE parlay_id = p.id AND outcome = 'won'
    );
  GET DIAGNOSTICS all_won_count = ROW_COUNT;

  RETURN early_loss_count + all_won_count;
END;
$$;
```

Two-stage UPDATE: early-loss first, then full-win. If a parlay has both a lost leg and enough won legs, the first UPDATE gets it and the second ignores it. All-push parlays (rare edge) are not handled specifically — they'd have zero "won" legs and zero "lost" legs, which means neither UPDATE fires. Left deliberately: an all-push parlay is a stake-refund situation and the UI should surface that, but it's a pathological case worth a followup not a main-path fix.

`profit_loss` assumes default $100 stake when `potential_payout` is null. Matches the existing Railway logic.

### The `run_settlement()` coordinator

```sql
CREATE OR REPLACE FUNCTION public.run_settlement()
RETURNS TABLE(suggestions_settled INT, legs_settled INT, parlays_settled INT)
LANGUAGE plpgsql AS $$
DECLARE
  s_count INT;
  l_count INT;
  p_count INT;
BEGIN
  s_count := public.settle_ai_suggestions();
  l_count := public.settle_parlay_legs();
  p_count := public.settle_parlays();

  -- Log to cron_job_logs if any work happened (keep log signal:noise high)
  IF s_count + l_count + p_count > 0 THEN
    INSERT INTO public.cron_job_logs (job_name, status, details)
    VALUES (
      'run_settlement',
      'success',
      jsonb_build_object(
        'suggestions_settled', s_count,
        'legs_settled', l_count,
        'parlays_settled', p_count
      )::text
    );
  END IF;

  RETURN QUERY SELECT s_count, l_count, p_count;
END;
$$;
```

Returns a single-row result set so callers can do `SELECT * FROM run_settlement()` and see the counts. Logs to `cron_job_logs` only when work actually happened, keeping the log readable during quiet periods.

### Trigger & safety net

```sql
CREATE TRIGGER trg_settle_on_game_results
  AFTER INSERT OR UPDATE ON public.game_results
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.run_settlement();

SELECT cron.schedule(
  'settlement_daily_safety',
  '15 6 * * *',  -- 06:15 UTC, right after Railway backfill-game-results-daily at 05:00 UTC
  $$SELECT public.run_settlement();$$
);
```

Trigger is STATEMENT-level (not ROW-level): a batch of 50 games upserted by Railway fires settlement once, not 50 times.

### Retroactive settlement on deploy

Immediately after applying the migration:

```sql
SELECT * FROM public.run_settlement();
```

Expected result: hundreds of `suggestions_settled`, a few dozen `legs_settled`, handful of `parlays_settled`. Clears the stale backlog in one shot.

### Migration file

Single file at `supabase/migrations/<timestamp>_sql_settlement_function.sql` does, in order:

1. `ALTER TABLE parlay_legs ADD COLUMN suggestion_id ...`
2. `CREATE INDEX idx_parlay_legs_suggestion_id ...`
3. Linkage backfill (the CTE update above)
4. `CREATE OR REPLACE FUNCTION determine_outcome(...) ...` through `run_settlement()` — five functions
5. `CREATE TRIGGER trg_settle_on_game_results ...`
6. `SELECT cron.schedule('settlement_daily_safety', ...)`
7. `SELECT cron.unschedule('check-outcomes-midnight')` — 4 unschedule calls
8. `GRANT EXECUTE ON FUNCTION ... TO anon, authenticated, service_role`
9. Commit records results via the final `SELECT run_settlement()` call

## Verification

Before declaring complete:

1. **Linkage coverage.** After migration, `SELECT COUNT(*) FILTER (WHERE suggestion_id IS NULL) FROM parlay_legs` returns 0.
2. **Trigger fires.** `INSERT INTO game_results (<dummy>)` causes a row in `cron_job_logs` with `job_name = 'run_settlement'`. (Or just observe next Railway backfill run.)
3. **Multi-day parlay correctness.** Manually fabricate a parlay with one lost leg and two pending legs → verify `settle_parlays()` marks it lost.
4. **Stale backlog cleared.** Pre-migration `SELECT COUNT(*) FROM ai_suggestions WHERE actual_outcome='pending' AND game_date < NOW() - INTERVAL '24 hours'` minus post-migration same query shows hundreds of settled rows (bounded by game_results coverage — NCAAB / NBA / NHL / MLB / MLS should mostly settle; UFC / EPL / Tennis stay pending until Spec 2).
5. **parlay_legs state columns consistent.** `SELECT COUNT(*) FROM parlay_legs WHERE outcome IS NOT NULL AND (game_completed IS NOT TRUE OR leg_result IS NULL OR resolved_at IS NULL)` returns 0 after migration.
6. **Old pg_cron jobs unscheduled.** `SELECT * FROM cron.job WHERE jobname IN ('check-outcomes-midnight', 'check-outcomes-morning', 'check-parlay-outcomes-30min-generous', 'check-parlay-outcomes')` returns 0 rows.
7. **Future pick creation writes `suggestion_id`.** After implementation, lock a parlay through the UI and verify the new `parlay_legs` row has `suggestion_id` populated.

## Rollback

If settlement breaks something visible in production:

```sql
-- 1. Unschedule the safety cron + drop trigger so no more auto-runs
SELECT cron.unschedule('settlement_daily_safety');
DROP TRIGGER IF EXISTS trg_settle_on_game_results ON public.game_results;

-- 2. Drop the functions (they'll no longer be callable)
DROP FUNCTION IF EXISTS public.run_settlement() CASCADE;
DROP FUNCTION IF EXISTS public.settle_parlays() CASCADE;
DROP FUNCTION IF EXISTS public.settle_parlay_legs() CASCADE;
DROP FUNCTION IF EXISTS public.settle_ai_suggestions() CASCADE;
DROP FUNCTION IF EXISTS public.determine_outcome(TEXT, TEXT, NUMERIC, TEXT, TEXT, INT, INT) CASCADE;

-- 3. Re-schedule the old crons (cron command bodies are in archived migration files)
-- See: docs/superpowers/specs/2026-04-21-sql-settlement-function-design.md "Retirement of Supabase edge functions"

-- 4. Drop the new column (optional — leaving it doesn't hurt)
-- ALTER TABLE public.parlay_legs DROP COLUMN suggestion_id;
```

`parlay_legs` data on the 113 rows with refreshed state columns is NOT reverted — the outcome values are correct, the other state columns just become populated. Not a "rollback" concern. If a specific incorrect settlement is discovered, it's fixed by manual UPDATE, not by reverting the whole feature.

## Out-of-scope follow-ups (queued)

1. **Spec 2 — ESPN backfill coverage.** Fix UFC MMA parser in Railway cron; add EPL (`soccer/eng.1`) to Railway backfill; research Tennis data source (no ESPN scoreboard, API-Sports cancelled — this is research first).
2. **Player Props settlement.** Add a `settle_player_props()` function that joins ai_suggestions to `player_game_stats`. Separate bet-type logic, different data source.
3. **Delete dead edge function source files** (`supabase/functions/check-outcomes/`, `supabase/functions/check-parlay-outcomes/`) after a week of observed stability. Cleanup PR, not architectural.
4. **Fix parlay creation code path to set `suggestion_id`.** This IS in scope for the implementation PR, but might need separate follow-up if the parlay-tracker file has surprises.
5. **Retire Railway's `ParlayOutcomeChecker` and `AISuggestionOutcomeChecker` service files.** Dead code once the new pg_cron is in charge. Can stay as reference or be deleted in the same followup as #3.
