-- Add outcome column to parlay_legs table for individual leg tracking
-- Execute this in Supabase SQL Editor

-- Add outcome column to track individual leg results
ALTER TABLE parlay_legs 
ADD COLUMN IF NOT EXISTS outcome VARCHAR(10) CHECK (outcome IN ('win', 'loss', 'push'));

-- Add index for outcome queries
CREATE INDEX IF NOT EXISTS idx_parlay_legs_outcome ON parlay_legs(outcome);

-- Update existing legs where we can determine outcomes
-- This is a one-time migration for existing data

-- Verify the column was added
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'parlay_legs' AND column_name = 'outcome';