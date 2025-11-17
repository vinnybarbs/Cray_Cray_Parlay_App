-- add_current_team_id_to_players.sql
-- Add a current_team_id column to players if missing (idempotent and guarded)

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'players') THEN
    EXECUTE 'ALTER TABLE players ADD COLUMN IF NOT EXISTS current_team_id VARCHAR(100)';
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'players' AND column_name = 'current_team_id'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_players_current_team_id ON players(current_team_id)';
    END IF;
  ELSE
    RAISE NOTICE 'Table players does not exist; skipping ALTER TABLE for players.';
  END IF;
END$$;

COMMIT;

-- Run this in the Supabase SQL editor before re-running roster upserts.
