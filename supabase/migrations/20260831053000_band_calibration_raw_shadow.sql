-- Lever 2, shadow stage. Refit the band map on edge_pp_raw and record what
-- every pick WOULD have been labeled, without touching the live map.
--
-- Two defects motivate this. The map is fit on edge_pp, which is the POST
-- band label, so refresh_edge_band_calibration refits on its own output
-- every week. And the labels it fits were produced under whatever flat
-- edge_calibration multiplier was in force, so the 2026-08-24 drop of
-- MLB:ml from about 0.92 to 0.25 invalidated the fit sample. edge_pp_raw
-- is regime invariant and sits outside the feedback loop.
--
-- Nothing here is wired into the pipeline. band-calibration.js still reads
-- edge_band_calibration only.

create table if not exists public.edge_band_calibration_raw (
  sport text not null,
  band text not null,
  claimed_center numeric,
  calibrated_center numeric,
  target_center numeric,
  sample_n integer,
  window_days integer,
  fitted_at timestamptz not null default now(),
  primary key (sport, band)
);

alter table public.edge_band_calibration_raw enable row level security;

create or replace function public.refresh_edge_band_calibration_raw(
  p_window_days integer default 45,
  p_min_n integer default 25,
  p_damp numeric default 0.5,
  p_min_sport_sample integer default 60,
  p_fit_floor date default '2026-08-17'::date)
returns void language plpgsql as $function$
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
        from edge_band_calibration_raw where sport = s and band = bands[i];
      if cur is null then cur := iso[i]; end if;
      cur := (1 - p_damp) * cur + p_damp * iso[i];
      if cur < prev_cal then cur := prev_cal; end if;
      prev_cal := cur;
      insert into edge_band_calibration_raw
        (sport, band, claimed_center, calibrated_center, target_center, sample_n, window_days, fitted_at)
      values (s, bands[i], round(centers[i],2), round(cur,2), round(iso[i],2), ns[i], p_window_days, now())
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
$function$;

-- Piecewise linear map through the fitted raw centers, implicit origin at
-- (0,0), extended along the last ratio beyond the top band. Identity when
-- the sport has no fitted rows, mirroring the fail-soft in band-calibration.js.
create or replace function public.band_map_raw(p_sport text, p_raw numeric)
returns numeric language plpgsql stable as $function$
declare prev_c numeric := 0; prev_v numeric := 0; r record; t numeric;
begin
  if p_raw is null or p_raw <= 0 then return p_raw; end if;
  for r in select claimed_center as c, calibrated_center as v
             from edge_band_calibration_raw
            where sport = p_sport and claimed_center is not null
            order by claimed_center loop
    if p_raw <= r.c then
      if r.c - prev_c <= 0 then return r.v; end if;
      t := (p_raw - prev_c) / (r.c - prev_c);
      return prev_v + t * (r.v - prev_v);
    end if;
    prev_c := r.c; prev_v := r.v;
  end loop;
  if prev_c > 0 then return p_raw * (prev_v / prev_c); end if;
  return p_raw;
end;
$function$;

-- Ladder as of 2026-08-10, including the chalk fence: a 10pp or better
-- claim at -150 or heavier publishes as Play, not Sharp Take.
create or replace function public.band_shadow_tier(p_edge numeric, p_price integer)
returns text language sql immutable as $function$
  select case
    when p_edge is null then null
    when p_edge >= 10 and (p_price is null or p_price > -150) then 'Sharp Take'
    when p_edge >= 4 then 'Play'
    when p_edge >= 2 then 'Lean'
    else 'Skip' end;
$function$;

-- Side by side evidence. shadow_would_publish applies the owner decision
-- of 2026-08-30: under the raw map the mapped label owns the 2pp gate.
create or replace view public.pick_band_shadow as
select s.id, s.sport, s.game_date, s.odds, s.actual_outcome, s.implied_prob,
       s.edge_pp_raw as raw_edge,
       s.edge_pp as live_label, s.tier as live_tier,
       round(public.band_map_raw(s.sport, s.edge_pp_raw::numeric), 2) as shadow_label,
       public.band_shadow_tier(
         public.band_map_raw(s.sport, s.edge_pp_raw::numeric),
         nullif(replace(s.odds, '+', ''), '')::integer) as shadow_tier,
       (public.band_map_raw(s.sport, s.edge_pp_raw::numeric) >= 2) as shadow_would_publish
from ai_suggestions s
where s.session_id ~ '^auto_digest_\d{4}-\d{2}-\d{2}$'
  and s.voided_at is null
  and s.edge_pp_raw is not null;

-- Five minutes after the live band refit, same Monday.
select cron.schedule('edge-band-calibration-raw-weekly', '40 6 * * 1',
  $job$ select public.refresh_edge_band_calibration_raw(); $job$);

select public.refresh_edge_band_calibration_raw();
