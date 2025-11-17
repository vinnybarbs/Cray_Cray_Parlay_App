-- create_news_ingest_schema.sql
-- Create schema and tables to ingest RSS/News content and support semantic search via pgvector.
-- Run in Supabase SQL editor. If you use Supabase vector (pgvector) ensure the extension is enabled.

BEGIN;

-- 1) Enable pgvector/vector extension if available (cloud providers use different names).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    PERFORM (SELECT 'vector available');
    -- attempt to create the 'vector' extension if the platform supports it
    BEGIN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not create extension "vector": %', SQLERRM;
    END;
  ELSIF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pgvector') THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pgvector';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not create extension "pgvector": %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'pgvector/vector extension not available on this DB; embedding vector column/index will be skipped. Embeddings JSON will still be stored.';
  END IF;
END$$;

-- 2) Create a news_sources table to track feeds
CREATE TABLE IF NOT EXISTS news_sources (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  feed_url TEXT NOT NULL UNIQUE,
  last_fetched TIMESTAMP WITH TIME ZONE,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3) Create a news_articles table to store canonicalized articles
CREATE TABLE IF NOT EXISTS news_articles (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT REFERENCES news_sources(id) ON DELETE SET NULL,
  feed_url TEXT,
  dedupe_key TEXT, -- e.g., normalized URL or GUID
  title TEXT,
  link TEXT,
  published_at TIMESTAMP WITH TIME ZONE,
  fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  content TEXT,
  summary TEXT,
  raw_json JSONB,
  inserted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(source_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_news_articles_published_at ON news_articles(published_at);
CREATE INDEX IF NOT EXISTS idx_news_articles_dedupe_key ON news_articles(dedupe_key);

-- 4) Create a news_embeddings table to hold vector embeddings for semantic search
-- Requires pgvector extension. Use 'vector' column type and create ivfflat index if supported.
CREATE TABLE IF NOT EXISTS news_embeddings (
  id BIGSERIAL PRIMARY KEY,
  article_id BIGINT REFERENCES news_articles(id) ON DELETE CASCADE,
  model TEXT,
  embedding vector,
  embedding_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create a vector index if pgvector supports ivfflat on your DB size. This is optional but speeds up similarity queries.
DO $$
BEGIN
  -- Only create ivfflat index when a vector extension is installed (either 'vector' or 'pgvector')
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname IN ('vector','pgvector')) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE tablename = 'news_embeddings' AND indexname = 'idx_news_embeddings_vector'
    ) THEN
      BEGIN
        EXECUTE 'CREATE INDEX idx_news_embeddings_vector ON news_embeddings USING ivfflat (embedding vector_l2_ops) WITH (lists = 100)';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Could not create ivfflat index on news_embeddings.embedding: %', SQLERRM;
      END;
    END IF;
  ELSE
    RAISE NOTICE 'Skipping vector index creation because vector/pgvector extension is not installed.';
  END IF;
END$$;

COMMIT;

-- Usage notes:
-- 1) Insert feeds into `news_sources` with the feed URLs you provided.
-- 2) Build a small ingestion Edge Function that fetches each feed, parses items, computes a dedupe_key (normalized URL or GUID), and INSERTs into `news_articles` ON CONFLICT DO NOTHING.
-- 3) Optionally compute embeddings (OpenAI/other) and INSERT into `news_embeddings`.
-- 4) Use vector similarity queries to surface relevant headlines to the AI when generating picks.
