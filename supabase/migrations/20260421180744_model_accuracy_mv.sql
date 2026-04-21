-- supabase/migrations/20260421180744_model_accuracy_mv.sql
-- Model accuracy rollup materialized view — replaces JS-side aggregation.
-- See docs/superpowers/specs/2026-04-21-model-accuracy-rollup-design.md

-- 1. Drop the orphan table that was never populated
DROP TABLE IF EXISTS public.model_accuracy;

-- 2. Create the materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_model_accuracy AS
WITH picks AS (
  SELECT
    id, sport, bet_type, confidence, generate_mode, actual_outcome, odds,
    created_at, game_date,
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
  -- Block 4: edge_integer (auto-modes only)
  SELECT period_bucket, 'edge_integer', confidence::text,
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
  WHERE generate_mode IN ('auto_digest','AI Edge Advantages','Top Picks of the Day','Easy Money','Heavy Favorites')
    AND confidence BETWEEN 1 AND 10
  GROUP BY period_bucket, confidence

  UNION ALL
  -- Block 5: edge_bucket (auto-modes only)
  SELECT period_bucket, 'edge_bucket',
    CASE
      WHEN confidence BETWEEN 1 AND 4  THEN 'Low (1-4)'
      WHEN confidence BETWEEN 5 AND 6  THEN 'Medium (5-6)'
      WHEN confidence BETWEEN 7 AND 8  THEN 'High (7-8)'
      WHEN confidence BETWEEN 9 AND 10 THEN 'Strong (9-10)'
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
  WHERE generate_mode IN ('auto_digest','AI Edge Advantages','Top Picks of the Day','Easy Money','Heavy Favorites')
    AND confidence BETWEEN 1 AND 10
  GROUP BY period_bucket,
    CASE
      WHEN confidence BETWEEN 1 AND 4  THEN 'Low (1-4)'
      WHEN confidence BETWEEN 5 AND 6  THEN 'Medium (5-6)'
      WHEN confidence BETWEEN 7 AND 8  THEN 'High (7-8)'
      WHEN confidence BETWEEN 9 AND 10 THEN 'Strong (9-10)'
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

-- 3. Unique index (required for REFRESH CONCURRENTLY)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_model_accuracy_key
  ON public.mv_model_accuracy (period_bucket, dimension_type, dimension_value);

-- 4. Grants (matching other public read-paths in this project)
GRANT SELECT ON public.mv_model_accuracy TO anon, authenticated, service_role;

-- 5. Schedule two refresh cron jobs tied to check-outcomes runs
SELECT cron.schedule(
  'refresh_mv_model_accuracy_morning',
  '10 6 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_model_accuracy;$$
);

SELECT cron.schedule(
  'refresh_mv_model_accuracy_midnight',
  '10 0 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_model_accuracy;$$
);
