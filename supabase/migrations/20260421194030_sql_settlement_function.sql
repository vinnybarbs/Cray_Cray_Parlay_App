-- supabase/migrations/20260421194030_sql_settlement_function.sql
-- SQL-side settlement pipeline. Replaces the Railway+Supabase-EdgeFn
-- multi-writer approach with a single Postgres trigger + coordinator function.
-- See: docs/superpowers/specs/2026-04-21-sql-settlement-function-design.md

-- ============================================================================
-- SECTION 1: Schema change — add suggestion_id FK to parlay_legs
-- ============================================================================

ALTER TABLE public.parlay_legs
  ADD COLUMN suggestion_id BIGINT REFERENCES public.ai_suggestions(id);

CREATE INDEX idx_parlay_legs_suggestion_id ON public.parlay_legs(suggestion_id);

-- ============================================================================
-- SECTION 2: Linkage backfill — populate suggestion_id for existing 113 legs
-- Match on (sport, home_team, away_team, pick, game_date::date).
-- Tiebreaker: earliest ai_suggestions.created_at.
-- Expected: all 113 legs get a suggestion_id (70 unique-match + 43 multi-matched).
-- ============================================================================

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
      ORDER BY s.created_at ASC
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

-- ============================================================================
-- SECTION 3: determine_outcome() helper function
-- Given a pick + game result, return 'won' / 'lost' / 'push' / 'pending'.
-- Handles Moneyline, Spread, Total, Puck Line. Null-score guard returns pending.
-- ============================================================================

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
  picked_score NUMERIC;
  other_score NUMERIC;
  total INT;
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
        RETURN CASE WHEN pick_lower LIKE '%' || home_lower || '%' THEN 'won' ELSE 'lost' END;
      ELSE
        RETURN CASE WHEN pick_lower LIKE '%' || away_lower || '%' THEN 'won' ELSE 'lost' END;
      END IF;

    WHEN 'Spread', 'Puck Line' THEN
      -- Compute adjusted score of PICKED team, compare to OTHER team.
      -- `point` is stored sign-aware for the picked side (e.g., -7.5 for a home
      -- favorite, +7.5 for an away dog).
      picked_home := pick_lower LIKE '%' || home_lower || '%';
      IF picked_home THEN
        picked_score := home_score + COALESCE(point, 0);
        other_score := away_score;
      ELSE
        picked_score := away_score + COALESCE(point, 0);
        other_score := home_score;
      END IF;
      IF picked_score = other_score THEN RETURN 'push';
      ELSIF picked_score > other_score THEN RETURN 'won';
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

-- ============================================================================
-- SECTION 4: settle_ai_suggestions()
-- Joins pending ai_suggestions to finalized game_results; updates actual_outcome
-- via determine_outcome(). Returns count of rows updated.
-- ============================================================================

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

-- ============================================================================
-- SECTION 5: settle_parlay_legs()
-- Propagates outcome from linked ai_suggestions to parlay_legs. Writes all 5
-- state columns atomically. Idempotent — doesn't touch already-consistent rows.
-- ============================================================================

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

-- ============================================================================
-- SECTION 6: settle_parlays()
-- Rollup from legs to parent parlay. Two-stage:
--   1. Early-loss: any lost leg → parlay immediately 'lost' (don't wait for remaining legs).
--   2. All-won: every leg resolved, no losses, at least one win → parlay 'won'.
-- Stake assumed at $100 flat (no bet_amount column on parlays today — matches
-- existing Railway ParlayOutcomeChecker behavior).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.settle_parlays()
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  early_loss_count INT;
  all_won_count INT;
BEGIN
  -- Mark any pending parlay as LOST if any of its legs lost
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

-- ============================================================================
-- SECTION 7: run_settlement() coordinator
-- Calls the three settlers in order, logs result when work happened.
-- Returns a single-row result set with counts per layer.
-- ============================================================================

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

  -- Log to cron_job_logs only when work actually happened (keeps log readable)
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

-- ============================================================================
-- SECTION 8: Grants
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.determine_outcome(TEXT, TEXT, NUMERIC, TEXT, TEXT, INT, INT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_ai_suggestions() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_parlay_legs() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_parlays() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_settlement() TO anon, authenticated, service_role;

-- ============================================================================
-- SECTION 9: Trigger wrapper + trigger on game_results
-- Postgres trigger functions must RETURN TRIGGER, but run_settlement() returns
-- a count-table for SELECT use. Thin wrapper lets us reuse the coordinator.
-- STATEMENT-level trigger: a batch of 50 games fires settlement once, not 50x.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.run_settlement_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM * FROM public.run_settlement();
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_settlement_trigger() TO anon, authenticated, service_role;

CREATE TRIGGER trg_settle_on_game_results
  AFTER INSERT OR UPDATE ON public.game_results
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.run_settlement_trigger();

-- ============================================================================
-- SECTION 10: Daily safety-net cron
-- Fires right after Railway's backfill-game-results-daily at 05:00 UTC.
-- Catches anything the trigger missed (manual inserts, etc.).
-- ============================================================================

SELECT cron.schedule(
  'settlement_daily_safety',
  '15 6 * * *',
  $$SELECT public.run_settlement();$$
);

-- ============================================================================
-- SECTION 11: Retire old settlement cron jobs
-- Two Supabase-edge-function schedules + two Railway-facing schedules all
-- become obsolete. Edge function source files stay for 1 week before deletion.
-- ============================================================================

SELECT cron.unschedule('check-outcomes-midnight');
SELECT cron.unschedule('check-outcomes-morning');
SELECT cron.unschedule('check-parlay-outcomes-30min-generous');
SELECT cron.unschedule('check-parlay-outcomes');
