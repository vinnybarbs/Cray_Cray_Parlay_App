-- Advanced Mountain Time timezone features and enhancements
-- Current system status and additional capabilities

-- 1. Check current MT timezone system (already implemented)
SELECT 
    'Current MT Time' as feature,
    current_mountain_time() as current_mt_time,
    NOW() as utc_time,
    (NOW() AT TIME ZONE 'America/Denver') as converted_mt_time;

-- 2. Game times in Mountain Time (using existing view)
SELECT 
    home_team,
    away_team,
    commence_time_mt as game_time_mt,
    CASE 
        WHEN commence_time_mt::date = CURRENT_DATE AT TIME ZONE 'America/Denver' THEN 'TODAY'
        WHEN commence_time_mt::date = (CURRENT_DATE AT TIME ZONE 'America/Denver') + INTERVAL '1 day' THEN 'TOMORROW'
        ELSE TO_CHAR(commence_time_mt, 'Day, Mon DD')
    END as game_day,
    TO_CHAR(commence_time_mt, 'HH12:MI AM') as game_time_formatted
FROM odds_cache_mt 
WHERE sport = 'americanfootball_nfl'
    AND commence_time_mt > current_mountain_time()
GROUP BY home_team, away_team, commence_time_mt
ORDER BY commence_time_mt
LIMIT 10;

-- 3. Data freshness in MT (using existing functions)
SELECT 
    sport,
    COUNT(*) as entries,
    format_mt_time(MIN(last_updated)) as oldest_update_mt,
    format_mt_time(MAX(last_updated)) as newest_update_mt,
    EXTRACT(EPOCH FROM (current_mountain_time() - MAX(last_updated AT TIME ZONE 'America/Denver')))/3600 as hours_old
FROM odds_cache 
GROUP BY sport 
ORDER BY hours_old;

-- 4. Enhanced game schedule view with MT formatting
CREATE OR REPLACE VIEW game_schedule_mt AS
SELECT 
    sport,
    home_team,
    away_team,
    commence_time AT TIME ZONE 'America/Denver' as game_time_mt,
    TO_CHAR(commence_time AT TIME ZONE 'America/Denver', 'Dy, Mon DD') as game_date_formatted,
    TO_CHAR(commence_time AT TIME ZONE 'America/Denver', 'HH12:MI AM') as game_time_formatted,
    CASE 
        WHEN (commence_time AT TIME ZONE 'America/Denver')::date = (CURRENT_DATE AT TIME ZONE 'America/Denver') THEN 'TODAY'
        WHEN (commence_time AT TIME ZONE 'America/Denver')::date = (CURRENT_DATE AT TIME ZONE 'America/Denver') + 1 THEN 'TOMORROW'
        WHEN (commence_time AT TIME ZONE 'America/Denver')::date < (CURRENT_DATE AT TIME ZONE 'America/Denver') THEN 'PAST'
        ELSE 'UPCOMING'
    END as game_status,
    external_game_id,
    last_updated AT TIME ZONE 'America/Denver' as last_updated_mt
FROM odds_cache 
GROUP BY sport, home_team, away_team, commence_time, external_game_id, last_updated;

-- 5. Prime time games (evening games in MT)
SELECT 
    sport,
    home_team,
    away_team,
    game_time_formatted,
    game_date_formatted
FROM game_schedule_mt 
WHERE EXTRACT(HOUR FROM game_time_mt) BETWEEN 17 AND 22  -- 5 PM to 10 PM MT
    AND game_status IN ('TODAY', 'TOMORROW', 'UPCOMING')
ORDER BY game_time_mt;

-- 6. Weekend games in MT
SELECT 
    sport,
    home_team,
    away_team,
    game_time_formatted,
    game_date_formatted
FROM game_schedule_mt 
WHERE EXTRACT(DOW FROM game_time_mt) IN (0, 6)  -- Sunday = 0, Saturday = 6
    AND game_status IN ('TODAY', 'TOMORROW', 'UPCOMING')
ORDER BY game_time_mt;