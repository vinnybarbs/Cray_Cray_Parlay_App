-- ============================================
-- AI SUGGESTIONS CACHE TABLE
-- Stores generated pick suggestions to avoid
-- redundant AI calls and token usage
-- ============================================

CREATE TABLE IF NOT EXISTS ai_suggestions_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport VARCHAR(50) NOT NULL,
  game_date DATE NOT NULL,
  bet_types TEXT[] NOT NULL,
  risk_level VARCHAR(20) NOT NULL,
  num_suggestions INTEGER NOT NULL DEFAULT 20,
  
  -- Cached data
  suggestions JSONB NOT NULL,  -- Array of pick objects
  odds_snapshot JSONB NOT NULL,  -- Odds when generated for staleness check
  analytical_summary TEXT,
  
  -- Cache metadata
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accessed_count INTEGER DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  
  -- Unique constraint: one cache per request configuration
  UNIQUE(sport, game_date, risk_level)
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_suggestions_cache_lookup 
  ON ai_suggestions_cache(sport, game_date, expires_at);

CREATE INDEX IF NOT EXISTS idx_suggestions_cache_expiry 
  ON ai_suggestions_cache(expires_at) 
  WHERE expires_at > NOW();

-- Enable Row Level Security
ALTER TABLE ai_suggestions_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies - cache is shared across users (public read)
DROP POLICY IF EXISTS suggestions_cache_select ON ai_suggestions_cache;
DROP POLICY IF EXISTS suggestions_cache_insert ON ai_suggestions_cache;
DROP POLICY IF EXISTS suggestions_cache_update ON ai_suggestions_cache;
DROP POLICY IF EXISTS suggestions_cache_delete ON ai_suggestions_cache;

CREATE POLICY suggestions_cache_select ON ai_suggestions_cache 
  FOR SELECT USING (true);  -- Anyone can read

CREATE POLICY suggestions_cache_insert ON ai_suggestions_cache 
  FOR INSERT WITH CHECK (true);  -- Anyone can insert

CREATE POLICY suggestions_cache_update ON ai_suggestions_cache 
  FOR UPDATE USING (true);  -- Anyone can update

CREATE POLICY suggestions_cache_delete ON ai_suggestions_cache 
  FOR DELETE USING (true);  -- Anyone can delete

-- Auto-cleanup old cache entries (older than 24 hours)
CREATE OR REPLACE FUNCTION cleanup_old_suggestions_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM ai_suggestions_cache 
  WHERE expires_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- SELECT * FROM ai_suggestions_cache WHERE expires_at > NOW();
-- SELECT COUNT(*) FROM ai_suggestions_cache;
