-- restore_odds_cache_from_archive.sql
-- Safe helper to restore `odds_cache` if it was moved to an archived schema by prune_unused_tables.sql
-- Usage: run in Supabase SQL editor. This script will:
-- 1) If `public.odds_cache` already exists: do nothing
-- 2) If an archived schema (archived_tables_YYYYMMDD) contains `odds_cache`, move it back to public
-- 3) If no archived copy is found, create a minimal, empty `odds_cache` table as a safe fallback

BEGIN;

DO $$
DECLARE
  v_schema TEXT;
BEGIN
  -- 1) If table already in public, nothing to do
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'odds_cache') THEN
    RAISE NOTICE 'odds_cache already exists in public — nothing to do.';
    RETURN;
  END IF;

  -- 2) Try to find an archived schema containing odds_cache
  SELECT table_schema INTO v_schema
  FROM information_schema.tables
  WHERE table_name = 'odds_cache'
    AND table_schema LIKE 'archived_tables_%'
  LIMIT 1;

  IF v_schema IS NOT NULL THEN
    RAISE NOTICE 'Found archived odds_cache in schema % — moving back to public', v_schema;
    EXECUTE format('ALTER TABLE %I.%I SET SCHEMA public', v_schema, 'odds_cache');
    RAISE NOTICE 'Moved odds_cache back to public.';
  ELSE
    -- 3) No archived copy found — create a safe, minimal table so the app and cron can run.
    RAISE NOTICE 'No archived odds_cache found. Creating a minimal empty public.odds_cache table as a fallback.';
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'odds_cache') THEN
      EXECUTE $$
        CREATE TABLE public.odds_cache (
          id BIGSERIAL PRIMARY KEY,
          sport VARCHAR(50),
          market_type VARCHAR(64),
          event_id TEXT,
          commence_time_utc TIMESTAMPTZ,
          commence_time_mt TIMESTAMPTZ,
          last_updated TIMESTAMPTZ DEFAULT now(),
          provider_ids JSONB,
          raw_json JSONB
        );
      $$;
      RAISE NOTICE 'Created minimal public.odds_cache. Run your refresh cron to seed market data.';
    END IF;
  END IF;
END$$;

COMMIT;

-- After running:
-- 1) Verify with:
--    SELECT table_schema, table_name FROM information_schema.tables WHERE table_name = 'odds_cache';
-- 2) If step 2 moved the archived table back you will have all previous rows.
-- 3) If the fallback table was created, re-run your odds refresh cron/Edge Function to re-populate `odds_cache`.
-- 4) If you prefer to restore from a backup or want me to craft a copy-from-archived-to-public statement for a specific archive schema (e.g. archived_tables_20251114), tell me the schema name and I will prepare the exact ALTER statement.
