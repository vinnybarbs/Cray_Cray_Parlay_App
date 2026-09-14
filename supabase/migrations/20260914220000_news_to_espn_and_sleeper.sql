-- Owner 2026-09-14 on build_queue 36: "drop both and keep one structured
-- espn news call for the prompt", and on 37: "sleeper feed would be cool".
--
-- The RSS ingester (43 feeds every 2 hours, 1317 articles a week) and the
-- Claude enrichment pass (every 4 hours, 10 articles a run, cost never
-- logged) fed five headline lines of the narration prompt and nothing
-- else. Both stop here. The prompt, the digest fact sheet, the fact check
-- and golf now read ESPN's news API (lib/services/espn-news.js), which
-- tags every article to teams and athletes, with no model call. The
-- news_articles and news_sources tables stay as frozen history; nothing
-- drops them.

SELECT cron.unschedule('ingest-news-lite-2hr');
SELECT cron.unschedule('enrich-articles-4h');

-- Sleeper's NFL player feed, one pull a day (Sleeper's own request for
-- the full dump). Rostered players only. Stored input next to
-- nfl_injury_reports for the practice participation factor (build_queue
-- 35); nothing here changes a published edge.
CREATE TABLE IF NOT EXISTS public.nfl_player_status (
  sleeper_id text PRIMARY KEY,
  full_name text NOT NULL,
  team text NOT NULL,
  position text,
  status text,
  injury_status text,
  injury_body_part text,
  injury_notes text,
  injury_start_date text,
  practice_participation text,
  practice_description text,
  depth_chart_position text,
  depth_chart_order int,
  espn_id text,
  gsis_id text,
  news_updated timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.nfl_player_status IS
  'Daily snapshot of Sleeper''s NFL player feed (sync-sleeper-players, 06:30 MT): injury status, body part, notes, practice participation, depth chart position and order, and Sleeper''s news_updated instant. Rostered players only. Replay input for a practice participation factor; the injury factor math reads the ESPN status list.';
CREATE INDEX IF NOT EXISTS idx_nfl_player_status_team ON public.nfl_player_status (team, injury_status);
ALTER TABLE public.nfl_player_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nfl_player_status_service ON public.nfl_player_status;
CREATE POLICY nfl_player_status_service ON public.nfl_player_status FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.nfl_player_status TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.nfl_player_status TO service_role;

SELECT cron.schedule('sync-sleeper-players', '30 12 * * *', $$
  SELECT net.http_post(
    url := 'https://craycrayparlayapp-production.up.railway.app/cron/sync-sleeper-players?secret=' ||
      (SELECT substring(command FROM 'secret=([^&]+)') FROM cron.job WHERE jobname = 'pre-analyze-mlb' LIMIT 1),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) as request_id;
$$);

UPDATE build_queue SET status = 'done', updated_at = now(),
  detail = detail || ' DONE 2026-09-14, owner chose (c): ingest-news-lite-2hr and enrich-articles-4h unscheduled, the enrichment and summarizer code removed, and the narration prompt, digest fact sheet, fact check and golf notes read ESPN news tagged to the clubs (lib/services/espn-news.js, one cached call per sport per 30 minutes, no model call). news_articles is frozen history. The cost audit no longer has an unlogged enrichment line to estimate.'
WHERE id = 36;

UPDATE build_queue SET status = 'done', updated_at = now(),
  detail = detail || ' DONE 2026-09-14, owner: "sleeper feed would be cool". sync-sleeper-players runs daily at 06:30 MT into nfl_player_status (rostered players, about 2,700 rows, injury status and notes, practice participation, depth chart order, news_updated). Stored input only until build_queue 35 gives it a replay to be judged against.'
WHERE id = 37;
