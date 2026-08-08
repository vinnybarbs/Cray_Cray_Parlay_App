-- Performance-aware shadow promotion check (2026-08-08).
--
-- The old shadow_model_150_check counted raw reads whose games had
-- finished and alerted at 150. Volume only. It flagged Tennis "ready"
-- while the aggregate of its reads ran 2 points under the market,
-- because 144 of 181 graded reads were sub-2pp sides the model itself
-- called Skips. Judged the way the site judges published picks, on the
-- publishable bucket only (claimed edge 2pp or more), Tennis went 30-7
-- and hit its claimed probability to the decimal. Vince's rule, applied
-- here: if we would call it a Skip, it is not part of the record.
--
-- New bar: a shadow model is ready when its PUBLISHABLE bucket has 75
-- or more graded picks AND their actual win rate meets or beats the
-- vig-stripped implied average. Tennis and UFC grade against their
-- synced results tables. The soccer family has no results join yet and
-- stays volume-only, labeled as such.

-- SQL twin of lib/services/tennis-data.js playerKey: strip accents,
-- lowercase, drop punctuation, collapse spaces.
CREATE OR REPLACE FUNCTION public.player_key_sql(name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(regexp_replace(
    lower(regexp_replace(translate(coalesce(name, ''),
      'áàâäãåéèêëíìîïóòôöõúùûüýçñÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÝÇÑ',
      'aaaaaaeeeeiiiiooooouuuuycnAAAAAAEEEEIIIIOOOOOUUUUYCN'),
      '[^a-zA-Z0-9 ]', '', 'g')),
    '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.shadow_model_readiness()
RETURNS jsonb LANGUAGE sql STABLE AS $fn$
WITH tennis_reads AS (
  SELECT DISTINCT ON (ga.home_team, ga.away_team, ga.game_date::date)
    ga.game_date::date AS d,
    public.player_key_sql(ga.home_team) AS home_key,
    public.player_key_sql(ga.away_team) AS away_key,
    ga.recommended_side,
    CASE WHEN ga.recommended_side = 'home_ml' THEN ga.calc_home_prob ELSE ga.calc_away_prob END AS model_p,
    (CASE WHEN ga.recommended_side = 'home_ml' THEN
        CASE WHEN ga.moneyline_home < 0 THEN -ga.moneyline_home::numeric / (-ga.moneyline_home + 100) ELSE 100.0 / (ga.moneyline_home + 100) END
      ELSE
        CASE WHEN ga.moneyline_away < 0 THEN -ga.moneyline_away::numeric / (-ga.moneyline_away + 100) ELSE 100.0 / (ga.moneyline_away + 100) END
     END) / 1.04 AS fair_implied
  FROM public.game_analysis ga
  WHERE ga.sport = 'Tennis' AND ga.edges IS NOT NULL
    AND ga.game_date >= '2026-07-23' AND ga.game_date < now() - interval '6 hours'
    AND ga.recommended_side IN ('home_ml', 'away_ml')
    AND ga.calc_home_prob IS NOT NULL
    AND (CASE WHEN ga.recommended_side = 'home_ml' THEN ga.moneyline_home ELSE ga.moneyline_away END) IS NOT NULL
),
tennis_graded AS (
  SELECT DISTINCT ON (r.home_key, r.away_key, r.d)
    r.model_p, r.fair_implied,
    (CASE WHEN t.winner_key = r.home_key THEN 'home_ml' ELSE 'away_ml' END = r.recommended_side)::int AS w
  FROM tennis_reads r
  JOIN public.tennis_match_results t
    ON t.match_date BETWEEN r.d - 1 AND r.d + 1
   AND ((t.winner_key = r.home_key AND t.loser_key = r.away_key)
     OR (t.winner_key = r.away_key AND t.loser_key = r.home_key))
),
ufc_reads AS (
  SELECT DISTINCT ON (ga.home_team, ga.away_team, ga.game_date::date)
    ga.game_date::date AS d,
    public.player_key_sql(ga.home_team) AS home_key,
    public.player_key_sql(ga.away_team) AS away_key,
    ga.recommended_side,
    CASE WHEN ga.recommended_side = 'home_ml' THEN ga.calc_home_prob ELSE ga.calc_away_prob END AS model_p,
    (CASE WHEN ga.recommended_side = 'home_ml' THEN
        CASE WHEN ga.moneyline_home < 0 THEN -ga.moneyline_home::numeric / (-ga.moneyline_home + 100) ELSE 100.0 / (ga.moneyline_home + 100) END
      ELSE
        CASE WHEN ga.moneyline_away < 0 THEN -ga.moneyline_away::numeric / (-ga.moneyline_away + 100) ELSE 100.0 / (ga.moneyline_away + 100) END
     END) / 1.04 AS fair_implied
  FROM public.game_analysis ga
  WHERE ga.sport = 'UFC' AND ga.edges IS NOT NULL
    AND ga.game_date >= '2026-07-23' AND ga.game_date < now() - interval '6 hours'
    AND ga.recommended_side IN ('home_ml', 'away_ml')
    AND ga.calc_home_prob IS NOT NULL
    AND (CASE WHEN ga.recommended_side = 'home_ml' THEN ga.moneyline_home ELSE ga.moneyline_away END) IS NOT NULL
),
ufc_graded AS (
  SELECT DISTINCT ON (r.home_key, r.away_key, r.d)
    r.model_p, r.fair_implied,
    (CASE WHEN u.winner_key = r.home_key THEN 'home_ml' ELSE 'away_ml' END = r.recommended_side)::int AS w
  FROM ufc_reads r
  JOIN public.ufc_fight_results u
    ON u.fight_date BETWEEN r.d - 1 AND r.d + 1
   AND ((u.winner_key = r.home_key AND u.loser_key = r.away_key)
     OR (u.winner_key = r.away_key AND u.loser_key = r.home_key))
),
graded_models AS (
  SELECT 'Tennis' AS model, model_p, fair_implied, w FROM tennis_graded
  UNION ALL
  SELECT 'UFC', model_p, fair_implied, w FROM ufc_graded
),
metrics AS (
  SELECT model,
    count(*) AS graded_total,
    count(*) FILTER (WHERE (model_p - fair_implied) * 100 >= 2) AS publishable,
    sum(w) FILTER (WHERE (model_p - fair_implied) * 100 >= 2) AS publishable_wins,
    round(100.0 * sum(w) FILTER (WHERE (model_p - fair_implied) * 100 >= 2)
      / nullif(count(*) FILTER (WHERE (model_p - fair_implied) * 100 >= 2), 0), 1) AS publishable_actual_pct,
    round(avg(fair_implied) FILTER (WHERE (model_p - fair_implied) * 100 >= 2) * 100, 1) AS publishable_implied_pct
  FROM graded_models
  GROUP BY model
),
soccer AS (
  SELECT count(*) AS reads
  FROM public.game_analysis
  WHERE sport IN ('EPL','MLS','Soccer','World Cup','Champions League','Copa America','Euros')
    AND edges IS NOT NULL
    AND game_date >= '2026-07-23' AND game_date < now() - interval '6 hours'
)
SELECT jsonb_build_object(
  'bar', '75 graded publishable picks (claimed 2pp or more) with actual at or above fair implied',
  'models',
    coalesce((SELECT jsonb_object_agg(model, jsonb_build_object(
      'graded_total', graded_total,
      'publishable', publishable,
      'publishable_wins', publishable_wins,
      'publishable_actual_pct', publishable_actual_pct,
      'publishable_implied_pct', publishable_implied_pct,
      'ready', publishable >= 75
        AND publishable_actual_pct IS NOT NULL
        AND publishable_actual_pct >= publishable_implied_pct
    )) FROM metrics), '{}'::jsonb)
    || jsonb_build_object('Soccer', jsonb_build_object(
         'reads', (SELECT reads FROM soccer), 'volume_only', true, 'ready', false)),
  'ready',
    coalesce((SELECT jsonb_agg(model) FROM metrics
      WHERE publishable >= 75
        AND publishable_actual_pct IS NOT NULL
        AND publishable_actual_pct >= publishable_implied_pct), '[]'::jsonb)
)
$fn$;

-- Replace the daily job with the performance-aware version.
SELECT cron.unschedule('shadow_model_150_check');
SELECT cron.schedule(
  'shadow_model_150_check',
  '10 15 * * *',
  $job$
  INSERT INTO public.cron_job_logs (job_name, status, details)
  SELECT 'shadow_model_150_check',
         CASE WHEN jsonb_array_length(r->'ready') > 0 THEN 'alert' ELSE 'ok' END,
         r
  FROM (SELECT public.shadow_model_readiness() AS r) x;
  $job$
);
