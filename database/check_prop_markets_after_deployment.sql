-- Check if the enhanced odds refresh is now fetching player props
-- Run in Supabase SQL Editor

-- 1. Check for player prop markets in odds cache
SELECT 
    market_type,
    COUNT(*) as entries,
    COUNT(DISTINCT external_game_id) as unique_games,
    MAX(last_updated) as latest_update
FROM odds_cache 
WHERE market_type LIKE 'player_%'
GROUP BY market_type 
ORDER BY entries DESC;

-- 2. Show all market types to see what's being cached
SELECT 
    market_type,
    COUNT(*) as count
FROM odds_cache 
GROUP BY market_type 
ORDER BY 
    CASE 
        WHEN market_type LIKE 'player_%' THEN 1 
        ELSE 2 
    END,
    count DESC;

-- 3. Check recent player prop odds (if any)
SELECT 
    market_type,
    home_team,
    away_team,
    bookmaker,
    outcomes::text as outcome_sample,
    last_updated
FROM odds_cache 
WHERE market_type LIKE 'player_%'
ORDER BY last_updated DESC
LIMIT 10;