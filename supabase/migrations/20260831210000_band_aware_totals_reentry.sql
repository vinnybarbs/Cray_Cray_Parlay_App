-- Band-aware re-entry for MLB totals (owner approval 2026-08-31).
--
-- The whole-market exit rule could never trigger: totals shadow reads
-- 48.5 pct cumulative because the 10pp+ claim band (44.4 pct on 63,
-- clean era) drowns the earning bands (4-7 delivered 4.29pp on 35,
-- 7-10 delivered 7.58pp on 33, both above the 52.4 juice bar for over
-- a month). So the raw band map gains a MARKET dimension: a
-- (sport, market) fit overrides the sport's pooled '__all__' fit for
-- that market's sides. MLB totals get their own map fit from SHADOW
-- reads (the published sample is zero by construction of the mute),
-- with three probation rules that differ from the published fit:
--   1. a thin band (n under p_min_n) pins to 0, not to its claim: an
--      unproven band in a probation market publishes nothing;
--   2. no isotonic pooling: totals delivery is genuinely non-monotone
--      in claim size, and pooling would let the failing 10+ band drag
--      the earning 7-10 band to zero, which is the exact failure the
--      band-aware design exists to prevent;
--   3. no nondecreasing clamp across bands, same reason.
-- The flat MLB:total multiplier moves 0 to 0.10: under the raw map the
-- flat k no longer sizes positive edges, its only live roles are the
-- mute signal (0 means muted, the band map skips the side) and trap
-- read scaling, where 0.10 keeps totals traps effectively off during
-- probation.

ALTER TABLE edge_band_calibration_raw
  ADD COLUMN IF NOT EXISTS market text NOT NULL DEFAULT '__all__';
ALTER TABLE edge_band_calibration_raw
  DROP CONSTRAINT edge_band_calibration_raw_pkey;
ALTER TABLE edge_band_calibration_raw
  ADD PRIMARY KEY (sport, market, band);

CREATE OR REPLACE FUNCTION public.refresh_edge_band_calibration_raw(
  p_window_days integer DEFAULT 45,
  p_min_n integer DEFAULT 25,
  p_damp numeric DEFAULT 0.5,
  p_min_sport_sample integer DEFAULT 60,
  p_fit_floor date DEFAULT '2026-08-17'
) RETURNS void
LANGUAGE plpgsql
AS $fn$
declare
  sports text[]; s text;
  bands text[] := array['2-4','4-7','7-10','10+'];
  los numeric[] := array[2,4,7,10];
  his numeric[] := array[4,7,10,1000];
  ns int[]; centers numeric[]; delivered numeric[]; iso numeric[]; w numeric[];
  i int; changed boolean; cur numeric; pooled_n numeric; pooled_v numeric;
  prev_cal numeric; v_n int; v_center numeric; v_delivered numeric;
begin
  -- ============ published-pick fit, pooled markets, market '__all__' ============
  select array_agg(sport) into sports from (
    select '__all__' as sport
    union
    select sport from ai_suggestions
     where session_id ~ '^auto_digest_\d{4}-\d{2}-\d{2}$'
       and voided_at is null
       and tier in ('Sharp Take','Strong Play','Play','Lean')
       and actual_outcome in ('won','lost')
       and edge_pp_raw is not null and implied_prob is not null
       and (game_date at time zone 'America/Denver')::date
             >= greatest((now() at time zone 'America/Denver')::date - p_window_days, p_fit_floor)
     group by sport
    having count(*) >= p_min_sport_sample
  ) q;

  foreach s in array sports loop
    ns := array[0,0,0,0]; centers := array[0,0,0,0]; delivered := array[0,0,0,0];
    for i in 1..4 loop
      select count(*),
             coalesce(avg(edge_pp_raw::numeric), (los[i] + least(his[i], 15)) / 2),
             coalesce(100.0 * (avg((actual_outcome = 'won')::int) - avg(implied_prob::numeric)), 0)
        into v_n, v_center, v_delivered
        from ai_suggestions
       where session_id ~ '^auto_digest_\d{4}-\d{2}-\d{2}$'
         and voided_at is null
         and tier in ('Sharp Take','Strong Play','Play','Lean')
         and actual_outcome in ('won','lost')
         and edge_pp_raw is not null and implied_prob is not null
         and edge_pp_raw::numeric >= los[i] and edge_pp_raw::numeric < his[i]
         and (s = '__all__' or sport = s)
         and (game_date at time zone 'America/Denver')::date
               >= greatest((now() at time zone 'America/Denver')::date - p_window_days, p_fit_floor);
      ns[i] := v_n; centers[i] := v_center; delivered[i] := v_delivered;
      if ns[i] < p_min_n then delivered[i] := centers[i]; end if;
      if delivered[i] < 0 then delivered[i] := 0; end if;
    end loop;

    iso := delivered;
    w := array[greatest(ns[1],1)::numeric, greatest(ns[2],1)::numeric,
               greatest(ns[3],1)::numeric, greatest(ns[4],1)::numeric];
    loop
      changed := false;
      for i in 1..3 loop
        if iso[i] > iso[i+1] then
          pooled_v := (iso[i]*w[i] + iso[i+1]*w[i+1]) / (w[i] + w[i+1]);
          pooled_n := w[i] + w[i+1];
          iso[i] := pooled_v; iso[i+1] := pooled_v;
          w[i] := pooled_n; w[i+1] := pooled_n;
          changed := true;
        end if;
      end loop;
      exit when not changed;
    end loop;

    prev_cal := 0;
    for i in 1..4 loop
      select calibrated_center into cur
        from edge_band_calibration_raw
       where sport = s and market = '__all__' and band = bands[i];
      if cur is null then cur := iso[i]; end if;
      cur := (1 - p_damp) * cur + p_damp * iso[i];
      if cur < prev_cal then cur := prev_cal; end if;
      prev_cal := cur;
      insert into edge_band_calibration_raw
        (sport, market, band, claimed_center, calibrated_center, target_center, sample_n, window_days, fitted_at)
      values (s, '__all__', bands[i], round(centers[i],2), round(cur,2), round(iso[i],2), ns[i], p_window_days, now())
      on conflict (sport, market, band) do update set
        claimed_center = excluded.claimed_center,
        calibrated_center = excluded.calibrated_center,
        target_center = excluded.target_center,
        sample_n = excluded.sample_n,
        window_days = excluded.window_days,
        fitted_at = excluded.fitted_at;
    end loop;
  end loop;

  -- ============ MLB totals fit from SHADOW reads, market 'total' ============
  -- The mute means zero published totals, so the shadow record is the
  -- only honest source. Delivery is win rate minus the devigged 50.
  ns := array[0,0,0,0]; centers := array[0,0,0,0]; delivered := array[0,0,0,0];
  for i in 1..4 loop
    with settled as (
      select ga.total::numeric as total, ga.edges_raw::jsonb as er,
             gr.home_score, gr.away_score
      from game_analysis ga
      join game_results gr
        on gr.sport = ga.sport and gr.status = 'final'
       and gr.date = (ga.game_date at time zone 'America/Denver')::date
       and lower(gr.home_team_name) = lower(ga.home_team)
       and lower(gr.away_team_name) = lower(ga.away_team)
      where ga.sport = 'MLB' and ga.edges_raw is not null
        and (ga.game_date at time zone 'America/Denver')::date
              >= greatest((now() at time zone 'America/Denver')::date - p_window_days, p_fit_floor)
        and ga.game_date < now() - interval '4 hours'
    ),
    graded as (
      select greatest((er->>'over')::numeric, (er->>'under')::numeric) * 100 as e_pp,
        case when (er->>'over')::numeric >= (er->>'under')::numeric then
          case when (home_score + away_score) - total > 0 then 1
               when (home_score + away_score) - total < 0 then 0 end
        else
          case when (home_score + away_score) - total < 0 then 1
               when (home_score + away_score) - total > 0 then 0 end
        end as won_flag
      from settled
      where er ? 'over' and total is not null and home_score is not null
    )
    select count(*),
           coalesce(avg(e_pp), (los[i] + least(his[i], 15)) / 2),
           coalesce(100.0 * (avg(won_flag::numeric) - 0.5), 0)
      into v_n, v_center, v_delivered
      from graded
     where won_flag is not null and e_pp >= los[i] and e_pp < his[i];
    ns[i] := v_n; centers[i] := v_center; delivered[i] := v_delivered;
    -- Probation rules: thin pins to 0 (publishes nothing), negative pins
    -- to 0, and there is no isotonic pass or nondecreasing clamp.
    if ns[i] < p_min_n then delivered[i] := 0; end if;
    if delivered[i] < 0 then delivered[i] := 0; end if;
  end loop;

  for i in 1..4 loop
    select calibrated_center into cur
      from edge_band_calibration_raw
     where sport = 'MLB' and market = 'total' and band = bands[i];
    if cur is null then cur := delivered[i]; end if;
    cur := (1 - p_damp) * cur + p_damp * delivered[i];
    insert into edge_band_calibration_raw
      (sport, market, band, claimed_center, calibrated_center, target_center, sample_n, window_days, fitted_at)
    values ('MLB', 'total', bands[i], round(centers[i],2), round(cur,2), round(delivered[i],2), ns[i], p_window_days, now())
    on conflict (sport, market, band) do update set
      claimed_center = excluded.claimed_center,
      calibrated_center = excluded.calibrated_center,
      target_center = excluded.target_center,
      sample_n = excluded.sample_n,
      window_days = excluded.window_days,
      fitted_at = excluded.fitted_at;
  end loop;
end;
$fn$;

-- Seed the totals map now instead of waiting for Monday.
SELECT public.refresh_edge_band_calibration_raw();

-- Lift the mute with the band map in control (see header comment).
UPDATE edge_calibration
   SET multiplier = 0.10,
       source = 'band-aware re-entry 2026-08-31 (owner approved): raw band map (MLB, total) fit from shadow owns sizing and the gate; 4-7 delivered 4.29pp on 35 and 7-10 delivered 7.58pp on 33 in the clean era while 10+ (44.4 pct on 63) and thin 2-4 pin to 0. Flat value 0.10 only signals not-muted and scales trap reads.',
       updated_at = now()
 WHERE key = 'MLB:total';
