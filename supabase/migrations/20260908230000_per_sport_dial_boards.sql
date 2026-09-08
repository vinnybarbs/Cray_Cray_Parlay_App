-- Every sport gets its own explicit, independent dial board (owner
-- directive 2026-09-08: "each and every sport having their own
-- independent formula including NFL props and NBA props"). The
-- '__all__' rows remain only as a safety net for an unseeded sport;
-- from here every tuning decision is per sport, visible, and
-- independently movable by the weekly dial review. New dials this
-- migration (matching edge-calculator DIAL_DEFAULTS): home_advantage,
-- injury_weight, rest_per_day, rest_cap (football), and
-- weather_total_weight (football totals). UFC and Tennis price off
-- their own market-consensus models and use none of these factors, so
-- they carry no rows here by design; their tunables (flat multiplier,
-- longshot fence) get dialized when those models join the board. The
-- props rows are forward declarations: the props pipeline (build
-- queue) must read its formula from sport_dials from day one.
INSERT INTO sport_dials (sport, dial, value) VALUES
  -- MLB
  ('MLB', 'form_weight', 0),
  ('MLB', 'sos_sensitivity', 0.15),
  ('MLB', 'max_net_adjustment', 0.15),
  ('MLB', 'spread_claim_damp', 0.5),
  ('MLB', 'home_advantage', 0.030),
  ('MLB', 'injury_weight', 1),
  -- NFL
  ('NFL', 'form_weight', 0),
  ('NFL', 'sos_sensitivity', 0.15),
  ('NFL', 'venue_weight', 0.25),
  ('NFL', 'max_net_adjustment', 0.15),
  ('NFL', 'spread_claim_damp', 0.5),
  ('NFL', 'home_advantage', 0.030),
  ('NFL', 'injury_weight', 1),
  ('NFL', 'rest_per_day', 0.004),
  ('NFL', 'rest_cap', 0.025),
  ('NFL', 'weather_total_weight', 1),
  -- NCAAF
  ('NCAAF', 'form_weight', 0),
  ('NCAAF', 'sos_sensitivity', 0.15),
  ('NCAAF', 'venue_weight', 0.25),
  ('NCAAF', 'max_net_adjustment', 0.15),
  ('NCAAF', 'spread_claim_damp', 0.5),
  ('NCAAF', 'home_advantage', 0.030),
  ('NCAAF', 'injury_weight', 1),
  ('NCAAF', 'rest_per_day', 0.004),
  ('NCAAF', 'rest_cap', 0.025),
  ('NCAAF', 'weather_total_weight', 1),
  -- NBA
  ('NBA', 'form_weight', 0),
  ('NBA', 'sos_sensitivity', 0.15),
  ('NBA', 'venue_weight', 0.25),
  ('NBA', 'max_net_adjustment', 0.15),
  ('NBA', 'spread_claim_damp', 0.5),
  ('NBA', 'home_advantage', 0.035),
  ('NBA', 'injury_weight', 1),
  -- NCAAB
  ('NCAAB', 'form_weight', 0),
  ('NCAAB', 'sos_sensitivity', 0.15),
  ('NCAAB', 'venue_weight', 0.25),
  ('NCAAB', 'max_net_adjustment', 0.15),
  ('NCAAB', 'spread_claim_damp', 0.5),
  ('NCAAB', 'home_advantage', 0.040),
  ('NCAAB', 'injury_weight', 1),
  -- NHL
  ('NHL', 'form_weight', 0),
  ('NHL', 'sos_sensitivity', 0.15),
  ('NHL', 'venue_weight', 0.25),
  ('NHL', 'max_net_adjustment', 0.15),
  ('NHL', 'spread_claim_damp', 0.5),
  ('NHL', 'home_advantage', 0.025),
  ('NHL', 'injury_weight', 1),
  -- EPL
  ('EPL', 'form_weight', 0),
  ('EPL', 'sos_sensitivity', 0.15),
  ('EPL', 'venue_weight', 0.25),
  ('EPL', 'max_net_adjustment', 0.15),
  ('EPL', 'spread_claim_damp', 0.5),
  ('EPL', 'home_advantage', 0.080),
  ('EPL', 'injury_weight', 1),
  -- MLS
  ('MLS', 'form_weight', 0),
  ('MLS', 'sos_sensitivity', 0.15),
  ('MLS', 'venue_weight', 0.25),
  ('MLS', 'max_net_adjustment', 0.15),
  ('MLS', 'spread_claim_damp', 0.5),
  ('MLS', 'home_advantage', 0.070),
  ('MLS', 'injury_weight', 1),
  -- Props forward declarations (the props pipeline reads its formula
  -- from sport_dials from day one; dials fill in as it is built)
  ('NFL_props', 'max_net_adjustment', 0.15),
  ('NBA_props', 'max_net_adjustment', 0.15)
ON CONFLICT (sport, dial) DO NOTHING;
