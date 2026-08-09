-- Market shadow-grader (2026-08-09). Measures whether each sport's RAW
-- spread/total/ml edges predict outcomes, from stored analyses joined to
-- finals, no publication required. This closes the calibration deadlock:
-- a muted market previously could never re-earn its multiplier because
-- the weekly refresh only measures published picks. First run, MLB over
-- 317 settled games: spreads 50.5 percent (-11.6u at -110), totals 47.9
-- percent (-26.2u), both stay muted on evidence; ml 53 percent, live and
-- correct. NFL and NCAAF get measured from week one automatically.

CREATE OR REPLACE FUNCTION public.market_shadow_calibration(since date DEFAULT '2026-07-01')
RETURNS TABLE(sport text, market text, n bigint, wins bigint, win_pct numeric, measured_k numeric, units_at_110 numeric)
LANGUAGE sql STABLE AS $fn$
WITH settled AS (
  SELECT ga.sport, ga.spread::numeric AS spread, ga.total::numeric AS total,
    ga.edges_raw::jsonb AS er, gr.home_score, gr.away_score
  FROM public.game_analysis ga
  JOIN public.game_results gr
    ON gr.sport = ga.sport AND gr.status = 'final'
   AND gr.date = (ga.game_date AT TIME ZONE 'America/Denver')::date
   AND lower(gr.home_team_name) = lower(ga.home_team)
   AND lower(gr.away_team_name) = lower(ga.away_team)
  WHERE ga.edges_raw IS NOT NULL
    AND ga.game_date >= since
    AND ga.game_date < now() - interval '4 hours'
),
spread_graded AS (
  SELECT s.sport, greatest((er->>'home_spread')::numeric, (er->>'away_spread')::numeric) AS e,
    CASE WHEN (er->>'home_spread')::numeric >= (er->>'away_spread')::numeric THEN
      CASE WHEN (home_score - away_score) + spread > 0 THEN 1 WHEN (home_score - away_score) + spread < 0 THEN 0 END
    ELSE
      CASE WHEN (home_score - away_score) + spread < 0 THEN 1 WHEN (home_score - away_score) + spread > 0 THEN 0 END
    END AS w
  FROM settled s
  WHERE er ? 'home_spread' AND spread IS NOT NULL AND home_score IS NOT NULL
),
total_graded AS (
  SELECT s.sport, greatest((er->>'over')::numeric, (er->>'under')::numeric) AS e,
    CASE WHEN (er->>'over')::numeric >= (er->>'under')::numeric THEN
      CASE WHEN (home_score + away_score) - total > 0 THEN 1 WHEN (home_score + away_score) - total < 0 THEN 0 END
    ELSE
      CASE WHEN (home_score + away_score) - total < 0 THEN 1 WHEN (home_score + away_score) - total > 0 THEN 0 END
    END AS w
  FROM settled s
  WHERE er ? 'over' AND total IS NOT NULL AND home_score IS NOT NULL
),
ml_graded AS (
  SELECT s.sport, greatest((er->>'home_ml')::numeric, (er->>'away_ml')::numeric) AS e,
    CASE WHEN (er->>'home_ml')::numeric >= (er->>'away_ml')::numeric THEN
      CASE WHEN home_score > away_score THEN 1 ELSE 0 END
    ELSE CASE WHEN away_score > home_score THEN 1 ELSE 0 END END AS w
  FROM settled s
  WHERE er ? 'home_ml' AND home_score IS NOT NULL
),
all_marks AS (
  SELECT sport, 'spread'::text AS market, e, w FROM spread_graded
  UNION ALL SELECT sport, 'total', e, w FROM total_graded
  UNION ALL SELECT sport, 'ml', e, w FROM ml_graded
)
SELECT sport, market,
  count(*) FILTER (WHERE w IS NOT NULL) AS n,
  sum(w) AS wins,
  round(100.0 * sum(w) / nullif(count(*) FILTER (WHERE w IS NOT NULL), 0), 1) AS win_pct,
  round((sum(e * (w - 0.5)) / nullif(sum(e * e), 0))::numeric, 3) AS measured_k,
  CASE WHEN market IN ('spread','total')
    THEN round(sum(CASE WHEN w = 1 THEN 0.909 WHEN w = 0 THEN -1 END)::numeric, 2)
  END AS units_at_110
FROM all_marks
WHERE w IS NOT NULL
GROUP BY sport, market
ORDER BY sport, market
$fn$;
