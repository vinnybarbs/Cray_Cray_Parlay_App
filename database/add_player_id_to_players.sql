-- add_player_id_to_players.sql
-- Add a player_id column (string) to players and backfill from espn_id or id

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'players') THEN
    -- add column if missing
    EXECUTE 'ALTER TABLE players ADD COLUMN IF NOT EXISTS player_id VARCHAR(100)';
    -- backfill player_id from espn_id or id where it's null
    EXECUTE 'UPDATE players SET player_id = COALESCE(NULLIF(espn_id::text, ''''), id::text) WHERE player_id IS NULL';
    -- create a non-unique index for lookups; don't force uniqueness automatically
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_players_player_id ON players(player_id)';
  ELSE
    RAISE NOTICE 'Table players does not exist; skipping ALTER TABLE for players.';
  END IF;
END$$;

COMMIT;

-- Run in Supabase SQL editor before re-running the roster upserts.
