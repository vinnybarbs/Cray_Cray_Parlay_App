-- ============================================
-- CREATE MISSING PARLAY_LEGS TABLE
-- Run this in Supabase SQL Editor
-- ============================================

-- Create parlay_legs table
CREATE TABLE IF NOT EXISTS parlay_legs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parlay_id UUID NOT NULL REFERENCES parlays(id) ON DELETE CASCADE,
  leg_number INTEGER NOT NULL,
  game_date DATE NOT NULL,
  sport VARCHAR(50) NOT NULL,
  home_team VARCHAR(100) NOT NULL,
  away_team VARCHAR(100) NOT NULL,
  bet_type VARCHAR(50) NOT NULL,
  bet_details JSONB NOT NULL,
  odds VARCHAR(20) NOT NULL,
  confidence INTEGER,
  reasoning TEXT,
  game_completed BOOLEAN DEFAULT false,
  leg_result VARCHAR(20),
  actual_value NUMERIC(10,2),
  margin_of_victory NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  pick_description TEXT,
  pick VARCHAR(200),
  outcome VARCHAR(20),
  settled_at TIMESTAMPTZ
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_parlay_legs_parlay ON parlay_legs(parlay_id);
CREATE INDEX IF NOT EXISTS idx_parlay_legs_game_date ON parlay_legs(game_date);
CREATE INDEX IF NOT EXISTS idx_parlay_legs_teams ON parlay_legs(home_team, away_team);
CREATE INDEX IF NOT EXISTS idx_parlay_legs_bet_type ON parlay_legs(bet_type);

-- Enable Row Level Security
ALTER TABLE parlay_legs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS parlay_legs_select ON parlay_legs;
DROP POLICY IF EXISTS parlay_legs_insert ON parlay_legs;
DROP POLICY IF EXISTS parlay_legs_update ON parlay_legs;
DROP POLICY IF EXISTS parlay_legs_delete ON parlay_legs;

-- Create RLS policies (users can only access their own parlay legs)
CREATE POLICY parlay_legs_select ON parlay_legs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM parlays p WHERE p.id = parlay_id AND p.user_id = auth.uid()
  )
);

CREATE POLICY parlay_legs_insert ON parlay_legs FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM parlays p WHERE p.id = parlay_id AND p.user_id = auth.uid()
  )
);

CREATE POLICY parlay_legs_update ON parlay_legs FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM parlays p WHERE p.id = parlay_id AND p.user_id = auth.uid()
  )
);

CREATE POLICY parlay_legs_delete ON parlay_legs FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM parlays p WHERE p.id = parlay_id AND p.user_id = auth.uid()
  )
);

-- ============================================
-- Verification Query
-- Run this after creating the table:
-- ============================================
-- SELECT tablename FROM pg_tables WHERE tablename = 'parlay_legs';
