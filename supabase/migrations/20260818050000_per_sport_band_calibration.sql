-- Per-SPORT band calibration (owner direction 2026-08-17: each sport
-- needs its own independent calibrated formula). The band map shipped in
-- 20260817040000 was one pooled fit, which would have handed football
-- MLB's haircut history at go-live. Now each sport with a real published
-- sample gets its own claimed-to-calibrated map, and the pooled
-- '__all__' map serves only as the prior for sports that have not
-- earned one yet.

alter table edge_band_calibration
  add column if not exists sport text not null default '__all__';

alter table edge_band_calibration drop constraint if exists edge_band_calibration_pkey;
alter table edge_band_calibration add primary key (sport, band);

-- The new signature adds p_min_sport_sample; drop the old 3-arg overload
-- so the zero-arg cron call stays unambiguous.
drop function if exists refresh_edge_band_calibration(int, int, numeric);

create or replace function refresh_edge_band_calibration(
  p_window_days int default 45,
  p_min_n int default 25,
  p_damp numeric default 0.5,
  p_min_sport_sample int default 60
) returns void
language plpgsql
as $fn$
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
  -- '__all__' is always fit (the pooled prior). Each sport whose
  -- published settled sample clears p_min_sport_sample gets its own map.
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
             >= (now() at time zone 'America/Denver')::date - p_window_days
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
               >= (now() at time zone 'America/Denver')::date - p_window_days;
      ns[i] := v_n;
      centers[i] := v_center;
      delivered[i] := v_delivered;

      -- Thin band: no evidence to correct with, hold the claimed center
      -- so the mapping is identity there.
      if ns[i] < p_min_n then
        delivered[i] := centers[i];
      end if;
      -- A band cannot deliver a negative edge label, floor at zero.
      if delivered[i] < 0 then
        delivered[i] := 0;
      end if;
    end loop;

    -- Weighted isotonic regression (pool adjacent violators) so
    -- calibrated centers never decrease as claimed centers increase.
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

    -- Damped step from the current calibrated center toward the isotonic
    -- target, then a final monotone clamp.
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

-- Refit now so per-sport rows exist immediately (existing rows became
-- the '__all__' prior via the column default).
select refresh_edge_band_calibration();
