-- add_last_updated_to_players.sql
-- Ensure players table has a last_updated timestamptz column used by upserts

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'players') THEN
    -- add column if missing
    EXECUTE 'ALTER TABLE players ADD COLUMN IF NOT EXISTS last_updated timestamptz';
    -- create an index to speed up queries ordering by last_updated
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_players_last_updated ON players(last_updated)';
  ELSE
    RAISE NOTICE 'Table players does not exist; skipping ALTER TABLE for players.';
  END IF;
END$$;

COMMIT;

-- Run this in the Supabase SQL editor before re-running roster upserts.
