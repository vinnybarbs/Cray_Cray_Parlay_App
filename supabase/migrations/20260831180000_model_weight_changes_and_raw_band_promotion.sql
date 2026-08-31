-- The learning loop's audit trail, plus the record of today's two model
-- changes (owner 2026-08-31: "Why wait until Monday? Something has to
-- change", and the direction that weighted-value adjustment from loss
-- analysis matters more than safer relabeling).
--
-- model_weight_changes is append-only: one row per change to a model
-- weight, formula input, or calibration wiring, with the before and
-- after values and the evidence that justified it. The admin calibration
-- page reads it so every grade's history is inspectable.

CREATE TABLE IF NOT EXISTS model_weight_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now(),
  sport text NOT NULL,
  component text NOT NULL,
  before jsonb,
  after jsonb,
  reason text NOT NULL,
  source text NOT NULL DEFAULT 'learning_loop'
);

COMMENT ON TABLE model_weight_changes IS
  'Append-only log of model weight and formula changes: what moved, from what to what, and the evidence. The learning loop writes here on every adjustment.';

-- Change 1: MLB venue split up-weight, learning loop stage two.
-- Attribution slope 7.37 on n=129 (2026-08-24 reading) then 4.54 on
-- n=252 (2026-08-31), same direction two consecutive Mondays, the agreed
-- promotion gate. Step is the agreed per-cycle maximum, 25% of current
-- weight. Caps and confidence taper unchanged.
INSERT INTO model_weight_changes (sport, component, before, after, reason, source)
VALUES (
  'MLB',
  'venue_split_delta_weight',
  '{"weight": 0.25, "cap_pp": 4, "taper": "5 to 20 games"}',
  '{"weight": 0.3125, "cap_pp": 4, "taper": "5 to 20 games"}',
  'Factor attribution: venue slope 4.54 on n=252, second consecutive weekly reading above 1, strongest stable underweight in the MLB profile. Max single step of 25% of current weight per the stage two bounds.',
  'learning_loop_stage2'
);

-- Change 2: raw band map promoted to own MLB edge sizing and the publish
-- gate, replacing the flat-k times stale-band double shrink (effective
-- multiplier had compounded to about 0.125 on raw claims). First fit on
-- the full settled history: raw 2-4pp delivers 1.07, 4-7 delivers 1.07,
-- 7-10 delivers 5.70, 10+ held at prior 12.84 until its sample crosses
-- n=25. Flat k still governs negative (trap) edges.
INSERT INTO model_weight_changes (sport, component, before, after, reason, source)
VALUES (
  'MLB',
  'edge_sizing_pipeline',
  '{"pipeline": "raw edge x flat k (0.25 pinned) x edge_band_calibration map, publish gate on pre-band edge"}',
  '{"pipeline": "raw edge through edge_band_calibration_raw single map, mapped value owns display and the 2pp publish gate, flat k retained for negative trap edges only"}',
  'Double shrink starved the ladder while delivery was real: August CLV positive, raw 7-10pp claims delivering 5.70pp, but labels pinned at Lean. One fit from raw claim to delivered pp replaces two stacked corrections. Owner call 2026-08-31 to promote without waiting for the side-by-side week to finish.',
  'owner_decision'
);
