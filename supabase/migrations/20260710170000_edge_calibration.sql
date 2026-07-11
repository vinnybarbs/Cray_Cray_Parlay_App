-- supabase/migrations/20260710170000_edge_calibration.sql
--
-- Outcome-driven edge calibration. The learning loop, first closed version.
--
-- The edge calculator multiplies each market's raw model edge by a measured
-- reliability multiplier from this table (EdgeCalculator._getCalibration).
-- Multipliers are the regression-through-origin slope k of realized excess
-- win rate on claimed edge, i.e. "of each claimed pp, how much showed up."
--
-- Seeds below come from 1,599 settled picks with pick-time edges
-- (2026-05 through 2026-07-10, old formula):
--   MLB:ml     k = 1.40 (n=644)  -> seed 1.20 (clamped; cap already guards)
--   MLB:total  k = 0.55 (n=306)  -> seed 0.55
--   MLB:spread k = -0.04 (n=424) -> seed 0.60, NOT 0: the measured zero was
--       caused by the 0.50 cover-prob baseline bug fixed alongside this
--       migration (run lines average ~62% implied). Post-fix spreads start
--       conservative and the weekly refresh re-estimates from clean data.
--   EPL        negative excess (n=40)  -> 0 (suspended)
--   MLS        k = 0.00 (n=87)         -> 0 (suspended)
--       Soccer stays at 0 until the model handles three-way (draw) markets.
--       A 0 multiplier zeroes published edges, which stops pick generation
--       for the sport. Reactivation is a deliberate manual seed change.
--   __global__ 0.75: conservative default for sports with no settled sample
--       yet (this is what NFL/NCAAF start at in September).
--
-- The weekly refresh only re-estimates from pipeline_version >= 6 picks
-- (6 = calibrated devig regime; 5 was reserved for the fact-sheet flow and
-- never written) so old-formula data never contaminates the calibration.

CREATE TABLE IF NOT EXISTS public.edge_calibration (
  key         text PRIMARY KEY,   -- '<Sport>:<market>' | '<Sport>' | '__global__'
  multiplier  numeric NOT NULL,
  sample_n    integer,
  measured_k  numeric,
  source      text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.edge_calibration TO anon, authenticated, service_role;

INSERT INTO public.edge_calibration (key, multiplier, sample_n, measured_k, source) VALUES
  ('__global__', 0.75, 1599,  0.76, 'seed-2026-07-10'),
  ('MLB:ml',     1.20,  644,  1.40, 'seed-2026-07-10'),
  ('MLB:total',  0.55,  306,  0.55, 'seed-2026-07-10'),
  ('MLB:spread', 0.60,  424, -0.04, 'seed-2026-07-10 (post-devig-fix restart)'),
  ('EPL',        0.00,   40,  NULL, 'seed-2026-07-10 (suspended: 3-way markets)'),
  ('MLS',        0.00,   87,  0.00, 'seed-2026-07-10 (suspended: 3-way markets)')
ON CONFLICT (key) DO NOTHING;

-- Weekly re-estimation from settled outcomes.
CREATE OR REPLACE FUNCTION public.refresh_edge_calibration()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
BEGIN
  -- Per (sport, market): needs 80+ settled picks in the trailing 120 days.
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
          -- Juiced implied from the pick's own price, lightly devigged.
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
    greatest(0, least(1.2, k)),
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
  -- Suspended sports (multiplier 0 by manual seed) generate no picks and so
  -- no new evidence — never let a stale tiny sample resurrect them.
  WHERE public.edge_calibration.source NOT LIKE '%suspended%';

  -- Log in a nested block so a logging failure can never roll back the
  -- calibration upsert above.
  BEGIN
    INSERT INTO public.cron_job_logs (job_name, status, details)
    VALUES ('refresh_edge_calibration', 'success',
            jsonb_build_object('ran_at', now()));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$fn$;

SELECT cron.schedule(
  'edge_calibration_weekly',
  '30 6 * * 1',
  $$SELECT public.refresh_edge_calibration();$$
);
