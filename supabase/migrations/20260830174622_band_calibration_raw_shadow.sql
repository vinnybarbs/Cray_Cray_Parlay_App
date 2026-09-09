-- HISTORICAL RECORD. Applied to production 2026-08-30 as version
-- 20260830174622 from the desktop project folder and never committed;
-- rescued from branch claude/restamp-pending-game-dates on 2026-09-09
-- and filed under its applied version so the repo matches production.
--
-- This created edge_band_calibration_raw (lever 2, shadow stage): the
-- band map refit on edge_pp_raw, which is regime invariant and sits
-- outside the label feedback loop. The five parameter
-- refresh_edge_band_calibration_raw function that shipped with it is
-- deliberately NOT reproduced here: it was dropped on 2026-09-02
-- (market_anchor_regime_reset) in favor of the six parameter version,
-- and re-creating the old signature would restore an ambiguous
-- overload. The current function lives in 20260908220000 and later.
-- The market column and composite key came in 20260831210000.
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
