-- Enhanced cron jobs setup with team stats and player props population
-- Run this in Supabase SQL Editor to add the new functions to your cron schedule

-- First, check existing cron jobs
SELECT 
  jobname, 
  schedule, 
  command, 
  active,
  created,
  last_run_started_at,
  last_run_finished_at,
  last_run_status
FROM cron.job 
WHERE jobname LIKE '%refresh%' OR jobname LIKE '%populate%'
ORDER BY created DESC;

-- Add team stats population (runs every 6 hours)
-- Team stats don't change as frequently as odds
SELECT cron.schedule(
  'populate-team-stats',
  '0 */6 * * *', -- Every 6 hours
  $$
  SELECT
    net.http_post(
      url := 'https://your-project-ref.supabase.co/functions/v1/populate-team-stats',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.supabase_service_role_key') || '"}',
      body := '{}'::jsonb
    ) as request_id;
  $$
);

-- Add player props population (runs every 4 hours)
-- Player props and stats need more frequent updates during active season
SELECT cron.schedule(
  'populate-player-props',
  '0 */4 * * *', -- Every 4 hours
  $$
  SELECT
    net.http_post(
      url := 'https://your-project-ref.supabase.co/functions/v1/populate-player-props',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.supabase_service_role_key') || '"}',
      body := '{}'::jsonb
    ) as request_id;
  $$
);

-- Update the existing odds refresh to happen more frequently during prime time
-- This ensures fresh prop odds are available when player data is updated
SELECT cron.unschedule('refresh-odds-fast');

SELECT cron.schedule(
  'refresh-odds-fast-enhanced',
  '0 * * * *', -- Every hour (was every 1 hour, now ensuring it's consistent)
  $$
  SELECT
    net.http_post(
      url := 'https://your-project-ref.supabase.co/functions/v1/refresh-odds-fast',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.supabase_service_role_key') || '"}',
      body := '{}'::jsonb
    ) as request_id;
  $$
);

-- Create a manual trigger function for immediate updates
-- Usage: SELECT trigger_full_data_refresh();
CREATE OR REPLACE FUNCTION trigger_full_data_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  odds_result jsonb;
  team_stats_result jsonb;
  player_props_result jsonb;
BEGIN
  -- Trigger odds refresh
  SELECT net.http_post(
    url := 'https://your-project-ref.supabase.co/functions/v1/refresh-odds-fast',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.supabase_service_role_key') || '"}',
    body := '{}'::jsonb
  ) INTO odds_result;
  
  -- Wait a bit, then trigger team stats
  PERFORM pg_sleep(2);
  SELECT net.http_post(
    url := 'https://your-project-ref.supabase.co/functions/v1/populate-team-stats',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.supabase_service_role_key') || '"}',
    body := '{}'::jsonb
  ) INTO team_stats_result;
  
  -- Wait a bit, then trigger player props
  PERFORM pg_sleep(2);
  SELECT net.http_post(
    url := 'https://your-project-ref.supabase.co/functions/v1/populate-player-props',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.supabase_service_role_key') || '"}',
    body := '{}'::jsonb
  ) INTO player_props_result;
  
  RETURN jsonb_build_object(
    'odds_refresh', odds_result,
    'team_stats', team_stats_result, 
    'player_props', player_props_result,
    'triggered_at', now()
  );
END;
$$;

-- Show the updated cron schedule
SELECT 
  jobname, 
  schedule, 
  active,
  created
FROM cron.job 
WHERE active = true
ORDER BY created DESC;

-- Quick verification queries to run after setup
/*
-- Check if functions are populating data:

-- 1. Check team stats
SELECT 
  sport, 
  COUNT(*) as teams_count, 
  MAX(last_updated) as last_update 
FROM team_stats_cache 
GROUP BY sport;

-- 2. Check player data 
SELECT 
  sport, 
  COUNT(*) as players_count,
  COUNT(DISTINCT position) as positions_count
FROM players 
GROUP BY sport;

-- 3. Check player stats
SELECT 
  sport,
  season,
  COUNT(*) as stats_records,
  MAX(updated_at) as last_update
FROM player_season_stats
GROUP BY sport, season;

-- 4. Check prop odds availability
SELECT 
  market_type,
  COUNT(*) as games_count
FROM odds_cache 
WHERE market_type LIKE 'player_%'
GROUP BY market_type
ORDER BY games_count DESC;
*/