-- Owner rulings 2026-09-11 on the ops check findings.
--
-- 1. THE RAW GATE (directive 17). The model must clear 2pp on its own
--    before calibration touches it, and a pick needs a data profile
--    ("blind is not sustainable"). Enforced in pre-analyze
--    (publishGateOpen: raw >= 2 and calibrated >= 2 and, for UFC, both
--    fighters in ufc_fighters). check_sql flags published bet-tier rows
--    whose raw read sits under the gate.
-- 2. EMERGENCY TOTALS REFIT. The MLB totals band map fitted 09-08 ran
--    backwards (2-4 raw published at 7.63, 10+ raw at 2.29) because the
--    totals branch of the refit had no monotonic pooling, unlike the
--    moneyline branch. Pool the totals bands isotonic and hold the
--    damped result non-decreasing, the same treatment the __all__ map
--    gets, then refit now instead of Monday.
-- 3. Odds quantization in the change gate hash approved (build_queue 17).

INSERT INTO directives (directive, decided_on, enforcement, check_sql, notes) VALUES
('The publish gate binds on the raw claim: the model must clear 2pp on its own before calibration touches it, and a pick needs a data profile (UFC: both fighters known). Calibration sizes a claim, it never creates one.', '2026-09-11',
 'pre-analyze-games publishGateOpen (raw gate, profile gate); calibration multipliers and band maps apply after the gate',
 'select id, sport, tier, odds, edge_pp, edge_pp_raw from ai_suggestions where voided_at is null and session_id ~ ''^auto_digest_\d{4}-\d{2}-\d{2}$'' and created_at > ''2026-09-11 12:00:00-06'' and tier in (''Sharp Take'',''Strong Play'',''Play'',''Lean'') and edge_pp_raw is not null and edge_pp_raw < 2',
 'Born from UFC:ml 1.2 lifting a 1.7pp raw read on a fighter with no stored record into a published -410 Lean (id 17377). Owner: "blind is not sustainable."');

UPDATE build_queue SET status = 'done', updated_at = now(),
  detail = detail || ' DONE 2026-09-11: owner approved; odds quantized in the hash (change-gate.js: moneyline 5 cents, spread and total 0.5, edge and probabilities 1pp). Pitchers: the overnight churn is probables being announced or scratched between the two site days the slate loader covers, a genuine input change, names stay in the hash.'
WHERE id = 17;

CREATE OR REPLACE FUNCTION public.refresh_edge_band_calibration_raw(
  p_window_days integer DEFAULT 45,
  p_min_n integer DEFAULT 25,
  p_damp numeric DEFAULT 0.5,
  p_min_sport_sample integer DEFAULT 60,
  p_fit_floor date DEFAULT '2026-09-08'::date,
  p_total_fit_floor date DEFAULT '2026-08-17'::date,
  p_totals_only boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
AS $function$
declare
  sports text[]; s text;
  bands text[] := array['2-4','4-7','7-10','10+'];
  los numeric[] := array[2,4,7,10];
  his numeric[] := array[4,7,10,1000];
  ns int[]; centers numeric[]; delivered numeric[]; iso numeric[]; w numeric[];
  i int; changed boolean; cur numeric; pooled_n numeric; pooled_v numeric;
  prev_cal numeric; v_n int; v_center numeric; v_delivered numeric;
begin
  select array_agg(sport) into sports from (
    select '__all__' as sport
    union
    select sport from ai_suggestions
     where session_id ~ '^auto_digest_\d{4}-\d{2}-\d{2}$'
       and voided_at is null
       and tier in ('Sharp Take','Strong Play','Play','Lean')
       and actual_outcome in ('won','lost')
       and edge_pp_raw is not null
       and (implied_prob is not null or odds ~ '^[+-]?[0-9]+$')
       and (game_date at time zone 'America/Denver')::date
             >= greatest((now() at time zone 'America/Denver')::date - p_window_days, p_fit_floor)
     group by sport
    having count(*) >= p_min_sport_sample
  ) q;

  -- p_totals_only skips the moneyline and spread maps (an emergency
  -- totals refit must not pull them forward ahead of the Monday cron).
  if p_totals_only then sports := array[]::text[]; end if;

  foreach s in array coalesce(sports, array[]::text[]) loop
    ns := array[0,0,0,0]; centers := array[0,0,0,0]; delivered := array[0,0,0,0];
    for i in 1..4 loop
      select count(*),
             coalesce(avg(edge_pp_raw::numeric), (los[i] + least(his[i], 15)) / 2),
             coalesce(100.0 * (avg((actual_outcome = 'won')::int)
               - avg(coalesce(implied_prob::numeric,
                   case when odds::numeric > 0
                        then (100.0 / (odds::numeric + 100.0)) * 0.955
                        else (abs(odds::numeric) / (abs(odds::numeric) + 100.0)) * 0.955
                   end))), 0)
        into v_n, v_center, v_delivered
        from ai_suggestions
       where session_id ~ '^auto_digest_\d{4}-\d{2}-\d{2}$'
         and voided_at is null
         and tier in ('Sharp Take','Strong Play','Play','Lean')
         and actual_outcome in ('won','lost')
         and edge_pp_raw is not null
         and (implied_prob is not null or odds ~ '^[+-]?[0-9]+$')
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

  -- MLB totals: shadow fit from game_analysis reads against final scores.
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

  -- Isotonic pooling (2026-09-11 emergency refit): a bigger claim never
  -- publishes smaller than a smaller one. The 09-08 fit ran backwards
  -- without this and lifted 2-4 raw claims into Strong Play labels.
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
     where sport = 'MLB' and market = 'total' and band = bands[i];
    if cur is null then cur := iso[i]; end if;
    cur := (1 - p_damp) * cur + p_damp * iso[i];
    if cur < prev_cal then cur := prev_cal; end if;
    prev_cal := cur;
    insert into edge_band_calibration_raw
      (sport, market, band, claimed_center, calibrated_center, target_center, sample_n, window_days, fitted_at)
    values ('MLB', 'total', bands[i], round(centers[i],2), round(cur,2), round(iso[i],2), ns[i], p_window_days, now())
    on conflict (sport, market, band) do update set
      claimed_center = excluded.claimed_center,
      calibrated_center = excluded.calibrated_center,
      target_center = excluded.target_center,
      sample_n = excluded.sample_n,
      window_days = excluded.window_days,
      fitted_at = excluded.fitted_at;
  end loop;
end;
$function$;

-- The emergency refit itself, with the damp lifted so the pooled fit
-- lands in full instead of half way toward the inverted map.
SELECT public.refresh_edge_band_calibration_raw(45, 25, 1.0, 60, '2026-09-08', '2026-08-17', true);
