-- Add team_name column to players table for fast queries
-- This eliminates the need for joins and makes player prop queries lightning fast

ALTER TABLE players ADD COLUMN IF NOT EXISTS team_name text;

-- Update all existing players with their team names
UPDATE players 
SET team_name = teams.name 
FROM teams 
WHERE players.team_id = teams.id 
AND players.team_name IS NULL;

-- Create index on team_name for fast filtering
CREATE INDEX IF NOT EXISTS idx_players_team_name ON players(team_name);

-- Create composite index for sport + team_name queries
CREATE INDEX IF NOT EXISTS idx_players_sport_team ON players(sport, team_name);

-- Verify the update
SELECT 
  sport,
  COUNT(*) as total_players,
  COUNT(team_name) as players_with_team_names,
  ROUND(COUNT(team_name) * 100.0 / COUNT(*), 1) as percentage_mapped
FROM players 
WHERE sport IN ('nfl', 'nba', 'mlb')
GROUP BY sport
ORDER BY sport;