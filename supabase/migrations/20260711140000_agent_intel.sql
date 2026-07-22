-- supabase/migrations/20260711140000_agent_intel.sql
--
-- Storage + schedule for the data-integrity agent (Claude coordinator with
-- web-search sub-agents: records verifier, injury scout, weather scout).
-- Motivated by the July 2026 records incident. Nothing cross-checked the
-- data the site displayed, and injuries/weather coverage was thin.

CREATE TABLE IF NOT EXISTS public.agent_intel (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id     text NOT NULL,          -- ISO timestamp of the sweep
  kind       text NOT NULL,          -- record_mismatch | record_check_summary | injury | weather | agent_error
  severity   text NOT NULL DEFAULT 'info',  -- info | high
  game_key   text,
  team       text,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_intel_created ON public.agent_intel (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_intel_team ON public.agent_intel (team) WHERE team IS NOT NULL;

-- Backend-only, same posture as the rest of the lockdown.
ALTER TABLE public.agent_intel ENABLE ROW LEVEL SECURITY;

-- Two sweeps daily: 10:00 UTC (4am MT, before the morning digest builds) and
-- 17:00 UTC (11am MT, ahead of the afternoon/evening slate). Costs are
-- bounded per run (max 14 games, capped web searches per sub-agent).
SELECT cron.schedule(
  'data_integrity_morning',
  '0 10 * * *',
  $$SELECT net.http_post(
      url := 'https://craycrayparlayapp-production.up.railway.app/cron/data-integrity?secret=' ||
             (SELECT substring(command FROM 'secret=([^&]+)') FROM cron.job WHERE jobname = 'pre-analyze-mlb' LIMIT 1),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb, timeout_milliseconds := 3000);$$
);

SELECT cron.schedule(
  'data_integrity_midday',
  '0 17 * * *',
  $$SELECT net.http_post(
      url := 'https://craycrayparlayapp-production.up.railway.app/cron/data-integrity?secret=' ||
             (SELECT substring(command FROM 'secret=([^&]+)') FROM cron.job WHERE jobname = 'pre-analyze-mlb' LIMIT 1),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb, timeout_milliseconds := 3000);$$
);
