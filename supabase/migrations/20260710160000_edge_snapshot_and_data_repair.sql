-- supabase/migrations/20260710160000_edge_snapshot_and_data_repair.sql
--
-- Edge snapshot + one-time data repair.
--
-- Why: ai_suggestions never stored the edge that justified each pick, so
-- win-rate-by-edge analysis required a fragile join to game_analysis (a
-- mutable cache that only has per-side edges from May 2026 onward). This
-- migration adds pick-time snapshot columns, backfills what the cache can
-- still prove, repairs the historical wrong-side odds rows, and voids
-- pending picks that have no settlement path.
--
-- Tier thresholds mirror edgeTier() in src/pages/DailyDigest.jsx:
--   <0 Trap | <2 Skip | <4 Lean | <7 Play | <10 Strong Play | >=10 Sharp Take

-- 1. Snapshot columns ------------------------------------------------------

ALTER TABLE public.ai_suggestions
  ADD COLUMN IF NOT EXISTS edge_pp       numeric,      -- signed pp for the picked market, capped (what the UI showed)
  ADD COLUMN IF NOT EXISTS edge_pp_raw   numeric,      -- signed pp before the +/-15pp cap (backfill = capped value; live writes supply true raw)
  ADD COLUMN IF NOT EXISTS tier          text,         -- Trap/Skip/Lean/Play/Strong Play/Sharp Take at pick time
  ADD COLUMN IF NOT EXISTS model_prob    numeric,      -- model win prob of the picked side (ML picks)
  ADD COLUMN IF NOT EXISTS implied_prob  numeric,      -- vig-free market prob of the picked side (ML picks)
  ADD COLUMN IF NOT EXISTS odds_before_repair varchar; -- original odds value where the 2026-04/05 wrong-side bug was repaired

COMMENT ON COLUMN public.ai_suggestions.edge_pp IS
  'Signed pp edge of the picked market, snapshotted at pick time (capped at +/-15). Source of truth for win-rate-by-edge analysis.';

-- Uncapped per-side edges alongside the capped dict the tiles use.
ALTER TABLE public.game_analysis
  ADD COLUMN IF NOT EXISTS edges_raw jsonb;

-- 2. Odds repair -----------------------------------------------------------
-- 2026-04/05 era rows stored the other side's price in odds while the pick
-- text carried the real price (e.g. pick "Jannik Sinner -9400", odds "+1660").
-- The writer was fixed in May ("math picks, LLM narrates"); this repairs the
-- 848 historical rows. Original value is preserved in odds_before_repair.

UPDATE public.ai_suggestions
SET odds_before_repair = odds,
    odds = substring(pick FROM '([+-]\d{3,5})\s*$')
WHERE odds ~ '^[+-]?\d+$'
  AND substring(pick FROM '([+-]\d{3,5})\s*$') IS NOT NULL
  AND replace(substring(pick FROM '([+-]\d{3,5})\s*$'), '+', '')::numeric
      <> replace(odds, '+', '')::numeric;

-- 3. Backfill edge snapshot from game_analysis where it can still be proven -

WITH matched AS (
  SELECT s.id,
    CASE
      WHEN s.bet_type = 'Total'     AND s.pick ILIKE 'over%'              THEN (g.edges->>'over')::numeric
      WHEN s.bet_type = 'Total'     AND s.pick ILIKE 'under%'             THEN (g.edges->>'under')::numeric
      WHEN s.bet_type = 'Moneyline' AND s.pick ILIKE s.home_team || '%'   THEN (g.edges->>'home_ml')::numeric
      WHEN s.bet_type = 'Moneyline' AND s.pick ILIKE s.away_team || '%'   THEN (g.edges->>'away_ml')::numeric
      WHEN s.bet_type = 'Spread'    AND s.pick ILIKE s.home_team || '%'   THEN (g.edges->>'home_spread')::numeric
      WHEN s.bet_type = 'Spread'    AND s.pick ILIKE s.away_team || '%'   THEN (g.edges->>'away_spread')::numeric
    END AS edge_frac,
    CASE
      WHEN s.bet_type = 'Moneyline' AND s.pick ILIKE s.home_team || '%' THEN g.calc_home_prob
      WHEN s.bet_type = 'Moneyline' AND s.pick ILIKE s.away_team || '%' THEN g.calc_away_prob
    END AS m_prob,
    CASE
      WHEN s.bet_type = 'Moneyline' AND s.pick ILIKE s.home_team || '%' THEN g.implied_home_prob
      WHEN s.bet_type = 'Moneyline' AND s.pick ILIKE s.away_team || '%' THEN g.implied_away_prob
    END AS i_prob
  FROM public.ai_suggestions s
  JOIN LATERAL (
    SELECT * FROM public.game_analysis g
    WHERE g.sport = s.sport
      AND g.home_team = s.home_team
      AND g.away_team = s.away_team
      AND g.game_date::date = s.game_date::date
      AND g.edges IS NOT NULL
    ORDER BY g.generated_at DESC
    LIMIT 1
  ) g ON TRUE
  WHERE s.edge_pp IS NULL
)
UPDATE public.ai_suggestions s
SET edge_pp      = round(m.edge_frac * 100, 1),
    edge_pp_raw  = round(m.edge_frac * 100, 1),
    model_prob   = m.m_prob,
    implied_prob = m.i_prob,
    tier = CASE
      WHEN m.edge_frac * 100 < 0  THEN 'Trap'
      WHEN m.edge_frac * 100 < 2  THEN 'Skip'
      WHEN m.edge_frac * 100 < 4  THEN 'Lean'
      WHEN m.edge_frac * 100 < 7  THEN 'Play'
      WHEN m.edge_frac * 100 < 10 THEN 'Strong Play'
      ELSE 'Sharp Take'
    END
FROM matched m
WHERE m.id = s.id
  AND m.edge_frac IS NOT NULL;

-- 4. Void pending picks with no settlement path -----------------------------
-- UFC has no results ingestion, old tennis and player-prop rows predate their
-- settlers, and a handful carry corrupted 2023 game dates. Anything still
-- pending a week after its game date will never settle on its own; voiding
-- removes it from pending counts without pretending it was graded.

UPDATE public.ai_suggestions
SET actual_outcome = 'void',
    resolved_at = now()
WHERE actual_outcome = 'pending'
  AND game_date < now() - interval '7 days';

-- 5. Index for the analytics that will group by edge ------------------------

CREATE INDEX IF NOT EXISTS idx_ai_suggestions_edge_pp
  ON public.ai_suggestions (edge_pp)
  WHERE edge_pp IS NOT NULL;
