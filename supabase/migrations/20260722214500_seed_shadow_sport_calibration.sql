-- Pre-publish calibration seeds for the shadow-mode player sports. The
-- edge calculator falls back to the 0.75 global default when a key is
-- missing, which is too generous for models with no settled history.
-- Seeding Tennis:ml and UFC:ml at 0.50 means that if either sport is
-- un-shadowed before refresh_edge_calibration has real samples, published
-- edges start conservative. refresh_edge_calibration overwrites these
-- once 80 or more settled picks exist in the trailing window. EPL and MLS
-- keep their existing 0.00 suspension rows until the 1X2 model earns its
-- own multipliers from shadow data.
INSERT INTO public.edge_calibration (key, multiplier, sample_n, measured_k, source) VALUES
  ('Tennis:ml', 0.50, 0, NULL, 'seed-2026-07-23 (pre-publish, shadow mode)'),
  ('UFC:ml',    0.50, 0, NULL, 'seed-2026-07-23 (pre-publish, shadow mode)')
ON CONFLICT (key) DO NOTHING;
