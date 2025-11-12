-- Complete timezone setup for Mountain Time across all data
-- Run this in Supabase SQL Editor

-- 1. Set default timezone for the database session
ALTER DATABASE postgres SET timezone = 'America/Denver';

-- 2. Drop existing view and create a fresh one with correct timestamp types
-- Note: "timestamptz AT TIME ZONE 'America/Denver'" returns timestamp (without tz)
-- This gives us the local wall time in Mountain Time
DROP VIEW IF EXISTS odds_cache_mt;

CREATE VIEW odds_cache_mt AS
SELECT 
    id,
    sport,
    game_id,
    external_game_id,
    (commence_time AT TIME ZONE 'America/Denver') as commence_time_mt,
    commence_time as commence_time_utc,
    home_team,
    away_team,
    bookmaker,
    market_type,
    outcomes,
    (last_updated AT TIME ZONE 'America/Denver') as last_updated_mt,
    last_updated as last_updated_utc
FROM odds_cache;

-- 3. Create helper function for Mountain Time formatting
CREATE OR REPLACE FUNCTION format_mt_time(utc_time timestamptz)
RETURNS text AS $$
BEGIN
    RETURN to_char(utc_time AT TIME ZONE 'America/Denver', 'MM/DD/YYYY HH12:MI:SS AM TZ');
END;
$$ LANGUAGE plpgsql;

-- 4. Create function to get current Mountain Time
CREATE OR REPLACE FUNCTION current_mountain_time()
RETURNS text AS $$
BEGIN
    RETURN to_char(now() AT TIME ZONE 'America/Denver', 'MM/DD/YYYY HH12:MI:SS AM TZ');
END;
$$ LANGUAGE plpgsql;

-- 5. Test the Mountain Time conversion with correct logic
SELECT 
    'UTC: Nov 14 01:15' as description,
    '2025-11-14 01:15:00+00'::timestamptz as utc_time,
    ('2025-11-14 01:15:00+00'::timestamptz AT TIME ZONE 'America/Denver') as mt_time
UNION ALL
SELECT 
    'Current UTC',
    now(),
    (now() AT TIME ZONE 'America/Denver')
UNION ALL  
SELECT 
    'Sample game MT',
    (SELECT commence_time_utc FROM odds_cache_mt LIMIT 1),
    (SELECT commence_time_mt FROM odds_cache_mt LIMIT 1);

-- 6. Verify the conversion is correct (should show Nov 13 evening)
SELECT 
    home_team,
    away_team,
    commence_time_utc,
    commence_time_mt,
    to_char(commence_time_mt, 'Day, MM/DD/YYYY at HH12:MI AM') as formatted_mt_time
FROM odds_cache_mt 
LIMIT 3;