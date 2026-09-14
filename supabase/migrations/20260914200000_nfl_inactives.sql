-- NFL availability the line prices earlier and later than the Friday
-- designation list (build_queue 11, owner 2026-09-14 "do it", after the
-- finding that news never touches the edge and the ESPN status list is
-- Friday's designation the market priced Friday night).
--
-- Earlier: the official practice report and the depth chart, from the
-- nflverse releases, into two tables. Stored inputs for the narration
-- context now and for a replayable practice participation factor after
-- the dial freeze (directive 21). Nothing here changes a published edge.
--
-- Later: watch-nfl-inactives reads ESPN's per game injuries block near
-- kickoff, diffs it against edge_factors.injuryReport (the lines the
-- read was priced on) and on a new Out marks the analysis stale so the
-- existing formula re-reads the game. No new rail, no weight, no label
-- swap (directive 16).

CREATE TABLE IF NOT EXISTS public.nfl_injury_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season int NOT NULL,
  week int NOT NULL,
  season_type text NOT NULL DEFAULT 'REG',
  team text NOT NULL,
  gsis_id text,
  player_key text NOT NULL,
  full_name text NOT NULL,
  position text,
  report_status text,
  report_injury text,
  practice_status text,
  practice_injury text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season, week, team, player_key)
);
COMMENT ON TABLE public.nfl_injury_reports IS
  'Official NFL practice and game status report per player per week (nflverse injuries release, sync-nfl-injuries every 6 hours). report_status is the Friday designation (Out, Doubtful, Questionable, null for none); practice_status is the last practice participation (Full, Limited, Did Not Participate). Narration context and replay input only; the injury factor math reads the ESPN status list.';
CREATE INDEX IF NOT EXISTS idx_nfl_injury_reports_week_team ON public.nfl_injury_reports (season, week, team);
ALTER TABLE public.nfl_injury_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nfl_injury_reports_service ON public.nfl_injury_reports;
CREATE POLICY nfl_injury_reports_service ON public.nfl_injury_reports FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.nfl_injury_reports TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.nfl_injury_reports TO service_role;

CREATE TABLE IF NOT EXISTS public.nfl_depth_charts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team text NOT NULL,
  pos_grp text NOT NULL,
  pos_name text,
  pos_abb text NOT NULL,
  pos_slot int NOT NULL DEFAULT 0,
  pos_rank int NOT NULL DEFAULT 0,
  player_name text NOT NULL,
  espn_id text,
  gsis_id text,
  snapshot_at timestamptz NOT NULL,
  UNIQUE (team, pos_grp, pos_abb, pos_slot, pos_rank)
);
COMMENT ON TABLE public.nfl_depth_charts IS
  'Each club''s newest depth chart snapshot (nflverse depth_charts release, sync-nfl-injuries every 6 hours). pos_rank 1 is the starter for that slot. Who steps in when a player is Out; replay input for a practice participation factor after the freeze.';
CREATE INDEX IF NOT EXISTS idx_nfl_depth_charts_team ON public.nfl_depth_charts (team, pos_abb, pos_rank);
ALTER TABLE public.nfl_depth_charts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nfl_depth_charts_service ON public.nfl_depth_charts;
CREATE POLICY nfl_depth_charts_service ON public.nfl_depth_charts FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.nfl_depth_charts TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.nfl_depth_charts TO service_role;

-- Every 6 hours, 15 past: nflverse refreshes the injuries release after
-- each team files (Wednesday to Friday afternoons ET) and the depth
-- charts on its own automation. Cheap: a 20KB and a 50MB download.
SELECT cron.schedule('sync-nfl-injuries', '15 */6 * * *', $$
  SELECT net.http_post(
    url := 'https://craycrayparlayapp-production.up.railway.app/cron/sync-nfl-injuries?secret=' ||
      (SELECT substring(command FROM 'secret=([^&]+)') FROM cron.job WHERE jobname = 'pre-analyze-mlb' LIMIT 1),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) as request_id;
$$);

-- Every 15 minutes: exits on one cheap query when no NFL pick starts
-- inside 3 hours, and logs every run so silence is never health.
SELECT cron.schedule('watch-nfl-inactives', '*/15 * * * *', $$
  SELECT net.http_post(
    url := 'https://craycrayparlayapp-production.up.railway.app/cron/watch-nfl-inactives?secret=' ||
      (SELECT substring(command FROM 'secret=([^&]+)') FROM cron.job WHERE jobname = 'pre-analyze-mlb' LIMIT 1),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 120000
  ) as request_id;
$$);

-- The build queue: 11 started, 3 closed (its review ran 2026-09-14),
-- and the three follow-ups this work surfaced.
UPDATE build_queue SET status = 'in_progress', updated_at = now(),
  detail = detail || ' STARTED 2026-09-14 (PR nfl inactives): news never touched the edge (RSS headlines fed five prompt lines only), the ESPN intelligence cron skipped football (news_cache NFL injuries dated 2025-11-26), and the injuries table was dead since 07-12. Shipped: sync-nfl-injuries (nflverse official practice report into nfl_injury_reports and depth charts into nfl_depth_charts, every 6 hours), watch-nfl-inactives (ESPN game summary injuries block diffed against edge_factors.injuryReport every 15 minutes inside 3 hours of kickoff, a new Out marks the analysis stale and re-runs the NFL slate through the existing formula), football added to fetch-espn-intelligence with Active lines dropped and a cron_job_logs row, and the practice report as NFL narration context. The edge math is unchanged (directive 21). REMAINING: the practice participation factor itself, replayed through the three test counterfactual once the freeze lifts 2026-09-27 and the table holds three weeks (build_queue 35).'
WHERE id = 11;

UPDATE build_queue SET status = 'done', updated_at = now(),
  detail = detail || ' DONE 2026-09-14: the calibration review ran section 3e on the Monday, judged the rubric era, dismissed sweep candidate 34, and named the NFL data gap (build_queue 11).'
WHERE id = 3;

INSERT INTO build_queue (priority, status, title, detail) VALUES
  ('high', 'open', 'Practice participation factor (NFL): three test counterfactual after the freeze',
   'nfl_injury_reports now stores Wednesday to Friday participation (Full, Limited, DNP) and the Friday designation per player, and nfl_depth_charts says who steps in. Candidate factor for the anchored NFL read: a starter (depth rank 1) who did not practice Wednesday and Thursday carries an absence probability the Friday list has not priced yet; the replay harness needs the as-of report (rows are keyed by season and week, so the week is the as-of) and the depth chart rank. Directive 19 first: the market prices the Friday designation, so the factor may only carry the practice trend BEFORE the designation posts and must zero once it does. Directive 21: nothing moves until 2026-09-27 and the three tests pass on three weeks of rows. Weight is a dial (injury_practice_weight) with a model_weight_changes row, never a constant.'),
  ('medium', 'open', 'News enrichment cost decision: enrich-articles and summarize-news feed prose only',
   'Owner 2026-09-14: "this is a crazy waste". The RSS ingester pulls 43 feeds every 2 hours (1317 articles in 7 days), enrich-articles calls the utility model every 4 hours on 10 articles a run and logs no cost row, and summarize-news is wired but unscheduled. None of it reaches the edge: five headline lines go into the narration prompt. Owner decision: (a) stop enrich-articles and keep raw headlines for the prompt, (b) keep it, or (c) replace the NFL RSS lines with the ESPN news API (structured, tagged to teams and athletes, free) and drop the rest. The cost audit should size (a) first.'),
  ('low', 'open', 'Sleeper NFL player feed as a second availability source',
   'api.sleeper.app/v1/players/nfl is free with no key: 12227 players, 826 with an injury status on 2026-09-14, body part, notes, depth chart order and a news_updated timestamp. Sleeper asks for one full pull a day. Worth a daily snapshot next to nfl_injury_reports once the practice participation factor (build_queue 35) has a replay to judge it against.');
