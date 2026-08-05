-- UFC data plumbing, the tennis treatment for the octagon.
--
-- Every UFC analysis said "records and recent form are not available in
-- our data sources" because the app stored zero fighter data. Two tables,
-- fed by the sync-ufc-data cron from the same ESPN hosts settlement
-- already uses (espn-results.js resolveUfc):
--
--   ufc_fighters       one row per fighter, career record refreshed each run
--   ufc_fight_results  completed fights, upserted by event day
--
-- fighter_key / winner_key / loser_key reuse the diacritic-stripped
-- lowercase normalization from lib/services/tennis-data.js.

CREATE TABLE IF NOT EXISTS ufc_fighters (
  fighter_key  text PRIMARY KEY,
  fighter_name text NOT NULL,
  record       text,               -- "23-2-0" career record from ESPN
  espn_id      text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ufc_fight_results (
  id          bigserial PRIMARY KEY,
  event       text,
  fight_date  date NOT NULL,
  winner_name text NOT NULL,
  winner_key  text NOT NULL,
  loser_name  text NOT NULL,
  loser_key   text NOT NULL,
  source      text NOT NULL DEFAULT 'espn',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fight_date, winner_key, loser_key)
);

CREATE INDEX IF NOT EXISTS idx_ufc_results_winner ON ufc_fight_results (winner_key, fight_date DESC);
CREATE INDEX IF NOT EXISTS idx_ufc_results_loser  ON ufc_fight_results (loser_key, fight_date DESC);

-- Match the tennis tables: RLS on, service-role-only access.
ALTER TABLE ufc_fighters ENABLE ROW LEVEL SECURITY;
ALTER TABLE ufc_fight_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage ufc_fighters" ON ufc_fighters
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage ufc_fight_results" ON ufc_fight_results
  FOR ALL USING (auth.role() = 'service_role');

-- 20 minutes before pre-analyze-UFC (55 */4). Secret read from an
-- existing job rather than re-embedded.
SELECT cron.schedule(
  'sync-ufc-data',
  '35 */4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://craycrayparlayapp-production.up.railway.app/cron/sync-ufc-data?days=3&secret=' ||
           (SELECT substring(command FROM 'secret=([^&]+)') FROM cron.job WHERE jobname = 'pre-analyze-mlb' LIMIT 1),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) as request_id;
  $$
);
