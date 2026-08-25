-- Floor the weekly flat-k clamp at 0.25 (owner approved 2026-08-24).
--
-- The 2026-08-24 weekly refresh measured clean-era MLB:ml delivery at or
-- below zero on 116 samples (the cold stretch) and the old clamp
-- greatest(0, ...) wrote multiplier 0, which zeroed every calibrated
-- moneyline edge, muted the entire board, flattened the tier ladder to
-- Lean, and silenced the Discord alerts. A measured zero on one cold
-- week must compress the ladder, not switch the product off: the
-- per-band layer and the pre-band publish gate carry the shaped
-- honesty. At 0.25 a raw 15pp claim reads 3.75pp calibrated, so Sharp
-- Takes stay rare until delivery actually recovers, and the refresh
-- lifts k on its own when it does. measured_k still records the true
-- fitted value, so the review always sees what the clamp hid.
CREATE OR REPLACE FUNCTION public.refresh_edge_calibration()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  WITH settled AS (
    SELECT
      sport,
      CASE bet_type
        WHEN 'Moneyline' THEN 'ml'
        WHEN 'Spread'    THEN 'spread'
        WHEN 'Total'     THEN 'total'
      END AS market,
      edge_pp_raw / 100.0 AS e,
      (actual_outcome = 'won')::int AS w,
      COALESCE(
        implied_prob,
        CASE WHEN odds ~ '^[+-]?\d+$' THEN
          (CASE WHEN replace(odds,'+','')::numeric > 0
                THEN 100.0 / (replace(odds,'+','')::numeric + 100.0)
                ELSE abs(replace(odds,'+','')::numeric) / (abs(replace(odds,'+','')::numeric) + 100.0)
           END) / 1.02
        END,
        0.5
      ) AS i
    FROM public.ai_suggestions
    WHERE actual_outcome IN ('won','lost')
      AND pipeline_version >= 6
      AND edge_pp_raw IS NOT NULL
      AND edge_pp_raw <> 0
      AND game_date >= now() - interval '120 days'
      -- Process break: the claim-generating process changed 2026-08-17
      -- (injury zeroing) and again 2026-08-21 (pitcher factor). Fit only
      -- on the current process.
      AND (game_date AT TIME ZONE 'America/Denver')::date >= DATE '2026-08-17'
      AND bet_type IN ('Moneyline','Spread','Total')
  ),
  by_market AS (
    SELECT sport || ':' || market AS key,
      count(*) AS n,
      sum(e * (w - i)) / nullif(sum(e * e), 0) AS k
    FROM settled
    GROUP BY sport, market
    HAVING count(*) >= 80
  ),
  by_sport AS (
    SELECT sport AS key,
      count(*) AS n,
      sum(e * (w - i)) / nullif(sum(e * e), 0) AS k
    FROM settled
    GROUP BY sport
    HAVING count(*) >= 150
  ),
  global_row AS (
    SELECT '__global__' AS key,
      count(*) AS n,
      sum(e * (w - i)) / nullif(sum(e * e), 0) AS k
    FROM settled
    HAVING count(*) >= 300
  ),
  all_rows AS (
    SELECT * FROM by_market
    UNION ALL SELECT * FROM by_sport
    UNION ALL SELECT * FROM global_row
  )
  INSERT INTO public.edge_calibration (key, multiplier, sample_n, measured_k, source, updated_at)
  SELECT key,
    greatest(0.25, least(1.2, k)),
    n,
    round(k::numeric, 3),
    'weekly-refresh',
    now()
  FROM all_rows
  WHERE k IS NOT NULL
  ON CONFLICT (key) DO UPDATE SET
    multiplier = EXCLUDED.multiplier,
    sample_n   = EXCLUDED.sample_n,
    measured_k = EXCLUDED.measured_k,
    source     = EXCLUDED.source,
    updated_at = EXCLUDED.updated_at
  WHERE public.edge_calibration.source NOT LIKE '%suspended%';

  BEGIN
    INSERT INTO public.cron_job_logs (job_name, status, details)
    VALUES ('refresh_edge_calibration', 'success',
            jsonb_build_object('ran_at', now()));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$function$;

-- Re-run immediately so today's board recovers without waiting a week.
SELECT public.refresh_edge_calibration();
