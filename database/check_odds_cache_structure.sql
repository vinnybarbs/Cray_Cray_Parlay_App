-- Check odds cache data with correct column names
-- Run this in Supabase SQL Editor

-- 1. First, let's see the actual structure of odds_cache
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'odds_cache' 
AND table_schema = 'public'
ORDER BY ordinal_position;

-- 2. Check if odds data exists and when it was last updated
SELECT 
    COUNT(*) as total_records,
    MAX(last_updated) as most_recent_update,
    MIN(last_updated) as oldest_update,
    COUNT(DISTINCT sport) as sports_count,
    COUNT(DISTINCT market_type) as market_types_count
FROM odds_cache;

-- 2b. Check data by sport and market type
SELECT 
    sport,
    market_type,
    COUNT(*) as records,
    MAX(last_updated) as latest_update
FROM odds_cache 
GROUP BY sport, market_type
ORDER BY sport, market_type;

-- 3. Show sample data from odds_cache (first 3 rows)
SELECT * FROM odds_cache LIMIT 3;