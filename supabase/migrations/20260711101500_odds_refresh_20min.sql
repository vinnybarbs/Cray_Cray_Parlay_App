-- supabase/migrations/20260711101500_odds_refresh_20min.sql
--
-- Odds refresh cadence: hourly to every 20 minutes. API budget allows it.
-- This tightens closing-line precision (closing_lines snapshots capture the
-- freshest odds_cache row before first pitch, so the captured close is now
-- at most ~20 minutes stale instead of ~60), and the digest reprices from
-- fresher lines all day. Job keeps its historical name to avoid breaking
-- anything that references it.

DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'refresh-odds-hourly';
  IF jid IS NOT NULL THEN
    PERFORM cron.alter_job(jid, schedule => '*/20 * * * *');
  END IF;
END;
$$;
