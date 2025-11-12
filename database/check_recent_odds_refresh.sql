-- Quick check to see what markets are in the odds cache after the refresh
SELECT 
    market_type,
    COUNT(*) as count,
    COUNT(DISTINCT external_game_id) as games
FROM odds_cache 
WHERE last_updated > NOW() - INTERVAL '1 hour'
GROUP BY market_type 
ORDER BY count DESC;

-- Check specifically for player prop markets
SELECT COUNT(*) as prop_count
FROM odds_cache 
WHERE market_type LIKE 'player_%' 
    AND last_updated > NOW() - INTERVAL '1 hour';