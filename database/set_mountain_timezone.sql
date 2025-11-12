-- Set Mountain Time as default for database queries
-- Run this in Supabase SQL Editor to set session timezone

-- 1. Set timezone for current session
SET timezone = 'America/Denver'; -- Mountain Time (handles MST/MDT automatically)

-- 2. Check current timezone setting
SHOW timezone;

-- 3. Convert existing timestamps to Mountain Time for display
SELECT 
    sport,
    market_type,
    COUNT(*) as records,
    MAX(last_updated AT TIME ZONE 'America/Denver') as latest_update_mt,
    MAX(last_updated) as latest_update_utc
FROM odds_cache 
GROUP BY sport, market_type
ORDER BY sport, market_type;

-- 4. Example query showing both UTC and MT times
SELECT 
    home_team,
    away_team,
    commence_time AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver' as game_time_mt,
    commence_time as game_time_utc,
    last_updated AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver' as updated_mt,
    last_updated as updated_utc
FROM odds_cache 
LIMIT 5;