-- mv_public_record v7: site-day anchored windows (2026-08-12).
--
-- v6 cut last_3d/7d/30d on game_date >= now() - interval, and game_date
-- is a start INSTANT, so picks exited a window at game start plus
-- exactly 72/168/720 hours: up to a dozen arbitrary exit instants per
-- viewing day, quantized to the hourly :50 refresh. On 2026-08-12 the
-- Sharp Take 3d tile decayed 75 to 50 through an afternoon in which
-- NOTHING settled, purely from Sunday wins aging out one by one
-- (audit: agent reconstruction matched the live MV exactly). Windows
-- now cut on the game's Denver site day: last_3d means today and the
-- two prior Denver days. Membership changes only at Denver midnight or
-- when a game actually settles, which is what a user reading a record
-- expects. America/Denver is the only timezone allowed to produce a
-- calendar day (company rule, 2026-08-10).
--
-- Everything else is byte-identical to v6: base filters, per-domain
-- DISTINCT ON dedupe, trap rows carrying bait-side raw outcomes,
-- decimal-odds ROI. Recreating the MV drops grants, so this migration
-- re-applies them, plus the unique index CONCURRENTLY refresh needs.

DROP MATERIALIZED VIEW IF EXISTS public.mv_public_record;

CREATE MATERIALIZED VIEW public.mv_public_record AS
WITH base AS (
  SELECT DISTINCT ON (s.home_team, s.away_team, s.game_date, (s.tier = 'Trap'), (s.tier = 'Leg'))
    s.id, s.home_team, s.away_team, s.sport, s.bet_type, s.tier,
    s.actual_outcome, s.odds, s.created_at, s.game_date,
    CASE
      WHEN s.odds::text ~ '^[+-]?\d+$' THEN
        CASE
          WHEN s.odds::integer > 0 THEN 1::numeric + s.odds::integer::numeric / 100.0
          WHEN s.odds::integer < 0 THEN 1::numeric + 100.0 / abs(s.odds::integer)::numeric
          ELSE NULL::numeric
        END
      ELSE NULL::numeric
    END AS decimal_odds
  FROM ai_suggestions s
  WHERE s.session_id::text LIKE 'auto_digest%'
    AND s.tier IS NOT NULL
    AND s.voided_at IS NULL
    AND (s.sport::text <> ALL (ARRAY['EPL','MLS','Soccer','World Cup','Champions League','Copa America','Euros']))
  ORDER BY s.home_team, s.away_team, s.game_date, (s.tier = 'Trap'), (s.tier = 'Leg'),
           (s.actual_outcome::text = 'pending'), COALESCE(s.last_revised_at, s.created_at) DESC
),
picks AS (
  SELECT * FROM base WHERE base.tier <> ALL (ARRAY['Trap','Skip','Leg'])
),
tier_pop AS (
  SELECT * FROM picks
  UNION ALL
  SELECT * FROM base WHERE base.tier = 'Trap'
  UNION ALL
  SELECT * FROM base WHERE base.tier = 'Leg'
),
picks_periods AS (
  SELECT p.*, 'all'::text AS period_bucket FROM picks p
  UNION ALL
  SELECT p.*, 'last_30d' FROM picks p
  WHERE (p.game_date AT TIME ZONE 'America/Denver')::date >= (now() AT TIME ZONE 'America/Denver')::date - 29
  UNION ALL
  SELECT p.*, 'last_7d' FROM picks p
  WHERE (p.game_date AT TIME ZONE 'America/Denver')::date >= (now() AT TIME ZONE 'America/Denver')::date - 6
  UNION ALL
  SELECT p.*, 'last_3d' FROM picks p
  WHERE (p.game_date AT TIME ZONE 'America/Denver')::date >= (now() AT TIME ZONE 'America/Denver')::date - 2
),
tier_periods AS (
  SELECT t.*, 'all'::text AS period_bucket FROM tier_pop t
  UNION ALL
  SELECT t.*, 'last_30d' FROM tier_pop t
  WHERE (t.game_date AT TIME ZONE 'America/Denver')::date >= (now() AT TIME ZONE 'America/Denver')::date - 29
  UNION ALL
  SELECT t.*, 'last_7d' FROM tier_pop t
  WHERE (t.game_date AT TIME ZONE 'America/Denver')::date >= (now() AT TIME ZONE 'America/Denver')::date - 6
  UNION ALL
  SELECT t.*, 'last_3d' FROM tier_pop t
  WHERE (t.game_date AT TIME ZONE 'America/Denver')::date >= (now() AT TIME ZONE 'America/Denver')::date - 2
)
SELECT pp.period_bucket,
  'overall'::text AS dimension_type,
  'all'::text AS dimension_value,
  count(*) FILTER (WHERE pp.actual_outcome::text = 'won') AS won,
  count(*) FILTER (WHERE pp.actual_outcome::text = 'lost') AS lost,
  count(*) FILTER (WHERE pp.actual_outcome::text = 'push') AS push,
  count(*) FILTER (WHERE pp.actual_outcome::text = 'pending') AS pending,
  count(*) AS total,
  count(*) FILTER (WHERE pp.actual_outcome::text = ANY (ARRAY['won','lost','push']) AND pp.decimal_odds IS NOT NULL) AS settled_with_odds,
  avg(pp.decimal_odds) FILTER (WHERE pp.actual_outcome::text = ANY (ARRAY['won','lost','push'])) AS avg_decimal_odds,
  sum(CASE
    WHEN pp.actual_outcome::text = 'won' AND pp.decimal_odds IS NOT NULL THEN pp.decimal_odds - 1
    WHEN pp.actual_outcome::text = 'lost' AND pp.decimal_odds IS NOT NULL THEN '-1'::integer::numeric
    ELSE 0::numeric
  END) AS roi_units
FROM picks_periods pp
GROUP BY pp.period_bucket
UNION ALL
SELECT pp.period_bucket, 'sport', pp.sport,
  count(*) FILTER (WHERE pp.actual_outcome::text = 'won'),
  count(*) FILTER (WHERE pp.actual_outcome::text = 'lost'),
  count(*) FILTER (WHERE pp.actual_outcome::text = 'push'),
  count(*) FILTER (WHERE pp.actual_outcome::text = 'pending'),
  count(*),
  count(*) FILTER (WHERE pp.actual_outcome::text = ANY (ARRAY['won','lost','push']) AND pp.decimal_odds IS NOT NULL),
  avg(pp.decimal_odds) FILTER (WHERE pp.actual_outcome::text = ANY (ARRAY['won','lost','push'])),
  sum(CASE
    WHEN pp.actual_outcome::text = 'won' AND pp.decimal_odds IS NOT NULL THEN pp.decimal_odds - 1
    WHEN pp.actual_outcome::text = 'lost' AND pp.decimal_odds IS NOT NULL THEN '-1'::integer::numeric
    ELSE 0::numeric
  END)
FROM picks_periods pp
WHERE pp.sport IS NOT NULL
GROUP BY pp.period_bucket, pp.sport
UNION ALL
SELECT pp.period_bucket, 'bet_type', pp.bet_type,
  count(*) FILTER (WHERE pp.actual_outcome::text = 'won'),
  count(*) FILTER (WHERE pp.actual_outcome::text = 'lost'),
  count(*) FILTER (WHERE pp.actual_outcome::text = 'push'),
  count(*) FILTER (WHERE pp.actual_outcome::text = 'pending'),
  count(*),
  count(*) FILTER (WHERE pp.actual_outcome::text = ANY (ARRAY['won','lost','push']) AND pp.decimal_odds IS NOT NULL),
  avg(pp.decimal_odds) FILTER (WHERE pp.actual_outcome::text = ANY (ARRAY['won','lost','push'])),
  sum(CASE
    WHEN pp.actual_outcome::text = 'won' AND pp.decimal_odds IS NOT NULL THEN pp.decimal_odds - 1
    WHEN pp.actual_outcome::text = 'lost' AND pp.decimal_odds IS NOT NULL THEN '-1'::integer::numeric
    ELSE 0::numeric
  END)
FROM picks_periods pp
WHERE pp.bet_type IS NOT NULL
GROUP BY pp.period_bucket, pp.bet_type
UNION ALL
SELECT tp.period_bucket, 'tier', tp.tier,
  count(*) FILTER (WHERE tp.actual_outcome::text = 'won'),
  count(*) FILTER (WHERE tp.actual_outcome::text = 'lost'),
  count(*) FILTER (WHERE tp.actual_outcome::text = 'push'),
  count(*) FILTER (WHERE tp.actual_outcome::text = 'pending'),
  count(*),
  count(*) FILTER (WHERE tp.actual_outcome::text = ANY (ARRAY['won','lost','push']) AND tp.decimal_odds IS NOT NULL),
  avg(tp.decimal_odds) FILTER (WHERE tp.actual_outcome::text = ANY (ARRAY['won','lost','push'])),
  sum(CASE
    WHEN tp.actual_outcome::text = 'won' AND tp.decimal_odds IS NOT NULL THEN tp.decimal_odds - 1
    WHEN tp.actual_outcome::text = 'lost' AND tp.decimal_odds IS NOT NULL THEN '-1'::integer::numeric
    ELSE 0::numeric
  END)
FROM tier_periods tp
GROUP BY tp.period_bucket, tp.tier;

CREATE UNIQUE INDEX idx_mv_public_record_key
  ON public.mv_public_record (period_bucket, dimension_type, dimension_value);

-- Recreating drops grants. Skipping this silently zeroes every public
-- stat on the site.
GRANT SELECT ON public.mv_public_record TO anon, authenticated, service_role;
