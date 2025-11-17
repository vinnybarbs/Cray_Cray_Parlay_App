-- populate_caches_from_stats.sql
-- Copies data from team_stats/player_stats into team_stats_cache/player_stats_cache
-- Run this in Supabase SQL editor. It will create cache tables if missing and upsert data from the main tables.

BEGIN;

-- Create team_stats_cache if missing (match other scripts expecting this table)
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

-- Create player_stats_cache if missing
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

-- Upsert team_stats -> team_stats_cache
-- Safely cast season into an integer when possible (team_stats_cache.season is integer in live DB)
INSERT INTO team_stats_cache (sport, season, team_id, team_name, city, logo, stats, last_updated)
SELECT
  sport,
  (CASE
     WHEN season IS NULL THEN NULL
     WHEN season ~ '^[0-9]+$' THEN season::integer
     WHEN season ~ '^[0-9]{4}-[0-9]{4}$' THEN (
       CASE
         WHEN split_part(season, '-', 2)::integer = EXTRACT(YEAR FROM now())::integer THEN split_part(season, '-', 2)::integer
         WHEN split_part(season, '-', 1)::integer = EXTRACT(YEAR FROM now())::integer THEN split_part(season, '-', 1)::integer
         ELSE GREATEST(split_part(season, '-', 1)::integer, split_part(season, '-', 2)::integer)
       END
     )
     ELSE NULL
   END) as season,
  team_id::text,
  team_name,
  city,
  logo,
  stats_json,
  last_updated
FROM team_stats
ON CONFLICT (sport, season, team_id) DO UPDATE
  SET team_name = EXCLUDED.team_name,
      city = EXCLUDED.city,
      logo = EXCLUDED.logo,
      stats = EXCLUDED.stats,
      last_updated = EXCLUDED.last_updated;

-- Upsert player_stats -> player_stats_cache
-- Safely cast season for player cache as well
INSERT INTO player_stats_cache (sport, season, player_id, player_name, position, team_id, stats, last_updated)
SELECT
  sport,
  (CASE
     WHEN season IS NULL THEN NULL
     WHEN season ~ '^[0-9]+$' THEN season::integer
     WHEN season ~ '^[0-9]{4}-[0-9]{4}$' THEN (
       CASE
         WHEN split_part(season, '-', 2)::integer = EXTRACT(YEAR FROM now())::integer THEN split_part(season, '-', 2)::integer
         WHEN split_part(season, '-', 1)::integer = EXTRACT(YEAR FROM now())::integer THEN split_part(season, '-', 1)::integer
         ELSE GREATEST(split_part(season, '-', 1)::integer, split_part(season, '-', 2)::integer)
       END
     )
     ELSE NULL
   END) as season,
  player_id::text,
  player_name,
  position,
  team_id,
  stats_json,
  last_updated
FROM player_stats
ON CONFLICT (sport, season, player_id) DO UPDATE
  SET player_name = EXCLUDED.player_name,
      position = EXCLUDED.position,
      team_id = EXCLUDED.team_id,
      stats = EXCLUDED.stats,
      last_updated = EXCLUDED.last_updated;

COMMIT;

-- Validation queries:
-- SELECT COUNT(*) FROM team_stats_cache;
-- SELECT COUNT(*) FROM player_stats_cache;
-- SELECT * FROM team_stats_cache ORDER BY last_updated DESC LIMIT 10;
-- SELECT * FROM player_stats_cache ORDER BY last_updated DESC LIMIT 10;
