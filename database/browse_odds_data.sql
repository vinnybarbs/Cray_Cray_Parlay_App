-- Browse your collected odds data
-- Run these in Supabase SQL Editor

-- 1. Overall summary
SELECT 
    COUNT(*) as total_odds_entries,
    COUNT(DISTINCT external_game_id) as unique_games,
    COUNT(DISTINCT sport) as sports_count,
    COUNT(DISTINCT bookmaker) as bookmakers_count,
    COUNT(DISTINCT market_type) as market_types_count,
    MIN(last_updated AT TIME ZONE 'America/Denver') as oldest_update_mt,
    MAX(last_updated AT TIME ZONE 'America/Denver') as newest_update_mt
FROM odds_cache;

-- 2. Games by sport (current data)
SELECT 
    sport,
    COUNT(DISTINCT external_game_id) as games_count,
    COUNT(*) as odds_entries,
    MAX(last_updated AT TIME ZONE 'America/Denver') as latest_update_mt
FROM odds_cache 
GROUP BY sport 
ORDER BY games_count DESC;

-- 3. Sample of recent NFL games with odds
SELECT 
    home_team,
    away_team,
    commence_time AT TIME ZONE 'America/Denver' as game_time_mt,
    bookmaker,
    market_type,
    outcomes,
    last_updated AT TIME ZONE 'America/Denver' as updated_mt
FROM odds_cache 
WHERE sport = 'americanfootball_nfl'
    AND commence_time > NOW()
ORDER BY commence_time, home_team
LIMIT 20;

-- 4. Bookmaker coverage
SELECT 
    bookmaker,
    COUNT(DISTINCT external_game_id) as games_covered,
    COUNT(*) as total_odds,
    MAX(last_updated AT TIME ZONE 'America/Denver') as latest_update_mt
FROM odds_cache 
GROUP BY bookmaker 
ORDER BY games_covered DESC;

-- 5. Market types available
SELECT 
    market_type,
    COUNT(DISTINCT external_game_id) as games_count,
    COUNT(*) as entries_count,
    ARRAY_AGG(DISTINCT sport) as sports
FROM odds_cache 
GROUP BY market_type 
ORDER BY games_count DESC;

-- 6. Find specific team's games (example: Chiefs)
SELECT 
    home_team,
    away_team,
    commence_time AT TIME ZONE 'America/Denver' as game_time_mt,
    bookmaker,
    market_type,
    outcomes,
    last_updated AT TIME ZONE 'America/Denver' as updated_mt
FROM odds_cache 
WHERE (home_team ILIKE '%chiefs%' OR away_team ILIKE '%chiefs%')
    AND commence_time > NOW()
ORDER BY commence_time, bookmaker, market_type;

-- 7. Recent data freshness check
SELECT 
    sport,
    COUNT(*) as entries,
    MIN(last_updated AT TIME ZONE 'America/Denver') as oldest_mt,
    MAX(last_updated AT TIME ZONE 'America/Denver') as newest_mt,
    EXTRACT(EPOCH FROM (NOW() - MAX(last_updated)))/3600 as hours_since_update
FROM odds_cache 
GROUP BY sport 
ORDER BY hours_since_update;