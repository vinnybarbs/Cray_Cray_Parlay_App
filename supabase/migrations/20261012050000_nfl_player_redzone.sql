-- Red zone and goal line usage per player per game from nflverse play by
-- play (owner 2026-10-12: add red zone usage for anytime TD props).
-- Written by /cron/sync-nflverse-redzone, read by analyze-nfl-props.
CREATE TABLE IF NOT EXISTS public.nfl_player_redzone (
  game_id text NOT NULL,
  player_id text NOT NULL,
  season integer,
  week integer,
  season_type text,
  team text,
  rz_carries integer NOT NULL DEFAULT 0,
  gl_carries integer NOT NULL DEFAULT 0,
  rz_targets integer NOT NULL DEFAULT 0,
  ez_targets integer NOT NULL DEFAULT 0,
  rz_rush_tds integer NOT NULL DEFAULT 0,
  rz_rec_tds integer NOT NULL DEFAULT 0,
  team_rz_carries integer NOT NULL DEFAULT 0,
  team_rz_targets integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX IF NOT EXISTS nfl_player_redzone_player_idx ON public.nfl_player_redzone (player_id);
CREATE INDEX IF NOT EXISTS nfl_player_redzone_season_idx ON public.nfl_player_redzone (season, week);
ALTER TABLE public.nfl_player_redzone ENABLE ROW LEVEL SECURITY;
CREATE POLICY nfl_player_redzone_read ON public.nfl_player_redzone FOR SELECT USING (true);
GRANT SELECT ON public.nfl_player_redzone TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON public.nfl_player_redzone TO service_role;

-- Daily before the morning props read. The first run backfills 2025.
SELECT cron.schedule(
  'sync-nflverse-redzone',
  '45 9 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://craycrayparlayapp-production.up.railway.app/cron/sync-nflverse-redzone?secret=' ||
      (SELECT substring(command FROM 'secret=([^&]+)') FROM cron.job WHERE jobname = 'pre-analyze-mlb' LIMIT 1),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) as request_id;
  $cmd$
);
