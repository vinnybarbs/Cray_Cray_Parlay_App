-- NFL player props, shadow first (build_queue 6, owner 2026-09-11:
-- "where are we on at least starting to bring in nfl props shadow").
-- The data has been collecting since August: player_props (Odds API,
-- twice daily, 8 books) and nfl_player_game_stats (nflverse, the 2025
-- season plus the current one on Tuesdays). This adds the reader.
--
-- prop_reads is the shadow record: one row per (event, market, player)
-- priced by lib/services/prop-edge.js in the same order as every team
-- market (anchor at the devigged consensus, model off the player's own
-- game log, damp by dial and sample, band the pp). Nothing publishes:
-- no ai_suggestions row, no digest tile, no alert. The weekly review
-- judges the record against the same promotion bar as any shadow
-- sport. Every weight is a dial on the NFL_props board (directive 7).
CREATE TABLE IF NOT EXISTS public.prop_reads (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport text NOT NULL DEFAULT 'NFL',
  event_id text NOT NULL,
  commence_time timestamptz,
  home_team text,
  away_team text,
  season int,
  week int,
  market text NOT NULL,
  player_key text NOT NULL,
  player_name text,
  line numeric NOT NULL,
  side text NOT NULL,
  anchor_prob numeric,
  model_prob numeric,
  damped_prob numeric,
  model_mean numeric,
  model_sigma numeric,
  games_used int,
  confidence numeric,
  edge_pp numeric,
  tier text,
  books int,
  consensus_over_price int,
  consensus_under_price int,
  best_book text,
  best_line numeric,
  best_price int,
  dials jsonb,
  factors jsonb,
  status text NOT NULL DEFAULT 'shadow',
  actual_value numeric,
  actual_outcome text NOT NULL DEFAULT 'pending',
  graded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, market, player_key)
);
COMMENT ON TABLE public.prop_reads IS
  'Shadow record of NFL player prop reads (prop-edge.js). status shadow: nothing publishes. Graded by analyze-nfl-props?mode=grade against nfl_player_game_stats. Judged weekly like any shadow sport.';
CREATE INDEX IF NOT EXISTS idx_prop_reads_pending ON public.prop_reads (actual_outcome, commence_time);
CREATE INDEX IF NOT EXISTS idx_prop_reads_player ON public.prop_reads (player_key, season, week);
ALTER TABLE public.prop_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prop_reads_service ON public.prop_reads;
CREATE POLICY prop_reads_service ON public.prop_reads FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.prop_reads TO authenticated, service_role;
GRANT INSERT, UPDATE ON public.prop_reads TO service_role;

-- The NFL_props dial board. Code defaults in prop-edge.js mirror these.
INSERT INTO sport_dials (sport, dial, value) VALUES
  ('NFL_props', 'prop_claim_damp', 0.5),
  ('NFL_props', 'prop_recent_window', 5),
  ('NFL_props', 'prop_recent_weight', 0.5),
  ('NFL_props', 'prop_min_games', 5),
  ('NFL_props', 'prop_history_games', 17)
ON CONFLICT (sport, dial) DO NOTHING;

INSERT INTO model_weight_changes (sport, component, before, after, reason, source) VALUES
  ('NFL_props', 'prop_formula_seed', '{}'::jsonb,
   '{"prop_claim_damp": 0.5, "prop_recent_window": 5, "prop_recent_weight": 0.5, "prop_min_games": 5, "prop_history_games": 17, "sigma_floors": {"player_pass_yds": 45, "player_pass_tds": 0.8, "player_rush_yds": 22, "player_reception_yds": 20, "player_receptions": 1.5}}'::jsonb,
   'First seed of the props formula, shadow only. Anchor at the devigged consensus over price at the median book line; model is the player game log (recent 5 blended half with the last 17, own game to game sigma floored per market); half the disagreement, scaled by games over 5. Same shape as totals and spreads. Anytime TD not modeled in v1.',
   'claude-code');

-- Read 15 minutes behind each props sync (13:15 and 21:15 UTC); grade
-- daily at 11:00 UTC, an hour behind the Tuesday nflverse sync, cheap
-- and idempotent on the other days.
SELECT cron.schedule('analyze-nfl-props', '30 13,21 * * *', $$
  SELECT net.http_post(
    url := 'https://craycrayparlayapp-production.up.railway.app/cron/analyze-nfl-props?secret=' ||
      (SELECT substring(command FROM 'secret=([^&]+)') FROM cron.job WHERE jobname = 'pre-analyze-mlb' LIMIT 1),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) as request_id;
$$);
SELECT cron.schedule('grade-nfl-props', '0 11 * * *', $$
  SELECT net.http_post(
    url := 'https://craycrayparlayapp-production.up.railway.app/cron/analyze-nfl-props?mode=grade&secret=' ||
      (SELECT substring(command FROM 'secret=([^&]+)') FROM cron.job WHERE jobname = 'pre-analyze-mlb' LIMIT 1),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) as request_id;
$$);

UPDATE build_queue SET updated_at = now(),
  detail = detail || ' STARTED 2026-09-11: shadow reader shipped (lib/services/prop-edge.js, api/cron/analyze-nfl-props.js, prop_reads table, NFL_props dials, crons analyze-nfl-props and grade-nfl-props). Five over/under markets modeled; anytime TD not modeled. Remaining: first graded week lands Tuesday 09-15, weekly review judges the shadow record, cachePlayerStats no-op bug in sync-nfl-player-stats still outstanding (nflverse is the settlement truth so it does not block).'
WHERE id = 6;
