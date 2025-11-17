-- fix_core_schema.sql
-- Make core canonical tables tolerant to missing provider id columns and add a unified provider_ids JSONB
-- Run after pruning (or before seeding). Non-destructive: uses IF NOT EXISTS and does not remove any columns.

BEGIN;

-- teams: ensure a provider-friendly id column and provider_ids JSON (only if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'teams') THEN
    EXECUTE 'ALTER TABLE teams ADD COLUMN IF NOT EXISTS team_id VARCHAR(100)';
    EXECUTE 'ALTER TABLE teams ADD COLUMN IF NOT EXISTS espn_id BIGINT';
    EXECUTE 'ALTER TABLE teams ADD COLUMN IF NOT EXISTS provider_ids JSONB';
  ELSE
    RAISE NOTICE 'Table teams does not exist; skipping ALTER TABLE for teams.';
  END IF;
END$$;
-- Create indexes only if the underlying column exists to avoid errors when tables/columns were moved/archived
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'team_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_teams_team_id ON teams(team_id)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'espn_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_teams_espn_id ON teams(espn_id)';
  END IF;
END$$;

-- rosters: ensure team_id and player references exist (only if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'rosters') THEN
    EXECUTE 'ALTER TABLE rosters ADD COLUMN IF NOT EXISTS team_id VARCHAR(100)';
    EXECUTE 'ALTER TABLE rosters ADD COLUMN IF NOT EXISTS provider_ids JSONB';
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'rosters' AND column_name = 'team_id'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rosters_team_id ON rosters(team_id)';
    END IF;
  ELSE
    RAISE NOTICE 'Table rosters does not exist; skipping ALTER TABLE for rosters.';
  END IF;
END$$;

-- player_stats: ensure team_id exists and provider_ids (only if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'player_stats') THEN
    EXECUTE 'ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS team_id VARCHAR(100)';
    EXECUTE 'ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS provider_ids JSONB';
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'player_stats' AND column_name = 'team_id'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_player_stats_team_id ON player_stats(team_id)';
    END IF;
  ELSE
    RAISE NOTICE 'Table player_stats does not exist; skipping ALTER TABLE for player_stats.';
  END IF;
END$$;

-- team_stats: ensure team_id exists and provider_ids (only if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'team_stats') THEN
    EXECUTE 'ALTER TABLE team_stats ADD COLUMN IF NOT EXISTS team_id VARCHAR(100)';
    EXECUTE 'ALTER TABLE team_stats ADD COLUMN IF NOT EXISTS provider_ids JSONB';
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'team_stats' AND column_name = 'team_id'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_team_stats_team_id ON team_stats(team_id)';
    END IF;
  ELSE
    RAISE NOTICE 'Table team_stats does not exist; skipping ALTER TABLE for team_stats.';
  END IF;
END$$;

-- caches: add team_id/player_id columns if missing (idempotent, only if tables exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'team_stats_cache') THEN
    EXECUTE 'ALTER TABLE team_stats_cache ADD COLUMN IF NOT EXISTS team_id VARCHAR(100)';
  ELSE
    RAISE NOTICE 'Table team_stats_cache does not exist; skipping ALTER TABLE.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'player_stats_cache') THEN
    EXECUTE 'ALTER TABLE player_stats_cache ADD COLUMN IF NOT EXISTS player_id VARCHAR(100)';
  ELSE
    RAISE NOTICE 'Table player_stats_cache does not exist; skipping ALTER TABLE.';
  END IF;
END$$;

-- players table: add provider_ids and espn_id (only if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'players') THEN
    EXECUTE 'ALTER TABLE players ADD COLUMN IF NOT EXISTS espn_id BIGINT';
    EXECUTE 'ALTER TABLE players ADD COLUMN IF NOT EXISTS provider_ids JSONB';
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'players' AND column_name = 'espn_id'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_players_espn_id ON players(espn_id)';
    END IF;
  ELSE
    RAISE NOTICE 'Table players does not exist; skipping ALTER TABLE for players.';
  END IF;
END$$;

COMMIT;

-- Usage notes:
-- 1) Run this after you run the prune migration or before seeding teams/stats.
-- 2) After running, you can upsert ESPN team ids into teams. Preferred pattern:
--    INSERT INTO teams (team_id, espn_id, team_name, sport, provider_ids) VALUES (...) ON CONFLICT (team_id) DO UPDATE SET espn_id=EXCLUDED.espn_id, team_name=EXCLUDED.team_name, provider_ids=COALESCE(teams.provider_ids || EXCLUDED.provider_ids, EXCLUDED.provider_ids), last_updated = now();
