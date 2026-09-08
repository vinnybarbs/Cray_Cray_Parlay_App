-- The dial board (owner design 2026-09-08): every tunable factor
-- weight in the edge formula is a dial, per sport, stored here and
-- read by the edge calculator with a 10 minute cache and fail-soft
-- code defaults. A sport-specific row overrides the '__all__' row.
-- Changing a weight is a logged data write, reviewed weekly by the
-- calibration agent under the three-test counterfactual protocol:
-- the proposed move must rescue the losing picks it targets, improve
-- the sport's whole record replayed, and hold on the sport's shadow
-- reads. Moves stay damped (max 25 percent of current weight per step)
-- unless a reading repeats, and every change also lands in
-- model_weight_changes with its evidence.
CREATE TABLE IF NOT EXISTS sport_dials (
  sport text NOT NULL,
  dial text NOT NULL,
  value numeric NOT NULL,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (sport, dial)
);
COMMENT ON TABLE sport_dials IS
  'Per-sport factor weight dials read by the edge calculator. Sport row overrides __all__ row overrides code default. Reviewed weekly by the calibration agent; every change is also logged to model_weight_changes.';

-- Seed with the live values at ship time (the 2026-09-08 anchor era
-- rubric plus the standing venue up-weight), so the first dial board
-- reproduces current behavior exactly.
INSERT INTO sport_dials (sport, dial, value) VALUES
  ('__all__', 'form_weight', 0),
  ('MLB', 'pitcher_anchor_damp', 0.5),
  ('__all__', 'spread_claim_damp', 0.5),
  ('__all__', 'venue_weight', 0.25),
  ('MLB', 'venue_weight', 0.3125),
  ('__all__', 'sos_sensitivity', 0.15),
  ('__all__', 'max_net_adjustment', 0.15)
ON CONFLICT (sport, dial) DO NOTHING;
