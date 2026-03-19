-- Quick Player Schema & Data Check
-- Run this in Supabase SQL Editor

-- 1. Show players table structure
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'players'
ORDER BY ordinal_position;

-- 2. Count players by sport
SELECT 
  sport,
  COUNT(*) as player_count,
  MAX(updated_at) as last_updated
FROM players
GROUP BY sport
ORDER BY sport;

-- 3. Sample players data
SELECT 
  id,
  name,
  sport,
  position,
  current_team_id,
  player_id,
  updated_at
FROM players
ORDER BY updated_at DESC NULLS LAST
LIMIT 5;

-- 4. Check player_stats_cache structure
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'player_stats_cache'
ORDER BY ordinal_position;

-- 5. Sample stats cache (if exists)
SELECT * FROM player_stats_cache 
ORDER BY updated_at DESC NULLS LAST
LIMIT 5;

-- 6. Check for scheduled jobs
SELECT 
  jobname,
  schedule,
  active,
  command
FROM cron.job
WHERE jobname LIKE '%player%' OR jobname LIKE '%roster%' OR jobname LIKE '%stats%'
ORDER BY jobname;
