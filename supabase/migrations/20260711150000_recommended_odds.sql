-- Lock-time data integrity (audit ROADMAP NOW item 2).
-- The digest lock payload hardcoded -110 because game_analysis never stored
-- the price of the recommended side. Store it at analysis time so every lock
-- surface reads the same real odds the math graded. Null means the market
-- had no price when the analysis ran (frontend falls back to the moneyline
-- columns for ML sides, and otherwise sends no odds rather than fiction).

alter table public.game_analysis
  add column if not exists recommended_odds integer;

comment on column public.game_analysis.recommended_odds is
  'American odds of recommended_side captured at analysis time (resolveOddsForSide over the odds_cache context). Null when the market carried no price.';
