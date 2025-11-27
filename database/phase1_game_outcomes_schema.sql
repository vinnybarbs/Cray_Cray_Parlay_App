-- Phase 1: Game Outcomes Schema
-- Tables for ESPN game results, AI suggestions tracking, and team name mappings

-- ============================================================================
-- 1. GAME RESULTS TABLE
-- Caches completed games from ESPN Scoreboard API
-- ============================================================================
CREATE TABLE IF NOT EXISTS game_results (
  id BIGSERIAL PRIMARY KEY,
  
  -- Game identification
  sport VARCHAR(50) NOT NULL,
  espn_event_id VARCHAR(255) UNIQUE,
  game_date DATE NOT NULL,
  
  -- Teams
  home_team VARCHAR(255) NOT NULL,
  away_team VARCHAR(255) NOT NULL,
  
  -- Scores
  home_score INTEGER,
  away_score INTEGER,
  
  -- Status
  status VARCHAR(50), -- 'final', 'in_progress', 'scheduled', 'postponed'
  
  -- Full ESPN response for reference
  metadata JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_game_results_date ON game_results(game_date);
CREATE INDEX IF NOT EXISTS idx_game_results_teams ON game_results(home_team, away_team);
CREATE INDEX IF NOT EXISTS idx_game_results_status ON game_results(status);
CREATE INDEX IF NOT EXISTS idx_game_results_sport ON game_results(sport);
CREATE INDEX IF NOT EXISTS idx_game_results_sport_date ON game_results(sport, game_date);

-- ============================================================================
-- 2. AI SUGGESTIONS TABLE
-- Tracks every pick the AI generates for model performance analysis
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_suggestions (
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
  risk_level VARCHAR(50), -- 'Low', 'Medium', 'High'
  generate_mode VARCHAR(50), -- 'quick', 'balanced', 'deep', etc.
  
  -- Outcome tracking
  actual_outcome VARCHAR(50) DEFAULT 'pending', -- 'won', 'lost', 'push', 'pending', 'cancelled'
  resolved_at TIMESTAMPTZ,
  
  -- Optional: Track if user actually locked this pick
  was_locked_by_user BOOLEAN DEFAULT FALSE,
  user_id UUID, -- If locked, which user
  parlay_id BIGINT, -- If locked, which parlay
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: one suggestion per game/bet type per session
  UNIQUE(session_id, home_team, away_team, bet_type, pick)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_outcome ON ai_suggestions(actual_outcome);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_date ON ai_suggestions(game_date);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_session ON ai_suggestions(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_sport ON ai_suggestions(sport);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_pending ON ai_suggestions(actual_outcome) WHERE actual_outcome = 'pending';
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_user ON ai_suggestions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_espn_event ON ai_suggestions(espn_event_id) WHERE espn_event_id IS NOT NULL;

-- ============================================================================
-- 3. TEAM ALIASES TABLE
-- Maps different team name variations to canonical names for matching
-- ============================================================================
CREATE TABLE IF NOT EXISTS team_aliases (
  id SERIAL PRIMARY KEY,
  canonical_name VARCHAR(255) NOT NULL,
  alias VARCHAR(255) NOT NULL,
  sport VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(alias, sport)
);

CREATE INDEX IF NOT EXISTS idx_team_aliases_sport ON team_aliases(sport);
CREATE INDEX IF NOT EXISTS idx_team_aliases_canonical ON team_aliases(canonical_name);

-- ============================================================================
-- 4. INITIAL TEAM ALIASES DATA
-- Common name variations for major sports
-- ============================================================================

-- NFL Team Aliases
INSERT INTO team_aliases (canonical_name, alias, sport) VALUES
  ('Kansas City Chiefs', 'Chiefs', 'NFL'),
  ('Kansas City Chiefs', 'KC Chiefs', 'NFL'),
  ('Kansas City Chiefs', 'Kansas City', 'NFL'),
  ('Buffalo Bills', 'Bills', 'NFL'),
  ('Buffalo Bills', 'Buffalo', 'NFL'),
  ('Los Angeles Chargers', 'Chargers', 'NFL'),
  ('Los Angeles Chargers', 'LA Chargers', 'NFL'),
  ('Los Angeles Chargers', 'LAC', 'NFL'),
  ('Los Angeles Rams', 'Rams', 'NFL'),
  ('Los Angeles Rams', 'LA Rams', 'NFL'),
  ('Los Angeles Rams', 'LAR', 'NFL'),
  ('New England Patriots', 'Patriots', 'NFL'),
  ('New England Patriots', 'New England', 'NFL'),
  ('New England Patriots', 'Pats', 'NFL'),
  ('Dallas Cowboys', 'Cowboys', 'NFL'),
  ('Dallas Cowboys', 'Dallas', 'NFL'),
  ('Green Bay Packers', 'Packers', 'NFL'),
  ('Green Bay Packers', 'Green Bay', 'NFL'),
  ('San Francisco 49ers', '49ers', 'NFL'),
  ('San Francisco 49ers', 'San Francisco', 'NFL'),
  ('San Francisco 49ers', 'Niners', 'NFL'),
  ('Philadelphia Eagles', 'Eagles', 'NFL'),
  ('Philadelphia Eagles', 'Philadelphia', 'NFL'),
  ('Philadelphia Eagles', 'Philly', 'NFL')
ON CONFLICT (alias, sport) DO NOTHING;

-- NBA Team Aliases
INSERT INTO team_aliases (canonical_name, alias, sport) VALUES
  ('Los Angeles Lakers', 'Lakers', 'NBA'),
  ('Los Angeles Lakers', 'LA Lakers', 'NBA'),
  ('Los Angeles Lakers', 'L.A. Lakers', 'NBA'),
  ('Los Angeles Lakers', 'LAL', 'NBA'),
  ('Los Angeles Clippers', 'Clippers', 'NBA'),
  ('Los Angeles Clippers', 'LA Clippers', 'NBA'),
  ('Los Angeles Clippers', 'LAC', 'NBA'),
  ('Boston Celtics', 'Celtics', 'NBA'),
  ('Boston Celtics', 'Boston', 'NBA'),
  ('Golden State Warriors', 'Warriors', 'NBA'),
  ('Golden State Warriors', 'Golden State', 'NBA'),
  ('Golden State Warriors', 'GSW', 'NBA'),
  ('Miami Heat', 'Heat', 'NBA'),
  ('Miami Heat', 'Miami', 'NBA'),
  ('Chicago Bulls', 'Bulls', 'NBA'),
  ('Chicago Bulls', 'Chicago', 'NBA'),
  ('New York Knicks', 'Knicks', 'NBA'),
  ('New York Knicks', 'New York', 'NBA'),
  ('New York Knicks', 'NY Knicks', 'NBA')
ON CONFLICT (alias, sport) DO NOTHING;

-- MLB Team Aliases
INSERT INTO team_aliases (canonical_name, alias, sport) VALUES
  ('New York Yankees', 'Yankees', 'MLB'),
  ('New York Yankees', 'NY Yankees', 'MLB'),
  ('New York Yankees', 'NYY', 'MLB'),
  ('Los Angeles Dodgers', 'Dodgers', 'MLB'),
  ('Los Angeles Dodgers', 'LA Dodgers', 'MLB'),
  ('Los Angeles Dodgers', 'LAD', 'MLB'),
  ('Boston Red Sox', 'Red Sox', 'MLB'),
  ('Boston Red Sox', 'Boston', 'MLB'),
  ('San Francisco Giants', 'Giants', 'MLB'),
  ('San Francisco Giants', 'SF Giants', 'MLB')
ON CONFLICT (alias, sport) DO NOTHING;

-- NHL Team Aliases
INSERT INTO team_aliases (canonical_name, alias, sport) VALUES
  ('Boston Bruins', 'Bruins', 'NHL'),
  ('Boston Bruins', 'Boston', 'NHL'),
  ('Toronto Maple Leafs', 'Maple Leafs', 'NHL'),
  ('Toronto Maple Leafs', 'Toronto', 'NHL'),
  ('Toronto Maple Leafs', 'Leafs', 'NHL'),
  ('Montreal Canadiens', 'Canadiens', 'NHL'),
  ('Montreal Canadiens', 'Montreal', 'NHL'),
  ('Montreal Canadiens', 'Habs', 'NHL')
ON CONFLICT (alias, sport) DO NOTHING;

-- ============================================================================
-- 5. HELPER FUNCTIONS
-- ============================================================================

-- Function to find canonical team name from alias
CREATE OR REPLACE FUNCTION get_canonical_team_name(
  team_name_input TEXT,
  sport_input TEXT
) RETURNS TEXT AS $$
DECLARE
  canonical TEXT;
BEGIN
  -- First try exact match
  SELECT canonical_name INTO canonical
  FROM team_aliases
  WHERE alias = team_name_input AND sport = sport_input
  LIMIT 1;
  
  IF canonical IS NOT NULL THEN
    RETURN canonical;
  END IF;
  
  -- Fallback: case-insensitive partial match
  SELECT canonical_name INTO canonical
  FROM team_aliases
  WHERE alias ILIKE '%' || team_name_input || '%' 
    AND sport = sport_input
  LIMIT 1;
  
  -- If still no match, return original
  RETURN COALESCE(canonical, team_name_input);
END;
$$ LANGUAGE plpgsql;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_game_results_updated_at ON game_results;
CREATE TRIGGER update_game_results_updated_at
  BEFORE UPDATE ON game_results
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ai_suggestions_updated_at ON ai_suggestions;
CREATE TRIGGER update_ai_suggestions_updated_at
  BEFORE UPDATE ON ai_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. USEFUL QUERIES (Documentation)
-- ============================================================================

-- Check AI model performance by sport
-- SELECT 
--   sport,
--   COUNT(*) as total_picks,
--   COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
--   ROUND(COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
--         NULLIF(COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')), 0), 1) as win_rate
-- FROM ai_suggestions
-- WHERE actual_outcome IN ('won', 'lost')
-- GROUP BY sport;

-- Check AI model performance by bet type
-- SELECT 
--   bet_type,
--   COUNT(*) as total_picks,
--   ROUND(AVG(CASE WHEN actual_outcome = 'won' THEN 1 ELSE 0 END) * 100, 1) as win_rate
-- FROM ai_suggestions
-- WHERE actual_outcome IN ('won', 'lost')
-- GROUP BY bet_type
-- ORDER BY win_rate DESC;

-- Check high confidence pick accuracy
-- SELECT 
--   confidence,
--   COUNT(*) as picks,
--   ROUND(AVG(CASE WHEN actual_outcome = 'won' THEN 1 ELSE 0 END) * 100, 1) as win_rate
-- FROM ai_suggestions
-- WHERE actual_outcome IN ('won', 'lost') AND confidence >= 7
-- GROUP BY confidence
-- ORDER BY confidence DESC;

-- Recent model performance (last 7 days)
-- SELECT 
--   DATE(game_date) as date,
--   COUNT(*) as suggestions,
--   COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
--   ROUND(COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
--         NULLIF(COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')), 0), 1) as win_rate
-- FROM ai_suggestions
-- WHERE game_date >= NOW() - INTERVAL '7 days'
--   AND actual_outcome IN ('won', 'lost')
-- GROUP BY DATE(game_date)
-- ORDER BY date DESC;
