-- reset_team_player_stats.sql
-- Safe reset for team/player stats tables.
-- WARNING: Run these statements in your Supabase SQL editor only after you've reviewed them.
-- This script WILL archive existing data into *_archive tables and then DROP and RECREATE the live tables.
-- Steps: 1) Run the archive & recreate statements (single transaction recommended), 2) Verify archive tables contain your old data, 3) Run your sync job.

BEGIN;

-- 1) Create archive tables (if not exists) and copy existing data into them
CREATE TABLE IF NOT EXISTS team_stats_archive AS TABLE team_stats WITH NO DATA;
INSERT INTO team_stats_archive SELECT *, now() as archived_at FROM team_stats ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS player_stats_archive AS TABLE player_stats WITH NO DATA;
INSERT INTO player_stats_archive SELECT *, now() as archived_at FROM player_stats ON CONFLICT DO NOTHING;

-- 2) Drop the live tables (if they exist)
DROP TABLE IF EXISTS team_stats CASCADE;
DROP TABLE IF EXISTS player_stats CASCADE;

-- 3) Recreate the live tables with a clean schema suitable for ESPN syncs
CREATE TABLE team_stats (
  id BIGSERIAL PRIMARY KEY,
  sport VARCHAR(50) NOT NULL,
  season VARCHAR(20) NOT NULL,
  team_id VARCHAR(100) NOT NULL,
  team_name VARCHAR(255) NOT NULL,
  city VARCHAR(100),
  logo TEXT,
  stats_json JSONB NOT NULL,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(sport, season, team_id)
);

CREATE INDEX idx_team_stats_sport_season ON team_stats (sport, season);
CREATE INDEX idx_team_stats_team_id ON team_stats (team_id);
CREATE INDEX idx_team_stats_last_updated ON team_stats (last_updated);

CREATE TABLE player_stats (
  id BIGSERIAL PRIMARY KEY,
  sport VARCHAR(50) NOT NULL,
  season VARCHAR(20) NOT NULL,
  player_id VARCHAR(100) NOT NULL,
  player_name VARCHAR(255) NOT NULL,
  position VARCHAR(50),
  team_id VARCHAR(100),
  stats_json JSONB NOT NULL,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(sport, season, player_id)
);

CREATE INDEX idx_player_stats_sport_season ON player_stats (sport, season);
CREATE INDEX idx_player_stats_player_id ON player_stats (player_id);
CREATE INDEX idx_player_stats_last_updated ON player_stats (last_updated);

-- 4) Ensure api_call_log exists (create if missing)
CREATE TABLE IF NOT EXISTS api_call_log (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  calls_used INTEGER DEFAULT 0,
  sports_synced JSONB,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5) Archive and recreate cache tables so dashboard/cache layers start fresh as well
CREATE TABLE IF NOT EXISTS team_stats_cache_archive AS TABLE team_stats_cache WITH NO DATA;
INSERT INTO team_stats_cache_archive SELECT *, now() as archived_at FROM team_stats_cache ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS player_stats_cache_archive AS TABLE player_stats_cache WITH NO DATA;
INSERT INTO player_stats_cache_archive SELECT *, now() as archived_at FROM player_stats_cache ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS team_stats_cache CASCADE;
DROP TABLE IF EXISTS player_stats_cache CASCADE;

-- Recreate cache tables (kept similar to canonical but can be tuned for read patterns)
CREATE TABLE IF NOT EXISTS team_stats_cache (
  id BIGSERIAL PRIMARY KEY,
  sport VARCHAR(50) NOT NULL,
  season VARCHAR(20) NOT NULL,
  team_id VARCHAR(100) NOT NULL,
  team_name VARCHAR(255) NOT NULL,
  city VARCHAR(100),
  logo TEXT,
  stats JSONB NOT NULL,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(sport, season, team_id)
);
CREATE INDEX IF NOT EXISTS idx_team_stats_cache_sport_season ON team_stats_cache(sport, season);
CREATE INDEX IF NOT EXISTS idx_team_stats_cache_team_id ON team_stats_cache(team_id);
CREATE INDEX IF NOT EXISTS idx_team_stats_cache_last_updated ON team_stats_cache(last_updated);

CREATE TABLE IF NOT EXISTS player_stats_cache (
  id BIGSERIAL PRIMARY KEY,
  sport VARCHAR(50) NOT NULL,
  season VARCHAR(20) NOT NULL,
  player_id VARCHAR(100) NOT NULL,
  player_name VARCHAR(255) NOT NULL,
  position VARCHAR(50),
  team_id VARCHAR(100),
  stats JSONB NOT NULL,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(sport, season, player_id)
);
CREATE INDEX IF NOT EXISTS idx_player_stats_cache_sport_season ON player_stats_cache(sport, season);
CREATE INDEX IF NOT EXISTS idx_player_stats_cache_player_id ON player_stats_cache(player_id);
CREATE INDEX IF NOT EXISTS idx_player_stats_cache_last_updated ON player_stats_cache(last_updated);

-- 6) Logging table for cron/edge function runs (helps diagnose missed runs and failures)
CREATE TABLE IF NOT EXISTS cron_job_logs (
  id BIGSERIAL PRIMARY KEY,
  job_name TEXT NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  finished_at TIMESTAMP WITH TIME ZONE,
  status TEXT,
  detail JSONB,
  created_by TEXT,
  UNIQUE(job_name, started_at)
);

COMMIT;

-- Validation queries (run after the script completes):
-- SELECT count(*) FROM team_stats; -- should be 0 immediately after reset
-- SELECT count(*) FROM team_stats_archive ORDER BY archived_at DESC LIMIT 5; -- backups
-- SELECT count(*) FROM player_stats;
-- When ready, trigger your cron job and run:
-- SELECT * FROM team_stats ORDER BY last_updated DESC LIMIT 10;
-- SELECT * FROM player_stats ORDER BY last_updated DESC LIMIT 10;

-- NOTES:
-- - If you do NOT want archive copies, remove the INSERT INTO ... statements above and only DROP/CREATE.
-- - If you have other tables that reference team_stats/player_stats via foreign keys, review them before running DROP CASCADE.
-- - If you want a full dump instead of archive tables, export the tables from Supabase UI before running this script.
