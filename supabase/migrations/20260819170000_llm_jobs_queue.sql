-- Deferrable LLM work queue for the local-model worker (owner decision
-- 2026-08-19, cost). Railway enqueues jobs that do not need to happen
-- always-on (post-mortem learning analysis first, article enrichment and
-- news summaries later) instead of calling the metered API. A worker on
-- the owner's MacBook (scripts/local-llm-worker.mjs, Ollama) polls the
-- queue, runs a local model, and writes results back. The Mac being
-- asleep just means the queue waits; nothing user-facing blocks on it.

create table if not exists llm_jobs (
  id bigint generated always as identity primary key,
  kind text not null,
  payload jsonb not null,
  status text not null default 'queued',  -- queued | running | done | failed
  result jsonb,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_llm_jobs_status_created on llm_jobs (status, created_at);

grant select, insert, update on llm_jobs to service_role;
