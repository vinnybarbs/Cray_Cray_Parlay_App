-- mv_public_record v2: one row per game, and the Trap Record joins the
-- tier dimension.
--
-- 1. DEDUP. A game that sat on the board across several daily sessions
--    published one row per session (same game, drifting odds, sometimes
--    two different tiers). One loss could settle as two or three. The
--    record now counts the final pre-start version per
--    (home_team, away_team, game_date), matching the published
--    methodology: revisions replace, never add. Raw rows stay untouched
--    in ai_suggestions.
-- 2. TRAP TIER ROWS. Traps are graded on their own record: the named
--    side losing means the call was right. They appear ONLY in the tier
--    dimension, with raw outcomes (the Landing UI inverts the reading),
--    and never enter the overall, sport, or bet_type aggregates.
--    roi_units for the Trap row is the cost of BETTING the traps, not of
--    fading them. Display code should ignore it.
--
-- Refreshed by refresh_mv_model_accuracy() via pg_cron twice daily.
-- CONCURRENTLY refresh requires the unique index recreated at the bottom.

DROP MATERIALIZED VIEW IF EXISTS public.mv_public_record;

CREATE MATERIALIZED VIEW public.mv_public_record AS
WITH base AS (
  SELECT DISTINCT ON (s.home_team, s.away_team, s.game_date)
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
    AND s.sport::text NOT IN ('EPL','MLS','Soccer','World Cup','Champions League','Copa America','Euros')
  -- Settled siblings outrank pending ones: if settlement graded an older
  -- revision and a newer zombie row never settled, the graded row is the
  -- record. Within the same outcome class, latest revision wins.
  ORDER BY s.home_team, s.away_team, s.game_date,
           (s.actual_outcome::text = 'pending') ASC,
           COALESCE(s.last_revised_at, s.created_at) DESC
),
picks AS (
  SELECT * FROM base WHERE tier NOT IN ('Trap', 'Skip')
),
tier_pop AS (
  SELECT * FROM picks
  UNION ALL
  SELECT * FROM base WHERE tier = 'Trap'
),
picks_periods AS (
  SELECT p.*, 'all'::text AS period_bucket FROM picks p
  UNION ALL
  SELECT p.*, 'last_30d'::text FROM picks p WHERE p.game_date >= now() - interval '30 days'
  UNION ALL
  SELECT p.*, 'last_7d'::text FROM picks p WHERE p.game_date >= now() - interval '7 days'
),
tier_periods AS (
  SELECT t.*, 'all'::text AS period_bucket FROM tier_pop t
  UNION ALL
  SELECT t.*, 'last_30d'::text FROM tier_pop t WHERE t.game_date >= now() - interval '30 days'
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
