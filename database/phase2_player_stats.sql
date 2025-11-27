-- Phase 2: Player Stats Integration
-- Updates player_stats_cache to work with ESPN Player Stats Service

-- Ensure player_stats_cache table has correct structure
CREATE TABLE IF NOT EXISTS player_stats_cache (
  id BIGSERIAL PRIMARY KEY,
  espn_id VARCHAR(50) NOT NULL,
  sport VARCHAR(50) NOT NULL,
  stats JSONB NOT NULL, -- Stores parsed stats from ESPN
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(espn_id, sport)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_player_stats_cache_espn_id ON player_stats_cache(espn_id);
CREATE INDEX IF NOT EXISTS idx_player_stats_cache_sport ON player_stats_cache(sport);
CREATE INDEX IF NOT EXISTS idx_player_stats_cache_updated ON player_stats_cache(updated_at);

-- Function to automatically update updated_at
CREATE OR REPLACE FUNCTION update_player_stats_cache_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS player_stats_cache_updated_at ON player_stats_cache;
CREATE TRIGGER player_stats_cache_updated_at
  BEFORE UPDATE ON player_stats_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_player_stats_cache_timestamp();

-- Add index to players table for faster name lookups
CREATE INDEX IF NOT EXISTS idx_players_name_trgm ON players USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_players_sport_name ON players(sport, name);
CREATE INDEX IF NOT EXISTS idx_players_espn_id ON players(espn_id);

COMMENT ON TABLE player_stats_cache IS 'Caches recent player stats from ESPN API (12-hour TTL). Used by AI for prop analysis.';

-- Verification query
SELECT 
  'player_stats_cache' as table_name,
  COUNT(*) as cached_players,
  MAX(updated_at) as last_update,
  COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '12 hours') as fresh_cache
FROM player_stats_cache;
