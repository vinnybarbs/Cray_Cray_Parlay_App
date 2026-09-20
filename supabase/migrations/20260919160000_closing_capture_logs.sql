-- Ops checks 09-16 to 09-19 read capture_closing_lines as starved (one
-- fire in nine writes rows). It is not: the function writes only for
-- games starting inside the next 90 minutes, so most 15 minute fires
-- have nothing to write by design, and every one of the 36 MLB games in
-- the three days to 09-19 has a closing row. What was missing is a log
-- row per fire (directive 14), so silence could not be told from a dead
-- job. Each fire now logs games_in_window and rows_written, completed
-- when there was nothing to capture or rows landed, partial only when
-- games sat inside the window and nothing was written.

CREATE OR REPLACE FUNCTION public.capture_closing_lines()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_games int := 0;
  v_rows int := 0;
  v_sports text;
BEGIN
  SELECT count(DISTINCT external_game_id), string_agg(DISTINCT sport, ',')
    INTO v_games, v_sports
  FROM public.odds_cache
  WHERE commence_time > now()
    AND commence_time <= now() + interval '90 minutes'
    AND market_type IN ('h2h', 'spreads', 'totals');

  INSERT INTO public.closing_lines
    (sport, external_game_id, commence_time, home_team, away_team,
     bookmaker, market_type, outcomes, captured_at)
  SELECT sport, external_game_id, commence_time, home_team, away_team,
         bookmaker, market_type, outcomes, now()
  FROM public.odds_cache
  WHERE commence_time > now()
    AND commence_time <= now() + interval '90 minutes'
    AND market_type IN ('h2h', 'spreads', 'totals')
  ON CONFLICT (external_game_id, market_type, bookmaker) DO UPDATE SET
    outcomes      = EXCLUDED.outcomes,
    commence_time = EXCLUDED.commence_time,
    captured_at   = EXCLUDED.captured_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.cron_job_logs (job_name, status, details)
  VALUES ('capture_closing_lines',
          CASE WHEN v_games > 0 AND v_rows = 0 THEN 'partial' ELSE 'completed' END,
          jsonb_build_object('games_in_window', v_games, 'rows_written', v_rows,
                             'sports', coalesce(v_sports, ''), 'window_minutes', 90)::text);
END;
$function$;

-- Directive 14: the capture is judged by rows written when games sat in
-- the window, and by its heartbeat otherwise.
UPDATE directives SET check_sql = check_sql ||
  ' union all select ''closing capture partial 24h'' where exists (select 1 from cron_job_logs where job_name = ''capture_closing_lines'' and status = ''partial'' and created_at > now() - interval ''24 hours'')' ||
  ' union all select ''closing capture silent 2h'' where not exists (select 1 from cron_job_logs where job_name = ''capture_closing_lines'' and created_at > now() - interval ''2 hours'')',
  updated_at = now()
WHERE id = 14 AND check_sql NOT LIKE '%closing capture partial 24h%';

UPDATE build_queue SET status = 'done', updated_at = now(),
  detail = detail || ' RESOLVED 2026-09-19: the capture was never starved. It writes only for games inside the next 90 minutes, so on a 15 minute schedule most fires have nothing to write; in the three days to 09-19 all 36 MLB games and all 22 moneyline picks had a closing row. Migration 20260919160000 makes every fire log games_in_window and rows_written to cron_job_logs (partial only when games sat in the window and nothing was written) and extends the directive 14 check, so the ops check reads the log instead of counting fires.'
WHERE id = 25;
