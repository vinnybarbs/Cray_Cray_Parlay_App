-- Retroactive correction, pre-NFL launch (2026-08-06 calibration review).
--
-- The MLB:spread edge_calibration row kept a 0.60 multiplier seeded
-- 2026-07-10 while its own stored measurement said the edge carries no
-- information (measured_k -0.04 on 424 samples). The weekly refresh
-- could not override the seed until 80 post-restart spread samples
-- existed (62 at review time), so for four weeks the pipeline published
-- MLB spread picks whose stated edges were scaled noise. With a correct
-- multiplier of 0 none of them clears the 2pp publish floor, so the
-- accurate history is that they were never picks at all.
--
-- Correction mechanics: rows are VOIDED, not deleted. voided_at and
-- voided_reason stay on the row for auditability and reversal, and
-- mv_public_record v6 excludes voided rows from every dimension. The
-- multiplier itself is zeroed as a data operation alongside this
-- migration (source manual-zero, so the weekly refresh reclaims the key
-- once real evidence reaches its 80-sample threshold).

ALTER TABLE public.ai_suggestions
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_reason text;

UPDATE public.ai_suggestions
SET voided_at = now(),
    voided_reason = 'mlb-spread-0.60-seed-miscalibration (2026-08-06 review)'
WHERE sport = 'MLB'
  AND bet_type = 'Spread'
  AND session_id LIKE 'auto_digest%'
  AND game_date >= '2026-07-10'
  AND voided_at IS NULL;

-- mv_public_record v6: identical to v5 plus the voided filter in base.

DROP MATERIALIZED VIEW IF EXISTS public.mv_public_record;

CREATE MATERIALIZED VIEW public.mv_public_record AS
WITH base AS (
  SELECT DISTINCT ON (s.home_team, s.away_team, s.game_date, (s.tier::text = 'Trap'), (s.tier::text = 'Leg'))
         s.id, s.home_team, s.away_team, s.sport, s.bet_type, s.tier,
         s.actual_outcome, s.odds, s.created_at, s.game_date,
         CASE WHEN s.odds::text ~ '^[+-]?\d+$' THEN
           CASE
             WHEN s.odds::integer > 0 THEN 1::numeric + s.odds::integer / 100.0
             WHEN s.odds::integer < 0 THEN 1::numeric + 100.0 / abs(s.odds::integer)
             ELSE NULL::numeric
           END
         ELSE NULL::numeric END AS decimal_odds
  FROM public.ai_suggestions s
  WHERE s.session_id::text LIKE 'auto_digest%'
    AND s.tier IS NOT NULL
    AND s.voided_at IS NULL
    AND s.sport::text NOT IN ('EPL','MLS','Soccer','World Cup','Champions League','Copa America','Euros')
  ORDER BY s.home_team, s.away_team, s.game_date, (s.tier::text = 'Trap'), (s.tier::text = 'Leg'),
           (s.actual_outcome::text = 'pending') ASC,
           COALESCE(s.last_revised_at, s.created_at) DESC
),
picks AS (
  SELECT * FROM base WHERE tier NOT IN ('Trap', 'Skip', 'Leg')
),
tier_pop AS (
  SELECT * FROM picks
  UNION ALL
  SELECT * FROM base WHERE tier = 'Trap'
  UNION ALL
  SELECT * FROM base WHERE tier = 'Leg'
),
picks_periods AS (
  SELECT p.*, 'all'::text AS period_bucket FROM picks p
  UNION ALL
  SELECT p.*, 'last_30d'::text FROM picks p WHERE p.game_date >= now() - interval '30 days'
  UNION ALL
  SELECT p.*, 'last_3d'::text FROM picks p WHERE p.game_date >= now() - interval '3 days'
  UNION ALL
  SELECT p.*, 'last_7d'::text FROM picks p WHERE p.game_date >= now() - interval '7 days'
),
tier_periods AS (
  SELECT t.*, 'all'::text AS period_bucket FROM tier_pop t
  UNION ALL
  SELECT t.*, 'last_30d'::text FROM tier_pop t WHERE t.game_date >= now() - interval '30 days'
  UNION ALL
  SELECT t.*, 'last_3d'::text FROM tier_pop t WHERE t.game_date >= now() - interval '3 days'
  UNION ALL
  SELECT t.*, 'last_7d'::text FROM tier_pop t WHERE t.game_date >= now() - interval '7 days'
)
SELECT period_bucket,
       'overall'::text AS dimension_type,
       'all'::text AS dimension_value,
       count(*) FILTER (WHERE actual_outcome::text = 'won') AS won,
       count(*) FILTER (WHERE actual_outcome::text = 'lost') AS lost,
       count(*) FILTER (WHERE actual_outcome::text = 'push') AS push,
       count(*) FILTER (WHERE actual_outcome::text = 'pending') AS pending,
       count(*) AS total,
       count(*) FILTER (WHERE actual_outcome::text IN ('won','lost','push') AND decimal_odds IS NOT NULL) AS settled_with_odds,
       avg(decimal_odds) FILTER (WHERE actual_outcome::text IN ('won','lost','push')) AS avg_decimal_odds,
       sum(CASE WHEN actual_outcome::text = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1::numeric
                WHEN actual_outcome::text = 'lost' AND decimal_odds IS NOT NULL THEN '-1'::integer::numeric
                ELSE 0::numeric END) AS roi_units
FROM picks_periods
GROUP BY period_bucket

UNION ALL

SELECT period_bucket,
       'sport'::text,
       sport,
       count(*) FILTER (WHERE actual_outcome::text = 'won'),
       count(*) FILTER (WHERE actual_outcome::text = 'lost'),
       count(*) FILTER (WHERE actual_outcome::text = 'push'),
       count(*) FILTER (WHERE actual_outcome::text = 'pending'),
       count(*),
       count(*) FILTER (WHERE actual_outcome::text IN ('won','lost','push') AND decimal_odds IS NOT NULL),
       avg(decimal_odds) FILTER (WHERE actual_outcome::text IN ('won','lost','push')),
       sum(CASE WHEN actual_outcome::text = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1::numeric
                WHEN actual_outcome::text = 'lost' AND decimal_odds IS NOT NULL THEN '-1'::integer::numeric
                ELSE 0::numeric END)
FROM picks_periods
WHERE sport IS NOT NULL
GROUP BY period_bucket, sport

UNION ALL

SELECT period_bucket,
       'bet_type'::text,
       bet_type,
       count(*) FILTER (WHERE actual_outcome::text = 'won'),
       count(*) FILTER (WHERE actual_outcome::text = 'lost'),
       count(*) FILTER (WHERE actual_outcome::text = 'push'),
       count(*) FILTER (WHERE actual_outcome::text = 'pending'),
       count(*),
       count(*) FILTER (WHERE actual_outcome::text IN ('won','lost','push') AND decimal_odds IS NOT NULL),
       avg(decimal_odds) FILTER (WHERE actual_outcome::text IN ('won','lost','push')),
       sum(CASE WHEN actual_outcome::text = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1::numeric
                WHEN actual_outcome::text = 'lost' AND decimal_odds IS NOT NULL THEN '-1'::integer::numeric
                ELSE 0::numeric END)
FROM picks_periods
WHERE bet_type IS NOT NULL
GROUP BY period_bucket, bet_type

UNION ALL

SELECT period_bucket,
       'tier'::text,
       tier,
       count(*) FILTER (WHERE actual_outcome::text = 'won'),
       count(*) FILTER (WHERE actual_outcome::text = 'lost'),
       count(*) FILTER (WHERE actual_outcome::text = 'push'),
       count(*) FILTER (WHERE actual_outcome::text = 'pending'),
       count(*),
       count(*) FILTER (WHERE actual_outcome::text IN ('won','lost','push') AND decimal_odds IS NOT NULL),
       avg(decimal_odds) FILTER (WHERE actual_outcome::text IN ('won','lost','push')),
       sum(CASE WHEN actual_outcome::text = 'won'  AND decimal_odds IS NOT NULL THEN decimal_odds - 1::numeric
                WHEN actual_outcome::text = 'lost' AND decimal_odds IS NOT NULL THEN '-1'::integer::numeric
                ELSE 0::numeric END)
FROM tier_periods
GROUP BY period_bucket, tier;

CREATE UNIQUE INDEX idx_mv_public_record_key
  ON public.mv_public_record (period_bucket, dimension_type, dimension_value);

-- Recreating the MV drops its grants. Without these the site's public
-- stats silently zero out.
GRANT SELECT ON public.mv_public_record TO anon, authenticated, service_role;
