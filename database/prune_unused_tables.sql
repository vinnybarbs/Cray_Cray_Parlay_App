-- prune_unused_tables.sql
-- Safely move non-essential public tables into a dated `archived_tables_YYYYMMDD` schema.
-- IMPORTANT: Review the `allowlist` below carefully before running. This script MOVES tables
-- to the archive schema (ALTER TABLE ... SET SCHEMA) but does not DROP anything.
-- Run in Supabase SQL editor after taking a backup/snapshot.

BEGIN;

-- Adjust date so migration can be re-used later
DO $$
  DECLARE
  archived_schema TEXT := format('archived_tables_%s', to_char(now(), 'YYYYMMDD'));
  r RECORD;
  allowlist TEXT[] := ARRAY[
    -- Minimal canonical objects you said you need (keep these in public)
    'teams', 'team_aliases', 'rosters', 'players', 'player_aliases',
    'team_stats', 'team_stats_cache', 'player_stats', 'player_stats_cache',
    'team_stats_season', 'player_stats_season',
    -- schedule / results to drive incremental updates
    'games', 'game_results', 'standings_cache',
    -- logging, API tracking, and critical caches
    'cron_job_logs', 'api_call_log', 'odds_cache',
    -- user/profile table (keep if used by app), and news tables you requested
    'profiles', 'articles', 'news_cache'
  ];
BEGIN
  -- Create the archive schema if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = archived_schema) THEN
    EXECUTE format('CREATE SCHEMA %I', archived_schema);
  END IF;

  -- Move every public table that is NOT in the allowlist into the archive schema
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> ALL (allowlist)
  LOOP
    RAISE NOTICE 'Archiving table: %', r.tablename;
    EXECUTE format('ALTER TABLE public.%I SET SCHEMA %I', r.tablename, archived_schema);
    -- Optional: add a comment so it's clear why this exists
    EXECUTE format('COMMENT ON TABLE %I.%I IS %L', archived_schema, r.tablename, 'archived by prune_unused_tables.sql on ' || now());
  END LOOP;
END$$;

COMMIT;

-- After running:
-- 1) Inspect archived schema: SELECT table_name FROM information_schema.tables WHERE table_schema = 'archived_tables_YYYYMMDD';
-- 2) If everything looks good, you can drop specific archived tables later or keep them as historical snapshots.
-- 3) If any essential table was moved accidentally, you can reverse with: ALTER TABLE archived_schema.table_name SET SCHEMA public;

-- NOTES:
-- - This script moves ALL public tables not in the allowlist. If your app has other essential tables (users, sessions, etc.) add them to the allowlist before running.
-- - Always run a full DB backup first. This script is reversible but moving many tables may temporarily disrupt app behavior until you update code or restore.
