-- Per-player per-game NFL stat lines, the settlement truth for player
-- props (owner request 2026-08-25: store last season's prop outcomes).
--
-- Source: nflverse weekly player stats releases (free, maintained,
-- one CSV per season). A player prop settles against exactly these
-- numbers: passing/rushing/receiving yards, receptions, TDs. The same
-- sync that backfills 2025 keeps the current season fresh in-season,
-- which is both the props grading path and the prop model's history.
CREATE TABLE IF NOT EXISTS public.nfl_player_game_stats (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season int NOT NULL,
  week int NOT NULL,
  season_type text NOT NULL,
  game_id text NOT NULL,
  player_id text NOT NULL,
  player_name text NOT NULL,
  player_key text NOT NULL,
  position text,
  team text,
  opponent text,
  completions int,
  attempts int,
  passing_yards numeric,
  passing_tds int,
  interceptions int,
  carries int,
  rushing_yards numeric,
  rushing_tds int,
  receptions int,
  targets int,
  receiving_yards numeric,
  receiving_tds int,
  source text NOT NULL DEFAULT 'nflverse',
  last_updated timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_nfl_pgs_player_key
  ON public.nfl_player_game_stats (player_key);
CREATE INDEX IF NOT EXISTS idx_nfl_pgs_season_week
  ON public.nfl_player_game_stats (season, week);

GRANT SELECT ON public.nfl_player_game_stats TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON public.nfl_player_game_stats TO service_role;
