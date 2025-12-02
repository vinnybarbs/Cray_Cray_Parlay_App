-- Run this in Supabase SQL Editor FIRST
-- URL: https://supabase.com/dashboard/project/pcjhulzyqmhrhsrgvwvx/sql/new

-- 1. Add api_sports_id to players table
ALTER TABLE players 
ADD COLUMN IF NOT EXISTS api_sports_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_api_sports_id 
ON players(api_sports_id) 
WHERE api_sports_id IS NOT NULL;

-- 2. Add api_sports_id and league to teams table  
ALTER TABLE teams 
ADD COLUMN IF NOT EXISTS api_sports_id INTEGER;

ALTER TABLE teams
ADD COLUMN IF NOT EXISTS league VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_api_sports_id 
ON teams(api_sports_id) 
WHERE api_sports_id IS NOT NULL;
