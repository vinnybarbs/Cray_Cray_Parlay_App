-- Inspect Player-Related Tables in Supabase
-- Run this in Supabase SQL Editor to see what you have

-- 1. List all player-related tables
SELECT table_name, 
       (SELECT COUNT(*) FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public' 
  AND table_name LIKE '%player%'
ORDER BY table_name;

-- 2. Show 'players' table structure
SELECT 
  column_name,
  data_type,
  character_maximum_length,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'players'
ORDER BY ordinal_position;

-- 3. Show 'player_stats' table structure
SELECT 
  column_name,
  data_type,
  character_maximum_length,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'player_stats'
ORDER BY ordinal_position;

-- 4. Show 'player_stats_cache' table structure
SELECT 
  column_name,
  data_type,
  character_maximum_length,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'player_stats_cache'
ORDER BY ordinal_position;

-- 5. Show 'player_stats_season' table structure
SELECT 
  column_name,
  data_type,
  character_maximum_length,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'player_stats_season'
ORDER BY ordinal_position;

-- 6. Show 'player_aliases' table structure
SELECT 
  column_name,
  data_type,
  character_maximum_length,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'player_aliases'
ORDER BY ordinal_position;

-- 7. Sample data from each table
SELECT '=== PLAYERS SAMPLE ===' as info;
SELECT * FROM players LIMIT 3;

SELECT '=== PLAYER_STATS SAMPLE ===' as info;
SELECT * FROM player_stats LIMIT 3;

SELECT '=== PLAYER_STATS_CACHE SAMPLE ===' as info;
SELECT * FROM player_stats_cache LIMIT 3;

SELECT '=== PLAYER_STATS_SEASON SAMPLE ===' as info;
SELECT * FROM player_stats_season LIMIT 3;

SELECT '=== PLAYER_ALIASES SAMPLE ===' as info;
SELECT * FROM player_aliases LIMIT 3;

-- 8. Check for indexes
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public' 
  AND tablename LIKE '%player%'
ORDER BY tablename, indexname;
