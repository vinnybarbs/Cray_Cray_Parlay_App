-- Market anchor regime reset (owner rule 2026-09-02: the devigged
-- consensus is the base probability in EVERY sport, the record blend is
-- only the no-odds fallback, pipeline_version 7).
--
-- The regime change breaks the calibration fits' subject matter: the
-- old MLB raw band map (2-4 claims deliver 1.07 etc) was fit on claims
-- produced by the record-blend base, which is the exact fiction the
-- anchor removes. Applying fiction-era haircuts to factor-driven claims
-- would zero the board while the attribution says factors deliver at
-- slope 1 or better. So:
--
--   1. The MLB pooled raw map resets to IDENTITY at the band centers,
--      sample_n 0. The weekly refit re-earns haircuts from anchor-era
--      outcomes, and its min-n rule holds identity until each band has
--      a real sample.
--   2. The published-pick fit floor moves to 2026-09-02 so old-regime
--      claims never grade new-regime labels.
--   3. The MLB totals SHADOW fit keeps its own 2026-08-17 floor via a
--      new parameter: the totals model (scoring rates vs book line) is
--      unchanged by the ML base anchor, and moving its floor would
--      starve the fit below min-n and silently re-mute totals.
--
-- The old 5-parameter function must be dropped, not just replaced: a
-- 6-parameter sibling would leave the cron's zero-arg call ambiguous.

UPDATE edge_band_calibration_raw AS e
   SET claimed_center = v.c, calibrated_center = v.c, target_center = v.c,
       sample_n = 0, fitted_at = now()
  FROM (VALUES ('2-4', 3.0), ('4-7', 5.5), ('7-10', 8.5), ('10+', 12.5)) AS v(band, c)
 WHERE e.sport = 'MLB' AND e.market = '__all__' AND e.band = v.band;

DROP FUNCTION IF EXISTS public.refresh_edge_band_calibration_raw(integer, integer, numeric, integer, date);

CREATE FUNCTION public.refresh_edge_band_calibration_raw(
  p_window_days integer DEFAULT 45,
  p_min_n integer DEFAULT 25,
  p_damp numeric DEFAULT 0.5,
  p_min_sport_sample integer DEFAULT 60,
  p_fit_floor date DEFAULT '2026-09-02',
  p_total_fit_floor date DEFAULT '2026-08-17'
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

  foreach s in array coalesce(sports, array[]::text[]) loop
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
  -- Regime-independent (scoring-rate model vs book line), so it keeps
  -- its own p_total_fit_floor instead of the published-pick floor.
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
              >= greatest((now() at time zone 'America/Denver')::date - p_window_days, p_total_fit_floor)
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
