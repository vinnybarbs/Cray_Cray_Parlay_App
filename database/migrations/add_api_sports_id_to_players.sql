-- Add api_sports_id column to players table for canonical player identity
-- This allows us to link players across different data sources (API-Sports, ESPN, etc.)

-- Add the column
ALTER TABLE players 
ADD COLUMN IF NOT EXISTS api_sports_id INTEGER;

-- Create unique index (one player per API-Sports ID)
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_api_sports_id 
ON players(api_sports_id) 
WHERE api_sports_id IS NOT NULL;

-- Add regular index for faster lookups
CREATE INDEX IF NOT EXISTS idx_players_api_sports_id_lookup 
ON players(api_sports_id);

-- Update the updated_at timestamp trigger if it exists
COMMENT ON COLUMN players.api_sports_id IS 'Canonical player ID from API-Sports, used to link roster and stats data';

-- Verify the change
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'players' 
  AND column_name = 'api_sports_id';
