-- NFL go-live multiplier seeds (directive 12, executed 2026-09-09
-- ahead of the 09-10 opener). Preseason shadow over 16 games measured
-- ml 9-7 with k 0.485, spread 9-7 with k 0.193, totals 6-10 with k
-- -0.457. Owner scope: flip moneyline and spread only, hold totals.
-- Seeds are damped below the measured k because 16 games is a thin
-- sample: ml 0.25 (about half of measured), spread 0.10 (about half),
-- total 0 (muted until its shadow record clears juice break even).
-- NFL has no raw band fit yet, so the flat multipliers own sizing
-- until the sport earns its own rubric era band rows.
INSERT INTO edge_calibration (key, multiplier, sample_n, measured_k, source) VALUES
  ('NFL', 0.25, 16, 0.485, 'go-live seed 2026-09-09: preseason shadow ml 9-7 k 0.485, damped for n=16'),
  ('NFL:ml', 0.25, 16, 0.485, 'go-live seed 2026-09-09: preseason shadow 9-7 k 0.485, damped for n=16'),
  ('NFL:spread', 0.10, 16, 0.193, 'go-live seed 2026-09-09: preseason shadow 9-7 k 0.193, damped for n=16'),
  ('NFL:total', 0, 16, -0.457, 'go-live MUTE 2026-09-09: preseason totals 6-10 (37.5 pct) k -0.457, re-entry only via measured shadow evidence per directive 10')
ON CONFLICT (key) DO UPDATE SET
  multiplier = EXCLUDED.multiplier,
  sample_n = EXCLUDED.sample_n,
  measured_k = EXCLUDED.measured_k,
  source = EXCLUDED.source,
  updated_at = now();
