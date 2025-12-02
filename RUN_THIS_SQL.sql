-- Copy and paste this into Supabase SQL Editor
-- URL: https://supabase.com/dashboard/project/pcjhulzyqmhrhsrgvwvx/sql/new

ALTER TABLE players 
ADD COLUMN api_sports_id INTEGER;

CREATE UNIQUE INDEX idx_players_api_sports_id 
ON players(api_sports_id) 
WHERE api_sports_id IS NOT NULL;
