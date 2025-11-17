-- add_player_name_to_players.sql
-- Add a player_name column to players and backfill from known fields (idempotent)

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'players') THEN
    -- add column if missing
    EXECUTE 'ALTER TABLE players ADD COLUMN IF NOT EXISTS player_name TEXT';

    -- backfill player_name from a few likely fields if currently null or empty
    -- Do this in safe conditional steps so we never reference columns that don't exist in the remote schema
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'players' AND column_name = 'name') THEN
      EXECUTE 'UPDATE players SET player_name = COALESCE(NULLIF(player_name, ''''), NULLIF(name::text, '''')) WHERE player_name IS NULL';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'players' AND column_name = 'espn_id') THEN
      EXECUTE 'UPDATE players SET player_name = COALESCE(NULLIF(player_name, ''''), NULLIF(espn_id::text, '''')) WHERE player_name IS NULL';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'players' AND column_name = 'raw_json') THEN
      EXECUTE 'UPDATE players SET player_name = COALESCE(NULLIF(player_name, ''''), NULLIF((raw_json->>''fullName'')::text, ''''), NULLIF((raw_json->>''displayName'')::text, '''')) WHERE player_name IS NULL';
    END IF;

    -- create an index to speed lookups
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_players_player_name ON players(player_name)';
  ELSE
    RAISE NOTICE 'Table players does not exist; skipping ALTER TABLE for players.';
  END IF;
END$$;

COMMIT;

-- Run this in the Supabase SQL editor (or via psql) before re-running roster upserts.
