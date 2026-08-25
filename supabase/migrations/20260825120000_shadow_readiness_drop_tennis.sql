-- shadow_model_readiness v2: stop reporting Tennis as a shadow model.
--
-- Tennis was promoted to production 2026-08-10 (owner direction) and has
-- published hundreds of graded picks since, but this function still
-- graded it against the 75-pick promotion bar, so the daily check kept
-- reporting promotion progress for a sport that already promoted. The
-- owner read that as "tennis should be in prod" every day while tennis
-- was, in fact, in prod.
--
-- v2 keeps the UFC and soccer shadow sections unchanged and replaces the
-- Tennis metrics with a static in_production marker. Tennis performance
-- now belongs to the public record and the weekly review, not the
-- shadow grader.
CREATE OR REPLACE FUNCTION public.shadow_model_readiness()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
WITH ufc_reads AS (
  SELECT DISTINCT ON (ga.home_team, ga.away_team, ga.game_date::date)
    ga.game_date::date AS d,
    public.player_key_sql(ga.home_team) AS home_key,
    public.player_key_sql(ga.away_team) AS away_key,
    ga.recommended_side,
    CASE WHEN ga.recommended_side = 'home_ml' THEN ga.calc_home_prob ELSE ga.calc_away_prob END AS model_p,
    CASE WHEN ga.recommended_side = 'home_ml' THEN ga.moneyline_home ELSE ga.moneyline_away END AS price,
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
    r.model_p, r.fair_implied, r.price,
    (CASE WHEN u.winner_key = r.home_key THEN 'home_ml' ELSE 'away_ml' END = r.recommended_side)::int AS w
  FROM ufc_reads r
  JOIN public.ufc_fight_results u
    ON u.fight_date BETWEEN r.d - 1 AND r.d + 1
   AND ((u.winner_key = r.home_key AND u.loser_key = r.away_key)
     OR (u.winner_key = r.away_key AND u.loser_key = r.home_key))
),
metrics AS (
  SELECT 'UFC' AS model,
    count(*) AS graded_total,
    count(*) FILTER (WHERE (model_p - fair_implied) * 100 >= 2) AS publishable,
    sum(w) FILTER (WHERE (model_p - fair_implied) * 100 >= 2) AS publishable_wins,
    round(100.0 * sum(w) FILTER (WHERE (model_p - fair_implied) * 100 >= 2)
      / nullif(count(*) FILTER (WHERE (model_p - fair_implied) * 100 >= 2), 0), 1) AS publishable_actual_pct,
    round(avg(fair_implied) FILTER (WHERE (model_p - fair_implied) * 100 >= 2) * 100, 1) AS publishable_implied_pct,
    round(sum(CASE WHEN w = 1 THEN (CASE WHEN price > 0 THEN price / 100.0 ELSE 100.0 / -price END) ELSE -1 END)
      FILTER (WHERE (model_p - fair_implied) * 100 >= 2)::numeric, 2) AS publishable_units
  FROM ufc_graded
),
soccer AS (
  SELECT count(*) AS reads
  FROM public.game_analysis
  WHERE sport IN ('EPL','MLS','Soccer','World Cup','Champions League','Copa America','Euros')
    AND edges IS NOT NULL
    AND game_date >= '2026-07-23' AND game_date < now() - interval '6 hours'
)
SELECT jsonb_build_object(
  'bar', '75 graded publishable picks (claimed 2pp or more) with actual at or above fair implied AND positive units at bettable prices',
  'models',
    coalesce((SELECT jsonb_object_agg(model, jsonb_build_object(
      'graded_total', graded_total,
      'publishable', publishable,
      'publishable_wins', publishable_wins,
      'publishable_actual_pct', publishable_actual_pct,
      'publishable_implied_pct', publishable_implied_pct,
      'publishable_units', publishable_units,
      'ready', publishable >= 75
        AND publishable_actual_pct IS NOT NULL
        AND publishable_actual_pct >= publishable_implied_pct
        AND publishable_units > 0
    )) FROM metrics), '{}'::jsonb)
    || jsonb_build_object('Soccer', jsonb_build_object(
         'reads', (SELECT reads FROM soccer), 'volume_only', true, 'ready', false))
    || jsonb_build_object('Tennis', jsonb_build_object(
         'in_production', true,
         'promoted', '2026-08-10',
         'note', 'graded through the public record and weekly review, not the shadow bar')),
  'ready',
    coalesce((SELECT jsonb_agg(model) FROM metrics
      WHERE publishable >= 75
        AND publishable_actual_pct IS NOT NULL
        AND publishable_actual_pct >= publishable_implied_pct
        AND publishable_units > 0), '[]'::jsonb)
)
$function$;
