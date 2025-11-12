-- Check player data and stats availability for props
-- Run this in Supabase SQL Editor to see what data you have

-- 1. Check what players are in the database
SELECT 
    sport,
    COUNT(*) as total_players,
    COUNT(DISTINCT position) as unique_positions,
    COUNT(CASE WHEN provider_ids IS NOT NULL THEN 1 END) as players_with_espn_data
FROM players 
GROUP BY sport 
ORDER BY total_players DESC;

-- 2. Sample of players with their data
SELECT 
    name,
    sport,
    position,
    provider_ids,
    teams.name as team_name,
    created_at
FROM players 
LEFT JOIN teams ON players.team_id = teams.id
WHERE sport IN ('nfl', 'nba', 'mlb')
ORDER BY sport, name
LIMIT 20;

-- 3. Check if we have any player statistics
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
    AND table_name LIKE '%stat%';

-- 4. Check if we have player season stats
SELECT 
    COUNT(*) as total_stat_records,
    COUNT(DISTINCT player_id) as unique_players_with_stats,
    MIN(created_at) as oldest_stat,
    MAX(created_at) as newest_stat
FROM player_season_stats
WHERE season = 2025;

-- 5. Sample player stats (if they exist)
SELECT 
    pss.*,
    p.name,
    p.sport,
    p.position
FROM player_season_stats pss
JOIN players p ON pss.player_id = p.id
WHERE pss.season = 2025
LIMIT 10;

-- 6. Check what odds we have for player props
SELECT 
    sport,
    market_type,
    COUNT(*) as odds_entries,
    COUNT(DISTINCT external_game_id) as games_with_props
FROM odds_cache 
WHERE market_type LIKE '%player%'
GROUP BY sport, market_type
ORDER BY odds_entries DESC;

-- 7. Sample player prop odds
SELECT 
    sport,
    home_team,
    away_team,
    bookmaker,
    market_type,
    outcomes,
    commence_time AT TIME ZONE 'America/Denver' as game_time_mt
FROM odds_cache 
WHERE market_type LIKE '%player%'
    AND commence_time > NOW()
ORDER BY commence_time
LIMIT 10;