-- Tennis data plumbing (phase 0 of docs/models/tennis-edge-model.md, trimmed).
--
-- Every tennis Deep Research card said "records not available from the data
-- sources provided" because the app stored ZERO tennis data: no rankings, no
-- results, no player rows (1,114 tennis game_analysis rows, 0 rows of player
-- context). The narration prompt for a tennis match carried only the odds.
--
-- Two tables, both fed by the sync-tennis-data cron from ESPN's public tennis
-- API (the same host espn-results.js already uses for settlement, so no new
-- dependency and no license issue):
--
--   tennis_rankings       one row per (tour, player), refreshed each run
--   tennis_match_results  completed singles matches, upserted by day
--
-- player_key / winner_key / loser_key are diacritic-stripped lowercase names
-- ("Fábián Marozsán" -> "fabian marozsan") so Odds API spellings join against
-- ESPN spellings. Normalization lives in lib/services/tennis-data.js.

CREATE TABLE IF NOT EXISTS tennis_rankings (
  tour        text NOT NULL CHECK (tour IN ('atp', 'wta')),
  player_key  text NOT NULL,
  player_name text NOT NULL,
  rank        integer NOT NULL,
  points      numeric,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tour, player_key)
);

CREATE TABLE IF NOT EXISTS tennis_match_results (
  id          bigserial PRIMARY KEY,
  tour        text NOT NULL CHECK (tour IN ('atp', 'wta')),
  tournament  text,
  round       text,
  match_date  date NOT NULL,
  winner_name text NOT NULL,
  winner_key  text NOT NULL,
  loser_name  text NOT NULL,
  loser_key   text NOT NULL,
  score       text,
  finish_type text NOT NULL DEFAULT 'completed',  -- completed | retired | walkover
  source      text NOT NULL DEFAULT 'espn',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tour, match_date, winner_key, loser_key)
);

CREATE INDEX IF NOT EXISTS idx_tennis_results_winner ON tennis_match_results (winner_key, match_date DESC);
CREATE INDEX IF NOT EXISTS idx_tennis_results_loser  ON tennis_match_results (loser_key, match_date DESC);
CREATE INDEX IF NOT EXISTS idx_tennis_results_date   ON tennis_match_results (match_date DESC);

-- Match game_results: RLS on, service-role-only access. The tennis tables
-- are written and read exclusively by the server (cron + pre-analysis).
ALTER TABLE tennis_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tennis_match_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage tennis_rankings" ON tennis_rankings
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage tennis_match_results" ON tennis_match_results
  FOR ALL USING (auth.role() = 'service_role');

-- Sync runs 20 minutes before pre-analyze-Tennis (25 */4) so the analysis
-- always reads fresh rankings and yesterday's results. Secret is read from an
-- existing job rather than re-embedded here.
SELECT cron.schedule(
  'sync-tennis-data',
  '5 */4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://craycrayparlayapp-production.up.railway.app/cron/sync-tennis-data?days=3&secret=' ||
           (SELECT substring(command FROM 'secret=([^&]+)') FROM cron.job WHERE jobname = 'pre-analyze-mlb' LIMIT 1),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) as request_id;
  $$
);
