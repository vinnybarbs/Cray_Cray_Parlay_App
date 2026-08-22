-- Append-only tier path for published picks. Each entry:
-- {tier, odds, edge_pp, at}. Written on first publish and whenever a
-- revision or reprice changes the tier, so the digest and ledger can
-- show "promoted from Strong Play at 3:45 PM" instead of tiers
-- silently swapping between a reader's visit and lock.
alter table public.ai_suggestions add column if not exists tier_history jsonb;
