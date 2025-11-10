-- Sports Statistics Caching Tables
-- Run this in Supabase SQL Editor after creating the Edge Function

-- API Call Tracking Table
CREATE TABLE IF NOT EXISTS api_call_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  calls_used INTEGER DEFAULT 0,
  sports_synced TEXT[] DEFAULT ARRAY[]::TEXT[],
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Team Statistics Table
CREATE TABLE IF NOT EXISTS team_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  season TEXT NOT NULL,
  team_id INTEGER NOT NULL,
  team_name TEXT NOT NULL,
  city TEXT,
  logo TEXT,
  stats_json JSONB,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique constraint to prevent duplicates
  UNIQUE(sport, season, team_id)
);

-- Player Statistics Table  
CREATE TABLE IF NOT EXISTS player_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  season TEXT NOT NULL,
  player_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  team_id INTEGER,
  team_name TEXT,
  position TEXT,
  stats_json JSONB,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique constraint to prevent duplicates
  UNIQUE(sport, season, player_id)
);

-- Game Results/Schedule Table
CREATE TABLE IF NOT EXISTS game_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  season TEXT NOT NULL,
  game_id INTEGER NOT NULL UNIQUE,
  date DATE,
  home_team_id INTEGER,
  home_team_name TEXT,
  away_team_id INTEGER, 
  away_team_name TEXT,
  home_score INTEGER,
  away_score INTEGER,
  status TEXT, -- 'scheduled', 'live', 'finished'
  week INTEGER,
  game_json JSONB,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_team_stats_sport_season ON team_stats(sport, season);
CREATE INDEX IF NOT EXISTS idx_player_stats_sport_season ON player_stats(sport, season);  
CREATE INDEX IF NOT EXISTS idx_player_stats_team ON player_stats(team_id);
CREATE INDEX IF NOT EXISTS idx_game_results_sport_season ON game_results(sport, season);
CREATE INDEX IF NOT EXISTS idx_game_results_date ON game_results(date);
CREATE INDEX IF NOT EXISTS idx_api_call_log_date ON api_call_log(date);

-- Row Level Security (optional)
ALTER TABLE api_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_stats ENABLE ROW LEVEL SECURITY;  
ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_results ENABLE ROW LEVEL SECURITY;

-- Sample queries to verify data:
-- SELECT sport, COUNT(*) as teams FROM team_stats GROUP BY sport;
-- SELECT sport, COUNT(*) as players FROM player_stats GROUP BY sport;
-- SELECT date, calls_used, sports_synced FROM api_call_log ORDER BY date DESC;