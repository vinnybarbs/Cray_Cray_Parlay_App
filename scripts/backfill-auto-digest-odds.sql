-- scripts/backfill-auto-digest-odds.sql
-- One-shot backfill: populate the `odds` column on auto_digest picks that were
-- written with `odds: null` hardcoded before the pre-analyze-games.js fix
-- (commit b30d2d2). Forward-only fix only caught picks generated after the fix;
-- this script retrofits the historical ~1,280 rows so ROI math can populate
-- for the full dataset in mv_model_accuracy.
--
-- Strategy:
--   Moneyline -> use game_analysis.moneyline_home/away keyed by recommended_side
--   Spread    -> default to industry-standard -110 juice (game_analysis does not
--                store per-side spread juice as a column)
--   Total     -> default to -110 juice (same reason)
--   Unmatched -> leave NULL (34 rows whose teams/date don't match any game_analysis row)
--
-- Idempotent: only updates rows where odds is still NULL/empty.
-- Safe to re-run.

WITH auto_null AS (
  SELECT
    s.id,
    s.bet_type,
    ga.moneyline_home,
    ga.moneyline_away,
    ga.recommended_side
  FROM public.ai_suggestions s
  JOIN public.game_analysis ga
    ON ga.sport = s.sport
   AND ga.home_team = s.home_team
   AND ga.away_team = s.away_team
   AND ga.game_date::date = s.game_date::date
  WHERE s.generate_mode = 'auto_digest'
    AND (s.odds IS NULL OR s.odds = '')
)
UPDATE public.ai_suggestions AS s
SET odds = CASE
  -- Moneyline: use the correct side's American odds from game_analysis
  WHEN an.bet_type = 'Moneyline'
       AND an.recommended_side = 'home_ml'
       AND an.moneyline_home IS NOT NULL THEN
    CASE WHEN an.moneyline_home > 0
         THEN '+' || an.moneyline_home::text
         ELSE an.moneyline_home::text
    END
  WHEN an.bet_type = 'Moneyline'
       AND an.recommended_side = 'away_ml'
       AND an.moneyline_away IS NOT NULL THEN
    CASE WHEN an.moneyline_away > 0
         THEN '+' || an.moneyline_away::text
         ELSE an.moneyline_away::text
    END
  -- Spread / Total: industry-standard -110 juice. Slight underestimate vs actual
  -- (some lines are -105/-115), but conservative for ROI calculation.
  WHEN an.bet_type IN ('Spread', 'Total') THEN '-110'
  -- Moneyline fallback when recommended_side is missing or doesn't match a
  -- home_ml/away_ml pattern (rare edge case — ~2 rows in production data).
  ELSE '-110'
END
FROM auto_null an
WHERE s.id = an.id
  AND (s.odds IS NULL OR s.odds = '');
