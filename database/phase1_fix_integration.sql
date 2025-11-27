-- Phase 1: FIX - Integrate ai_suggestions with existing parlays structure
-- This updates the standalone ai_suggestions table to work with your existing schema

-- First, check if ai_suggestions exists and drop if needed (for clean slate)
DROP TABLE IF EXISTS ai_suggestions CASCADE;

-- Recreate ai_suggestions with PROPER integration
CREATE TABLE ai_suggestions (
  id BIGSERIAL PRIMARY KEY,
  
  -- Session grouping (all picks from same generation)
  session_id VARCHAR(255) NOT NULL,
  
  -- Game details
  sport VARCHAR(50) NOT NULL,
  home_team VARCHAR(255) NOT NULL,
  away_team VARCHAR(255) NOT NULL,
  game_date TIMESTAMPTZ NOT NULL,
  espn_event_id VARCHAR(255), -- Link to game_results
  
  -- Pick details
  bet_type VARCHAR(100) NOT NULL, -- 'Spread', 'Moneyline', 'Totals', 'Player Props', 'TD'
  pick TEXT NOT NULL,
  odds VARCHAR(50),
  point DECIMAL(10,2), -- spread/total line or prop line
  
  -- AI metadata
  confidence INTEGER CHECK (confidence >= 1 AND confidence <= 10),
  reasoning TEXT,
  risk_level VARCHAR(50), -- 'Low', 'Medium', 'High' - matches your parlays.risk_level
  generate_mode VARCHAR(50), -- 'quick', 'balanced', 'deep', etc.
  
  -- Outcome tracking
  actual_outcome VARCHAR(50) DEFAULT 'pending', -- 'won', 'lost', 'push', 'pending', 'cancelled'
  resolved_at TIMESTAMPTZ,
  
  -- INTEGRATION with your existing parlays system
  was_locked_by_user BOOLEAN DEFAULT FALSE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Proper FK to auth.users
  parlay_id UUID REFERENCES parlays(id) ON DELETE SET NULL, -- Proper FK to parlays (UUID not BIGINT!)
  parlay_leg_id UUID REFERENCES parlay_legs(id) ON DELETE SET NULL, -- Link to specific leg
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: one suggestion per game/bet type per session
  UNIQUE(session_id, home_team, away_team, bet_type, pick)
);

-- Indexes for efficient querying
CREATE INDEX idx_ai_suggestions_outcome ON ai_suggestions(actual_outcome);
CREATE INDEX idx_ai_suggestions_date ON ai_suggestions(game_date);
CREATE INDEX idx_ai_suggestions_session ON ai_suggestions(session_id);
CREATE INDEX idx_ai_suggestions_sport ON ai_suggestions(sport);
CREATE INDEX idx_ai_suggestions_pending ON ai_suggestions(actual_outcome) WHERE actual_outcome = 'pending';
CREATE INDEX idx_ai_suggestions_user ON ai_suggestions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_ai_suggestions_parlay ON ai_suggestions(parlay_id) WHERE parlay_id IS NOT NULL;
CREATE INDEX idx_ai_suggestions_espn_event ON ai_suggestions(espn_event_id) WHERE espn_event_id IS NOT NULL;

-- RLS Policies (match your existing pattern)
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

-- Users can see their own suggestions
CREATE POLICY ai_suggestions_select ON ai_suggestions 
  FOR SELECT USING (
    user_id IS NULL OR auth.uid() = user_id
  );

-- Service role can insert (for API)
CREATE POLICY ai_suggestions_insert ON ai_suggestions 
  FOR INSERT WITH CHECK (true); -- API uses service role

-- Users can update their own
CREATE POLICY ai_suggestions_update ON ai_suggestions 
  FOR UPDATE USING (
    auth.uid() = user_id
  );

-- Trigger for updated_at
CREATE TRIGGER update_ai_suggestions_updated_at
  BEFORE UPDATE ON ai_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- HELPER VIEW: Combined AI Performance
-- Shows AI suggestions alongside what users actually locked
-- ============================================================================

CREATE OR REPLACE VIEW ai_performance_comparison AS
SELECT 
  -- AI Suggestions (all picks made)
  COUNT(DISTINCT s.id) as total_ai_suggestions,
  COUNT(DISTINCT s.id) FILTER (WHERE s.actual_outcome = 'won') as ai_wins,
  COUNT(DISTINCT s.id) FILTER (WHERE s.actual_outcome = 'lost') as ai_losses,
  ROUND(
    COUNT(DISTINCT s.id) FILTER (WHERE s.actual_outcome = 'won') * 100.0 / 
    NULLIF(COUNT(DISTINCT s.id) FILTER (WHERE s.actual_outcome IN ('won', 'lost')), 0),
    1
  ) as ai_win_rate,
  
  -- User Locked Picks (what users chose from AI suggestions)
  COUNT(DISTINCT s.id) FILTER (WHERE s.was_locked_by_user = true) as locked_suggestions,
  COUNT(DISTINCT s.id) FILTER (WHERE s.was_locked_by_user = true AND s.actual_outcome = 'won') as locked_wins,
  ROUND(
    COUNT(DISTINCT s.id) FILTER (WHERE s.was_locked_by_user = true AND s.actual_outcome = 'won') * 100.0 /
    NULLIF(COUNT(DISTINCT s.id) FILTER (WHERE s.was_locked_by_user = true AND s.actual_outcome IN ('won', 'lost')), 0),
    1
  ) as user_selection_win_rate,
  
  -- User Parlays (complete parlays - need all legs to win)
  COUNT(DISTINCT p.id) as total_parlays,
  COUNT(DISTINCT p.id) FILTER (WHERE p.final_outcome = 'won') as parlay_wins,
  ROUND(
    COUNT(DISTINCT p.id) FILTER (WHERE p.final_outcome = 'won') * 100.0 /
    NULLIF(COUNT(DISTINCT p.id) FILTER (WHERE p.final_outcome IN ('won', 'lost')), 0),
    1
  ) as parlay_win_rate

FROM ai_suggestions s
LEFT JOIN parlays p ON s.parlay_id = p.id
WHERE s.resolved_at IS NOT NULL;

-- ============================================================================
-- HELPER FUNCTION: Mark suggestion as locked
-- Call this when user locks a pick
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_suggestion_as_locked(
  p_session_id TEXT,
  p_pick_id TEXT,
  p_user_id UUID,
  p_parlay_id UUID,
  p_parlay_leg_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE ai_suggestions
  SET 
    was_locked_by_user = true,
    user_id = p_user_id,
    parlay_id = p_parlay_id,
    parlay_leg_id = p_parlay_leg_id,
    updated_at = NOW()
  WHERE session_id = p_session_id
    AND id::TEXT LIKE '%' || p_pick_id || '%' -- Match by pick ID from frontend
  ;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION mark_suggestion_as_locked TO authenticated;

COMMENT ON TABLE ai_suggestions IS 'Tracks every AI pick suggestion for model performance analysis. Integrates with parlays table to compare AI accuracy vs user selection.';
COMMENT ON VIEW ai_performance_comparison IS 'Compares AI model win rate vs user pick selection win rate vs complete parlay win rate.';
