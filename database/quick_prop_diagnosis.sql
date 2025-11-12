-- Quick diagnostic queries for player props troubleshooting
-- Copy/paste these into Supabase SQL Editor one at a time

-- Query 1: Check players table (should show if it's empty)
SELECT COUNT(*) as total_players FROM players;

-- Query 2: Check current odds cache markets
SELECT DISTINCT market_key, COUNT(*) as count 
FROM odds_cache 
GROUP BY market_key 
ORDER BY count DESC;

-- Query 3: Check for any player prop markets in cache
SELECT COUNT(*) as prop_odds_count 
FROM odds_cache 
WHERE market_key LIKE 'player_%';

-- Query 4: Check ESPN player data (should show if integration worked)
SELECT COUNT(*) as espn_players_count 
FROM players 
WHERE provider_ids IS NOT NULL;