-- Test queries to check if the enhanced odds refresh is working
-- Run these in Supabase SQL Editor to see current state

-- 1. Check current odds cache for prop markets
SELECT 
    market_type,
    COUNT(*) as odds_count,
    MAX(last_updated) as latest_update
FROM odds_cache 
WHERE market_type LIKE 'player_%'
GROUP BY market_type 
ORDER BY odds_count DESC;

-- 2. Check all market types currently cached
SELECT 
    market_type,
    COUNT(*) as count,
    COUNT(DISTINCT external_game_id) as unique_games
FROM odds_cache 
GROUP BY market_type 
ORDER BY count DESC;

-- 3. Check recent odds updates to see if refresh is working
SELECT 
    market_type,
    sport,
    bookmaker,
    COUNT(*) as entries,
    MAX(last_updated) as most_recent,
    MIN(last_updated) as oldest
FROM odds_cache 
WHERE last_updated > NOW() - INTERVAL '2 hours'
GROUP BY market_type, sport, bookmaker
ORDER BY most_recent DESC;

-- 4. Look for any prop market odds that might exist
SELECT 
    market_type,
    home_team,
    away_team,
    bookmaker,
    outcomes,
    last_updated
FROM odds_cache 
WHERE market_type LIKE 'player_%'
ORDER BY last_updated DESC
LIMIT 10;

-- 5. Check if we have any players in the database
SELECT 
    sport,
    COUNT(*) as player_count,
    COUNT(DISTINCT position) as unique_positions
FROM players
GROUP BY sport;