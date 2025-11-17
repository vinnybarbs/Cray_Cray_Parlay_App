-- ensure_odds_cache_table.sql
-- Safe idempotent script to ensure `public.odds_cache` exists with expected schema, indexes, and service_role policy.
-- Behavior:
-- 1) If `public.odds_cache` exists -> no-op (will still ensure indexes and policy exist)
-- 2) If an archived schema like archived_tables_YYYYMMDD contains odds_cache -> move it back to public
-- 3) If not found anywhere -> create the table with the canonical schema and indexes
-- 4) Ensure a service_role RLS policy exists so Edge Functions can write

BEGIN;

DO $$
DECLARE
  v_schema TEXT;
BEGIN
  -- If odds_cache already exists in public, skip creation but continue to ensure indexes/policies
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'odds_cache') THEN
    RAISE NOTICE 'odds_cache exists in public. Will ensure indexes and policies.';
  ELSE
    -- Try to find an archived copy
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
      RAISE NOTICE 'No archived odds_cache found. Creating public.odds_cache with canonical schema.';
      EXECUTE $$
        CREATE TABLE public.odds_cache (
          id uuid primary key default gen_random_uuid(),
          sport varchar(20) not null,
          game_id uuid references games(id) on delete cascade,
          external_game_id varchar(100),
          commence_time timestamptz,
          home_team varchar(100) not null,
          away_team varchar(100) not null,
          bookmaker varchar(50) not null,
          market_type varchar(50) not null,
          outcomes jsonb not null,
          last_updated timestamptz default now(),
          unique (external_game_id, bookmaker, market_type)
        );
      $$;
      RAISE NOTICE 'Created public.odds_cache.';
    END IF;
  END IF;
END$$;

-- Ensure indexes
CREATE INDEX IF NOT EXISTS idx_odds_cache_game ON public.odds_cache(game_id);
CREATE INDEX IF NOT EXISTS idx_odds_cache_external ON public.odds_cache(external_game_id);
CREATE INDEX IF NOT EXISTS idx_odds_cache_commence ON public.odds_cache(commence_time);
CREATE INDEX IF NOT EXISTS idx_odds_cache_updated ON public.odds_cache(last_updated);
CREATE INDEX IF NOT EXISTS idx_odds_cache_teams ON public.odds_cache(home_team, away_team);

-- Ensure service_role policy exists (safe: only create if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'odds_cache') THEN
    -- create policy if not exists
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'odds_cache' AND policyname = 'Service role can manage odds_cache') THEN
      EXECUTE 'CREATE POLICY "Service role can manage odds_cache" ON public.odds_cache FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
  END IF;
END$$;

COMMIT;

-- After running:
-- 1) Verify table exists: SELECT table_schema, table_name FROM information_schema.tables WHERE table_name = 'odds_cache';
-- 2) If created as fallback, run your odds refresh (Edge Function `refresh-odds`) to seed data.
-- 3) If you want me to also re-create any dependent views (odds_cache_mt) or re-run timezone setup, say so and I'll add it.
