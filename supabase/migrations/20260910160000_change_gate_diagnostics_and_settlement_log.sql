-- Two ops check findings from 2026-09-10, fifteenth report on the MLB
-- change gate and the run_settlement logging defects.
--
-- 1. The per input fingerprints in game_analysis.context_parts could not
-- name the churning input because the table keeps one row per game and
-- only the latest version's fingerprints survive. pre-analyze now diffs
-- the prior map against the new one at the one moment both exist (a
-- re-narration) and stores the keys that changed on the row, and the
-- run log tallies them per key, so the ops check reads the culprit
-- straight from cron_job_logs.
ALTER TABLE game_analysis ADD COLUMN IF NOT EXISTS context_changed_keys jsonb;
COMMENT ON COLUMN game_analysis.context_changed_keys IS
  'Context input keys whose fingerprint differed from the prior analysis version at re-narration. Null on first analysis. Written by pre-analyze-games.';

-- 2. run_settlement logged only when it settled something, so silence
-- could not be told from a dead job, and the statement level trigger on
-- game_results fires once per upsert statement, so a backfill batch of
-- five games wrote five rows inside a second. It now always logs, and
-- calls inside a 60 second window merge into one row with summed counts
-- and a calls counter.
CREATE OR REPLACE FUNCTION public.run_settlement()
 RETURNS TABLE(suggestions_settled integer, legs_settled integer, parlays_settled integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  s_count INT;
  l_count INT;
  p_count INT;
  v_id bigint;
  v_json jsonb;
BEGIN
  s_count := public.settle_ai_suggestions();
  l_count := public.settle_parlay_legs();
  p_count := public.settle_parlays();

  SELECT id, coalesce(details::jsonb, '{}'::jsonb) INTO v_id, v_json
    FROM public.cron_job_logs
   WHERE job_name = 'run_settlement' AND created_at > now() - interval '60 seconds'
   ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    UPDATE public.cron_job_logs SET details = jsonb_build_object(
      'suggestions_settled', coalesce((v_json->>'suggestions_settled')::int, 0) + s_count,
      'legs_settled', coalesce((v_json->>'legs_settled')::int, 0) + l_count,
      'parlays_settled', coalesce((v_json->>'parlays_settled')::int, 0) + p_count,
      'calls', coalesce((v_json->>'calls')::int, 1) + 1
    )::text
    WHERE id = v_id;
  ELSE
    INSERT INTO public.cron_job_logs (job_name, status, details)
    VALUES ('run_settlement', 'success', jsonb_build_object(
      'suggestions_settled', s_count,
      'legs_settled', l_count,
      'parlays_settled', p_count,
      'calls', 1
    )::text);
  END IF;

  RETURN QUERY SELECT s_count, l_count, p_count;
END;
$function$;
