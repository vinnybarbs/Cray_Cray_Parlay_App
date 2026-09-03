-- Per-side spread and total prices on the analysis row (owner request
-- 2026-09-03: show the published odds next to spread and total lines
-- the way ML lines already show theirs). The pipeline has always
-- captured these in extractOddsContext and then dropped them; now they
-- persist so every market row can show the price you would pay.
ALTER TABLE game_analysis
  ADD COLUMN IF NOT EXISTS spread_home_price integer,
  ADD COLUMN IF NOT EXISTS spread_away_price integer,
  ADD COLUMN IF NOT EXISTS over_price integer,
  ADD COLUMN IF NOT EXISTS under_price integer;
