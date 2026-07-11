-- supabase/migrations/20260710161500_model_accuracy_mv_v2.sql
--
-- mv_model_accuracy v2 — measure what predicts, drop what doesn't.
--
-- Changes vs v1 (20260421180744):
--   * edge_integer / edge_bucket dimensions removed. They bucketed the LLM's
--     1-10 confidence, which live data shows is noise (conf 5 wins 42.9%,
--     conf 8 wins 54.2%). Labeling it "edge" on the Track Record was wrong.
--   * New `tier` dimension keyed on ai_suggestions.tier (the pick-time
--     Trap/Skip/Lean/Play/Strong Play/Sharp Take snapshot). This is what
--     /api/public-stats has been waiting on to publish hit rate by tier.
--   * New `edge_pp_bucket` dimension on the pick-time signed pp ranges the
--     calibration loop reads (win % rises monotonically with pp).
--   * `void` outcomes excluded everywhere — voided rows are unsettleable
--     picks (UFC, dead markets), not results.

DROP MATERIALIZED VIEW IF EXISTS public.mv_model_accuracy;

CREATE MATERIALIZED VIEW public.mv_model_accuracy AS
WITH picks AS (
  SELECT
    id, sport, bet_type, confidence, generate_mode, actual_outcome, odds,
    created_at, game_date, edge_pp, tier,
    CASE
      WHEN odds ~ '^[+-]?\d+$' THEN
        CASE
          WHEN odds::int > 0 THEN 1 + odds::int / 100.0
          WHEN odds::int < 0 THEN 1 + 100.0 / abs(odds::int)
          ELSE NULL
        END
      ELSE NULL
    END AS decimal_odds
  FROM public.ai_suggestions
  WHERE actual_outcome IS DISTINCT FROM 'void'
),
picks_periods AS (
  SELECT picks.*, 'all'::text AS period_bucket FROM picks
  UNION ALL
  SELECT picks.*, 'last_30d' FROM picks WHERE game_date >= NOW() - INTERVAL '30 days'
  UNION ALL
  SELECT picks.*, 'last_7d'  FROM picks WHERE game_date >= NOW() - INTERVAL '7 days'
),
aggs AS (
  -- Block 1: overall
  SELECT
    period_bucket,
    'overall'::text AS dimension_type,
    'all'::text AS dimension_value,
    COUNT(*) FILTER (WHERE actual_outcome = 'won')     AS won,
    COUNT(*) FILTER (WHERE actual_outcome = 'lost')    AS lost,
    COUNT(*) FILTER (WHERE actual_outcome = 'push')    AS push,
    COUNT(*) FILTER (WHERE actual_outcome = 'pending') AS pending,
    COUNT(*)                                           AS total,
    COUNT(*) FILTER (WHERE actual_outcome IN ('won','lost','push') AND decimal_odds IS NOT NULL) AS settled_with_odds,
    AVG(decimal_odds) FILTER (WHERE actual_outcome IN ('won','lost','push')) AS avg_decimal_odds,
    SUM(CASE
      WHEN actual_outcome = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1
      WHEN actual_outcome = 'lost' AND decimal_odds IS NOT NULL THEN -1
      ELSE 0
    END) AS roi_units
  FROM picks_periods
  GROUP BY period_bucket

  UNION ALL
  -- Block 2: sport
  SELECT period_bucket, 'sport', sport,
    COUNT(*) FILTER (WHERE actual_outcome = 'won'),
    COUNT(*) FILTER (WHERE actual_outcome = 'lost'),
    COUNT(*) FILTER (WHERE actual_outcome = 'push'),
    COUNT(*) FILTER (WHERE actual_outcome = 'pending'),
    COUNT(*),
    COUNT(*) FILTER (WHERE actual_outcome IN ('won','lost','push') AND decimal_odds IS NOT NULL),
    AVG(decimal_odds) FILTER (WHERE actual_outcome IN ('won','lost','push')),
    SUM(CASE
      WHEN actual_outcome = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1
      WHEN actual_outcome = 'lost' AND decimal_odds IS NOT NULL THEN -1
      ELSE 0 END)
  FROM picks_periods
  WHERE sport IS NOT NULL
  GROUP BY period_bucket, sport

  UNION ALL
  -- Block 3: bet_type
  SELECT period_bucket, 'bet_type', bet_type,
    COUNT(*) FILTER (WHERE actual_outcome = 'won'),
    COUNT(*) FILTER (WHERE actual_outcome = 'lost'),
    COUNT(*) FILTER (WHERE actual_outcome = 'push'),
    COUNT(*) FILTER (WHERE actual_outcome = 'pending'),
    COUNT(*),
    COUNT(*) FILTER (WHERE actual_outcome IN ('won','lost','push') AND decimal_odds IS NOT NULL),
    AVG(decimal_odds) FILTER (WHERE actual_outcome IN ('won','lost','push')),
    SUM(CASE
      WHEN actual_outcome = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1
      WHEN actual_outcome = 'lost' AND decimal_odds IS NOT NULL THEN -1
      ELSE 0 END)
  FROM picks_periods
  WHERE bet_type IS NOT NULL
  GROUP BY period_bucket, bet_type

  UNION ALL
  -- Block 4: tier (pick-time edge tier snapshot)
  SELECT period_bucket, 'tier', tier,
    COUNT(*) FILTER (WHERE actual_outcome = 'won'),
    COUNT(*) FILTER (WHERE actual_outcome = 'lost'),
    COUNT(*) FILTER (WHERE actual_outcome = 'push'),
    COUNT(*) FILTER (WHERE actual_outcome = 'pending'),
    COUNT(*),
    COUNT(*) FILTER (WHERE actual_outcome IN ('won','lost','push') AND decimal_odds IS NOT NULL),
    AVG(decimal_odds) FILTER (WHERE actual_outcome IN ('won','lost','push')),
    SUM(CASE
      WHEN actual_outcome = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1
      WHEN actual_outcome = 'lost' AND decimal_odds IS NOT NULL THEN -1
      ELSE 0 END)
  FROM picks_periods
  WHERE tier IS NOT NULL
  GROUP BY period_bucket, tier

  UNION ALL
  -- Block 5: edge_pp_bucket (pick-time signed pp ranges)
  SELECT period_bucket, 'edge_pp_bucket',
    CASE
      WHEN edge_pp < 0   THEN 'Under 0pp'
      WHEN edge_pp < 2   THEN '0-2pp'
      WHEN edge_pp < 4   THEN '2-4pp'
      WHEN edge_pp < 7   THEN '4-7pp'
      WHEN edge_pp < 10  THEN '7-10pp'
      WHEN edge_pp < 15  THEN '10-15pp'
      ELSE '15pp (cap)'
    END,
    COUNT(*) FILTER (WHERE actual_outcome = 'won'),
    COUNT(*) FILTER (WHERE actual_outcome = 'lost'),
    COUNT(*) FILTER (WHERE actual_outcome = 'push'),
    COUNT(*) FILTER (WHERE actual_outcome = 'pending'),
    COUNT(*),
    COUNT(*) FILTER (WHERE actual_outcome IN ('won','lost','push') AND decimal_odds IS NOT NULL),
    AVG(decimal_odds) FILTER (WHERE actual_outcome IN ('won','lost','push')),
    SUM(CASE
      WHEN actual_outcome = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1
      WHEN actual_outcome = 'lost' AND decimal_odds IS NOT NULL THEN -1
      ELSE 0 END)
  FROM picks_periods
  WHERE edge_pp IS NOT NULL
  GROUP BY period_bucket,
    CASE
      WHEN edge_pp < 0   THEN 'Under 0pp'
      WHEN edge_pp < 2   THEN '0-2pp'
      WHEN edge_pp < 4   THEN '2-4pp'
      WHEN edge_pp < 7   THEN '4-7pp'
      WHEN edge_pp < 10  THEN '7-10pp'
      WHEN edge_pp < 15  THEN '10-15pp'
      ELSE '15pp (cap)'
    END

  UNION ALL
  -- Block 6: generate_mode
  SELECT period_bucket, 'generate_mode', generate_mode,
    COUNT(*) FILTER (WHERE actual_outcome = 'won'),
    COUNT(*) FILTER (WHERE actual_outcome = 'lost'),
    COUNT(*) FILTER (WHERE actual_outcome = 'push'),
    COUNT(*) FILTER (WHERE actual_outcome = 'pending'),
    COUNT(*),
    COUNT(*) FILTER (WHERE actual_outcome IN ('won','lost','push') AND decimal_odds IS NOT NULL),
    AVG(decimal_odds) FILTER (WHERE actual_outcome IN ('won','lost','push')),
    SUM(CASE
      WHEN actual_outcome = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1
      WHEN actual_outcome = 'lost' AND decimal_odds IS NOT NULL THEN -1
      ELSE 0 END)
  FROM picks_periods
  WHERE generate_mode IS NOT NULL
  GROUP BY period_bucket, generate_mode

  UNION ALL
  -- Block 7: chat_confidence (degenny_chat only)
  SELECT period_bucket, 'chat_confidence', confidence::text,
    COUNT(*) FILTER (WHERE actual_outcome = 'won'),
    COUNT(*) FILTER (WHERE actual_outcome = 'lost'),
    COUNT(*) FILTER (WHERE actual_outcome = 'push'),
    COUNT(*) FILTER (WHERE actual_outcome = 'pending'),
    COUNT(*),
    COUNT(*) FILTER (WHERE actual_outcome IN ('won','lost','push') AND decimal_odds IS NOT NULL),
    AVG(decimal_odds) FILTER (WHERE actual_outcome IN ('won','lost','push')),
    SUM(CASE
      WHEN actual_outcome = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1
      WHEN actual_outcome = 'lost' AND decimal_odds IS NOT NULL THEN -1
      ELSE 0 END)
  FROM picks_periods
  WHERE generate_mode = 'degenny_chat'
    AND confidence BETWEEN 1 AND 10
  GROUP BY period_bucket, confidence
)
SELECT
  period_bucket, dimension_type, dimension_value,
  won, lost, push, pending, total,
  settled_with_odds, avg_decimal_odds, roi_units,
  CASE
    WHEN settled_with_odds > 0 THEN roi_units / settled_with_odds * 100
    ELSE NULL
  END AS roi_pct,
  NOW() AS updated_at
FROM aggs;

-- Unique index (required for REFRESH CONCURRENTLY; same key as v1)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_model_accuracy_key
  ON public.mv_model_accuracy (period_bucket, dimension_type, dimension_value);

GRANT SELECT ON public.mv_model_accuracy TO anon, authenticated, service_role;

-- Refresh crons from v1 ('refresh_mv_model_accuracy_morning'/'_midnight')
-- reference the view by name and keep working unchanged.
