-- Daily check: has any shadow-mode model (Tennis, UFC, Soccer 1X2)
-- accumulated 150 or more settled shadow reads, the promotion bar set in
-- docs/models/? Writes one row per day into cron_job_logs, which the
-- admin dashboard's pipeline feed displays. Status is 'alert' the day a
-- model crosses the bar, 'ok' otherwise. Counts only rows from
-- 2026-07-23 forward because earlier rows predate the shadow models.
SELECT cron.schedule(
  'shadow_model_150_check',
  '10 15 * * *',
  $job$
  WITH counts AS (
    SELECT CASE WHEN sport IN ('EPL','MLS','Soccer','World Cup','Champions League','Copa America','Euros')
                THEN 'Soccer' ELSE sport END AS model,
           count(*) AS n
    FROM public.game_analysis
    WHERE sport IN ('Tennis','UFC','EPL','MLS','Soccer','World Cup','Champions League','Copa America','Euros')
      AND edges IS NOT NULL
      AND game_date >= '2026-07-23'
      AND game_date < now() - interval '6 hours'
    GROUP BY 1
  )
  INSERT INTO public.cron_job_logs (job_name, status, details)
  SELECT 'shadow_model_150_check',
         CASE WHEN bool_or(n >= 150) THEN 'alert' ELSE 'ok' END,
         jsonb_build_object(
           'threshold', 150,
           'models', jsonb_object_agg(model, n),
           'ready', coalesce(jsonb_agg(model) FILTER (WHERE n >= 150), '[]'::jsonb),
           'note', 'A model at 150 or more settled shadow reads is ready for calibration and promotion out of SHADOW_SPORTS.'
         )
  FROM counts
  HAVING count(*) > 0;
  $job$
);
