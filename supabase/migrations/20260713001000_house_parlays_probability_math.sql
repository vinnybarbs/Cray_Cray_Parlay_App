-- Parlay edges don't add: each leg's edge_pp is a probability gap and
-- parlay probabilities multiply. Store the honest combined numbers.
-- (Applied to prod 2026-07-12 evening with a backfill of existing rows.)
alter table house_parlays add column if not exists model_win_prob numeric;
alter table house_parlays add column if not exists fair_win_prob numeric;
alter table house_parlays add column if not exists ev_pct numeric;
