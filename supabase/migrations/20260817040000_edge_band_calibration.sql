-- Per-band edge calibration fit on PUBLISHED pick outcomes (owner
-- decision 2026-08-16, "pull it forward" after the math forensics).
--
-- The flat per-market k in edge_calibration is fit across all graded
-- reads, but publishing selects the tail where the model most disagrees
-- with the market, so published claimed edges deliver unevenly by band
-- (45d published: 2-4pp claimed delivered 4.1, 4-7 delivered 0.02,
-- 7-10 delivered 3.3, 10+ delivered 13.0). This table stores a monotone
-- claimed-to-calibrated mapping fit weekly from published outcomes with
-- weighted isotonic pooling and 0.5 damping per step. The JS side
-- (lib/services/band-calibration.js) interpolates linearly through the
-- band centers, which keeps the map monotone where per-band constant
-- multipliers would not be.

create table if not exists edge_band_calibration (
  band text primary key,
  claimed_center numeric not null,
  calibrated_center numeric not null,
  target_center numeric not null,
  sample_n int not null,
  window_days int not null,
  fitted_at timestamptz not null default now()
);

grant select on edge_band_calibration to anon, authenticated, service_role;

create or replace function refresh_edge_band_calibration(
  p_window_days int default 45,
  p_min_n int default 25,
  p_damp numeric default 0.5
) returns void
language plpgsql
as $fn$
declare
  bands text[] := array['2-4', '4-7', '7-10', '10+'];
  los numeric[] := array[2, 4, 7, 10];
  his numeric[] := array[4, 7, 10, 1000];
  ns int[] := array[0, 0, 0, 0];
  centers numeric[] := array[0, 0, 0, 0];
  delivered numeric[] := array[0, 0, 0, 0];
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
  for i in 1..4 loop
    -- plpgsql SELECT INTO cannot target subscripted array elements, so
    -- land in scalars and assign.
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
       and (game_date at time zone 'America/Denver')::date
             >= (now() at time zone 'America/Denver')::date - p_window_days;
    ns[i] := v_n;
    centers[i] := v_center;
    delivered[i] := v_delivered;

    -- Thin band: no evidence to correct with, hold the claimed center so
    -- the mapping is identity there rather than inventing a haircut.
    if ns[i] < p_min_n then
      delivered[i] := centers[i];
    end if;
    -- A band cannot deliver a negative edge label, floor at zero.
    if delivered[i] < 0 then
      delivered[i] := 0;
    end if;
  end loop;

  -- Weighted isotonic regression (pool adjacent violators) so calibrated
  -- centers never decrease as claimed centers increase.
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

  -- Damped step from the CURRENT calibrated center toward the isotonic
  -- target (first run starts from the claimed center, so the first step
  -- moves halfway). Then clamp monotone once more, damping from
  -- different starting points can reintroduce a tiny inversion.
  prev_cal := 0;
  for i in 1..4 loop
    select calibrated_center into cur from edge_band_calibration where band = bands[i];
    if cur is null then
      cur := centers[i];
    end if;
    cur := (1 - p_damp) * cur + p_damp * iso[i];
    if cur < prev_cal then
      cur := prev_cal;
    end if;
    prev_cal := cur;

    insert into edge_band_calibration
      (band, claimed_center, calibrated_center, target_center, sample_n, window_days, fitted_at)
    values (bands[i], round(centers[i], 2), round(cur, 2), round(iso[i], 2), ns[i], p_window_days, now())
    on conflict (band) do update set
      claimed_center = excluded.claimed_center,
      calibrated_center = excluded.calibrated_center,
      target_center = excluded.target_center,
      sample_n = excluded.sample_n,
      window_days = excluded.window_days,
      fitted_at = excluded.fitted_at;
  end loop;
end;
$fn$;

-- Seed from current published history.
select refresh_edge_band_calibration();

-- Weekly refit, five minutes after the flat-k weekly refresh (06:30 UTC
-- Monday) so both layers move together on the same cadence.
select cron.schedule(
  'edge-band-calibration-weekly',
  '35 6 * * 1',
  $cron$select refresh_edge_band_calibration()$cron$
);
