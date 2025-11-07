-- Fix varchar(20) columns that are too short
-- Run this in Supabase SQL Editor

ALTER TABLE parlays 
  ALTER COLUMN combined_odds TYPE VARCHAR(50),
  ALTER COLUMN status TYPE VARCHAR(50),
  ALTER COLUMN final_outcome TYPE VARCHAR(50),
  ALTER COLUMN risk_level TYPE VARCHAR(50),
  ALTER COLUMN preference_type TYPE VARCHAR(50);

ALTER TABLE parlay_legs
  ALTER COLUMN odds TYPE VARCHAR(50),
  ALTER COLUMN leg_result TYPE VARCHAR(50);

-- Fix odds_cache table
ALTER TABLE odds_cache
  ALTER COLUMN sport TYPE VARCHAR(50),
  ALTER COLUMN bookmaker TYPE VARCHAR(50),
  ALTER COLUMN market_type TYPE VARCHAR(100);
