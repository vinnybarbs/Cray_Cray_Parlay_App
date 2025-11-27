-- Phase 1: AI Suggestions Table (Simple Version)
-- Works with your CURRENT schema (no parlays/parlay_legs dependency)

-- Drop if exists
DROP TABLE IF EXISTS ai_suggestions CASCADE;

-- Create standalone ai_suggestions table
CREATE TABLE ai_suggestions (
  id BIGSERIAL PRIMARY KEY,
  
  -- Session grouping
  session_id VARCHAR(255) NOT NULL,
  
  -- Game details
  sport VARCHAR(50) NOT NULL,
  home_team VARCHAR(255) NOT NULL,
  away_team VARCHAR(255) NOT NULL,
  game_date TIMESTAMPTZ NOT NULL,
  espn_event_id VARCHAR(255),
  
  -- Pick details
  bet_type VARCHAR(100) NOT NULL,
  pick TEXT NOT NULL,
  odds VARCHAR(50),
  point DECIMAL(10,2),
  
  -- AI metadata
  confidence INTEGER CHECK (confidence >= 1 AND confidence <= 10),
  reasoning TEXT,
  risk_level VARCHAR(50),
  generate_mode VARCHAR(50),
  
  -- Outcome tracking
  actual_outcome VARCHAR(50) DEFAULT 'pending',
  resolved_at TIMESTAMPTZ,
  
  -- User tracking (NO foreign keys - just store UUIDs)
  was_locked_by_user BOOLEAN DEFAULT FALSE,
  user_id UUID, -- Just stores the UUID, no FK constraint
  parlay_id UUID, -- Just stores the UUID, no FK constraint
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(session_id, home_team, away_team, bet_type, pick)
);

-- Indexes
CREATE INDEX idx_ai_suggestions_outcome ON ai_suggestions(actual_outcome);
CREATE INDEX idx_ai_suggestions_date ON ai_suggestions(game_date);
CREATE INDEX idx_ai_suggestions_session ON ai_suggestions(session_id);
CREATE INDEX idx_ai_suggestions_sport ON ai_suggestions(sport);
CREATE INDEX idx_ai_suggestions_pending ON ai_suggestions(actual_outcome) WHERE actual_outcome = 'pending';
CREATE INDEX idx_ai_suggestions_user ON ai_suggestions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_ai_suggestions_parlay ON ai_suggestions(parlay_id) WHERE parlay_id IS NOT NULL;
CREATE INDEX idx_ai_suggestions_espn_event ON ai_suggestions(espn_event_id) WHERE espn_event_id IS NOT NULL;

-- RLS Policies
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

-- Anyone can see suggestions (for now - tighten later)
CREATE POLICY ai_suggestions_select_public ON ai_suggestions 
  FOR SELECT USING (true);

-- Service role can insert
CREATE POLICY ai_suggestions_insert ON ai_suggestions 
  FOR INSERT WITH CHECK (true);

-- Users can update their own
CREATE POLICY ai_suggestions_update_own ON ai_suggestions 
  FOR UPDATE USING (
    user_id IS NULL OR auth.uid() = user_id
  );

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_ai_suggestions_updated_at ON ai_suggestions;
CREATE TRIGGER update_ai_suggestions_updated_at
  BEFORE UPDATE ON ai_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Simple performance view (no parlays table dependency)
CREATE OR REPLACE VIEW ai_model_performance AS
SELECT 
  sport,
  bet_type,
  risk_level,
  COUNT(*) as total_suggestions,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as losses,
  COUNT(*) FILTER (WHERE actual_outcome = 'push') as pushes,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
    NULLIF(COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')), 0),
    1
  ) as win_rate,
  COUNT(*) FILTER (WHERE was_locked_by_user = true) as locked_by_users,
  ROUND(
    COUNT(*) FILTER (WHERE was_locked_by_user = true AND actual_outcome = 'won') * 100.0 /
    NULLIF(COUNT(*) FILTER (WHERE was_locked_by_user = true AND actual_outcome IN ('won', 'lost')), 0),
    1
  ) as user_selection_win_rate
FROM ai_suggestions
WHERE resolved_at IS NOT NULL
GROUP BY sport, bet_type, risk_level;

COMMENT ON TABLE ai_suggestions IS 'Tracks every AI pick suggestion for model performance analysis. Standalone version that works without parlays table.';
COMMENT ON VIEW ai_model_performance IS 'AI model performance metrics by sport, bet type, and risk level.';

-- Verify it worked
SELECT 'ai_suggestions table created successfully!' as status;
