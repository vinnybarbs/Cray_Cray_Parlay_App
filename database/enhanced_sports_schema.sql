-- Enhanced Sports Statistics Schema for All 9 Sports
-- Supports: NFL, NCAAF, NBA, MLB, NHL, Soccer, Golf, Tennis, UFC
-- Run this in Supabase SQL Editor

-- Add sport-specific metadata table for better organization
CREATE TABLE IF NOT EXISTS sports_metadata (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sport_code TEXT NOT NULL UNIQUE, -- NFL, NBA, etc.
  sport_name TEXT NOT NULL,
  api_host TEXT,
  current_season TEXT,
  season_start DATE,
  season_end DATE,
  is_active BOOLEAN DEFAULT true,
  last_sync TIMESTAMP WITH TIME ZONE,
  sync_frequency_hours INTEGER DEFAULT 24,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert initial sports metadata
INSERT INTO sports_metadata (sport_code, sport_name, api_host, current_season, season_start, season_end, sync_frequency_hours) VALUES
('NFL', 'National Football League', 'v1.american-football.api-sports.io', '2024', '2024-09-01', '2025-02-01', 24),
('NCAAF', 'NCAA Football', 'v1.american-football.api-sports.io', '2024', '2024-08-15', '2025-01-15', 24),
('NBA', 'National Basketball Association', 'v2.nba.api-sports.io', '2024-2025', '2024-10-01', '2025-06-30', 12),
('MLB', 'Major League Baseball', 'v1.baseball.api-sports.io', '2024', '2024-03-15', '2024-11-15', 24),
('NHL', 'National Hockey League', 'v1.hockey.api-sports.io', '2024', '2024-10-01', '2025-06-30', 24),
('SOCCER', 'Soccer (Premier League)', 'v3.football.api-sports.io', '2024', '2024-08-01', '2025-05-31', 24),
('GOLF', 'Professional Golf', 'v1.golf.api-sports.io', '2024', '2024-01-01', '2024-12-31', 168), -- Weekly
('TENNIS', 'Professional Tennis', 'v1.tennis.api-sports.io', '2024', '2024-01-01', '2024-12-31', 168), -- Weekly
('UFC', 'Ultimate Fighting Championship', 'v1.mma.api-sports.io', '2024', '2024-01-01', '2024-12-31', 168) -- Weekly
ON CONFLICT (sport_code) DO UPDATE SET
  sport_name = EXCLUDED.sport_name,
  api_host = EXCLUDED.api_host,
  current_season = EXCLUDED.current_season;

-- Add sport-specific indexes for better performance
CREATE INDEX IF NOT EXISTS idx_team_stats_sport_team_name ON team_stats(sport, team_name);
CREATE INDEX IF NOT EXISTS idx_player_stats_sport_player_name ON player_stats(sport, player_name);
CREATE INDEX IF NOT EXISTS idx_player_stats_position ON player_stats(position) WHERE position IS NOT NULL;

-- Add GIN index on JSONB stats for fast queries on nested data
CREATE INDEX IF NOT EXISTS idx_team_stats_json ON team_stats USING GIN (stats_json);
CREATE INDEX IF NOT EXISTS idx_player_stats_json ON player_stats USING GIN (stats_json);

-- Rankings table for sports like Golf, Tennis, UFC
CREATE TABLE IF NOT EXISTS rankings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  season TEXT NOT NULL,
  player_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  rank_position INTEGER NOT NULL,
  rank_type TEXT, -- 'ATP', 'WTA', 'PGA', 'UFC_P4P', etc.
  points NUMERIC,
  ranking_json JSONB,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(sport, season, player_id, rank_type)
);

CREATE INDEX IF NOT EXISTS idx_rankings_sport_type ON rankings(sport, rank_type);
CREATE INDEX IF NOT EXISTS idx_rankings_position ON rankings(rank_position);

-- Add constraints to ensure data quality
ALTER TABLE team_stats ADD CONSTRAINT team_stats_sport_check 
  CHECK (sport IN ('NFL', 'NCAAF', 'NBA', 'MLB', 'NHL', 'SOCCER', 'GOLF', 'TENNIS', 'UFC'));

ALTER TABLE player_stats ADD CONSTRAINT player_stats_sport_check 
  CHECK (sport IN ('NFL', 'NCAAF', 'NBA', 'MLB', 'NHL', 'SOCCER', 'GOLF', 'TENNIS', 'UFC'));

-- Functions for sport-specific queries
CREATE OR REPLACE FUNCTION get_sport_status() 
RETURNS TABLE(
  sport_code TEXT,
  sport_name TEXT,  
  teams_count BIGINT,
  players_count BIGINT,
  last_team_update TIMESTAMP WITH TIME ZONE,
  last_player_update TIMESTAMP WITH TIME ZONE,
  is_current_season BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sm.sport_code,
    sm.sport_name,
    COALESCE(t.team_count, 0) as teams_count,
    COALESCE(p.player_count, 0) as players_count,
    t.last_update as last_team_update,
    p.last_update as last_player_update,
    (sm.season_start <= CURRENT_DATE AND sm.season_end >= CURRENT_DATE) as is_current_season
  FROM sports_metadata sm
  LEFT JOIN (
    SELECT sport, COUNT(*) as team_count, MAX(last_updated) as last_update 
    FROM team_stats 
    GROUP BY sport
  ) t ON sm.sport_code = t.sport
  LEFT JOIN (
    SELECT sport, COUNT(*) as player_count, MAX(last_updated) as last_update 
    FROM player_stats 
    GROUP BY sport  
  ) p ON sm.sport_code = p.sport
  ORDER BY sm.sport_code;
END;
$$ LANGUAGE plpgsql;

-- View for easy access to current season data
CREATE OR REPLACE VIEW current_season_stats AS
SELECT 
  ts.sport,
  ts.team_name,
  ts.stats_json,
  sm.current_season,
  sm.is_active as sport_active
FROM team_stats ts
JOIN sports_metadata sm ON ts.sport = sm.sport_code
WHERE ts.season = sm.current_season AND sm.is_active = true;

-- Function to clean old data (keep only current + previous season)
CREATE OR REPLACE FUNCTION cleanup_old_stats() RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  -- Delete team stats older than 2 seasons
  WITH old_data AS (
    DELETE FROM team_stats ts
    WHERE NOT EXISTS (
      SELECT 1 FROM sports_metadata sm 
      WHERE sm.sport_code = ts.sport 
      AND ts.season IN (sm.current_season, 
                        CASE 
                          WHEN sm.sport_code IN ('NBA', 'NHL') THEN SPLIT_PART(sm.current_season, '-', 1)::INT - 1 || '-' || SPLIT_PART(sm.current_season, '-', 2)::INT - 1
                          ELSE (sm.current_season::INT - 1)::TEXT
                        END)
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO deleted_count FROM old_data;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Useful queries for monitoring:
-- SELECT * FROM get_sport_status();
-- SELECT * FROM current_season_stats WHERE sport = 'NFL';
-- SELECT sport, COUNT(*) FROM team_stats GROUP BY sport ORDER BY count DESC;
-- SELECT calls_used, sports_synced FROM api_call_log ORDER BY date DESC LIMIT 7;