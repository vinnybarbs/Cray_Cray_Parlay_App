-- Calibration process break at 2026-08-17 (owner decision 2026-08-21).
--
-- The injury-noise zeroing (PR 66) and the pitcher factor changed what a
-- claimed edge MEANS, so haircuts fit on the noise era were punishing
-- clean claims for a dead process's sins: raw 15pp claims were landing
-- as Strong Plays and the site went three days without a Sharp Take.
-- Both calibration layers now fit only on picks generated since the
-- break date. Where that leaves too little sample, the layers correctly
-- go quiet (bands hold identity, the flat k keeps its manual value)
-- until clean evidence accumulates, instead of extrapolating from the
-- dead era.

-- 1. Flat per-market k: add the process-break floor to the weekly fit.
--    Below the existing 80/150/300 sample floors nothing updates, which
--    now means "not enough clean-era data yet" rather than refitting on
--    noise-era picks from the 120-day window.
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

-- 2. Lift the noise-era MLB moneyline multiplier while the clean sample
--    accumulates. 0.63 was fit on picks whose claims carried up to 10pp
--    of injury word-count noise; clean claims do not owe that haircut.
--    The weekly refresh reclaims this row automatically once 80 clean
--    settled picks exist (roughly two weeks at current volume).
UPDATE public.edge_calibration
SET multiplier = 1.0,
    source = 'process-break 2026-08-21 (noise-era k lifted; weekly refresh reclaims at 80 clean-era samples)',
    updated_at = now()
WHERE key = 'MLB:ml';

-- 3. Band calibration: same process-break floor, parameterized.
DROP FUNCTION IF EXISTS refresh_edge_band_calibration(int, int, numeric, int);

CREATE OR REPLACE FUNCTION refresh_edge_band_calibration(
  p_window_days int default 45,
  p_min_n int default 25,
  p_damp numeric default 0.5,
  p_min_sport_sample int default 60,
  p_fit_floor date default DATE '2026-08-17'
) RETURNS void
LANGUAGE plpgsql
AS $fn$
declare
  sports text[];
  s text;
  bands text[] := array['2-4', '4-7', '7-10', '10+'];
  los numeric[] := array[2, 4, 7, 10];
  his numeric[] := array[4, 7, 10, 1000];
  ns int[];
  centers numeric[];
  delivered numeric[];
  iso numeric[];
  w numeric[];
  i int;
  changed boolean;
  cur numeric;
  pooled_n numeric;
  pooled_v numeric;
  prev_cal numeric;
  v_n int;
  v_center numeric;
  v_delivered numeric;
begin
  select array_agg(sport) into sports from (
    select '__all__' as sport
    union
    select sport from ai_suggestions
     where session_id ~ '^auto_digest_\d{4}-\d{2}-\d{2}$'
       and voided_at is null
       and tier in ('Sharp Take', 'Strong Play', 'Play', 'Lean')
       and actual_outcome in ('won', 'lost')
       and edge_pp is not null and implied_prob is not null
       and (game_date at time zone 'America/Denver')::date
             >= greatest((now() at time zone 'America/Denver')::date - p_window_days, p_fit_floor)
     group by sport
    having count(*) >= p_min_sport_sample
  ) q;

  foreach s in array sports loop
    ns := array[0, 0, 0, 0];
    centers := array[0, 0, 0, 0];
    delivered := array[0, 0, 0, 0];

    for i in 1..4 loop
      select count(*),
             coalesce(avg(edge_pp::numeric), (los[i] + least(his[i], 15)) / 2),
             coalesce(100.0 * (avg((actual_outcome = 'won')::int) - avg(implied_prob::numeric)), 0)
        into v_n, v_center, v_delivered
        from ai_suggestions
       where session_id ~ '^auto_digest_\d{4}-\d{2}-\d{2}$'
         and voided_at is null
         and tier in ('Sharp Take', 'Strong Play', 'Play', 'Lean')
         and actual_outcome in ('won', 'lost')
         and edge_pp is not null and implied_prob is not null
         and edge_pp::numeric >= los[i] and edge_pp::numeric < his[i]
         and (s = '__all__' or sport = s)
         and (game_date at time zone 'America/Denver')::date
               >= greatest((now() at time zone 'America/Denver')::date - p_window_days, p_fit_floor);
      ns[i] := v_n;
      centers[i] := v_center;
      delivered[i] := v_delivered;

      -- Thin band: no clean-era evidence yet, hold the claimed center so
      -- the mapping is identity there.
      if ns[i] < p_min_n then
        delivered[i] := centers[i];
      end if;
      if delivered[i] < 0 then
        delivered[i] := 0;
      end if;
    end loop;

    iso := delivered;
    w := array[greatest(ns[1], 1)::numeric, greatest(ns[2], 1)::numeric,
               greatest(ns[3], 1)::numeric, greatest(ns[4], 1)::numeric];
    loop
      changed := false;
      for i in 1..3 loop
        if iso[i] > iso[i + 1] then
          pooled_v := (iso[i] * w[i] + iso[i + 1] * w[i + 1]) / (w[i] + w[i + 1]);
          pooled_n := w[i] + w[i + 1];
          iso[i] := pooled_v; iso[i + 1] := pooled_v;
          w[i] := pooled_n; w[i + 1] := pooled_n;
          changed := true;
        end if;
      end loop;
      exit when not changed;
    end loop;

    prev_cal := 0;
    for i in 1..4 loop
      select calibrated_center into cur
        from edge_band_calibration where sport = s and band = bands[i];
      if cur is null then
        cur := centers[i];
      end if;
      cur := (1 - p_damp) * cur + p_damp * iso[i];
      if cur < prev_cal then
        cur := prev_cal;
      end if;
      prev_cal := cur;

      insert into edge_band_calibration
        (sport, band, claimed_center, calibrated_center, target_center, sample_n, window_days, fitted_at)
      values (s, bands[i], round(centers[i], 2), round(cur, 2), round(iso[i], 2), ns[i], p_window_days, now())
      on conflict (sport, band) do update set
        claimed_center = excluded.claimed_center,
        calibrated_center = excluded.calibrated_center,
        target_center = excluded.target_center,
        sample_n = excluded.sample_n,
        window_days = excluded.window_days,
        fitted_at = excluded.fitted_at;
    end loop;
  end loop;
end;
$fn$;

-- 4. Wipe the noise-era fitted rows and reseed from the clean era only.
--    With clean-era n below p_min_sport_sample, sports lose their fitted
--    rows entirely and the JS identity fallback applies until they earn
--    clean ones. The damped-walk restart is intentional, the old
--    calibrated centers were noise-era artifacts.
DELETE FROM edge_band_calibration;
SELECT refresh_edge_band_calibration();
