-- supabase/migrations/20260711120000_standings_sync_2h.sql
--
-- Standings sync every 2 hours (was 6), offset to :30 so fresh standings
-- always land before the :45/:00-family pre-analyze runs. Standings are now
-- the model's W-L input and the public tile's "Season record", so a 6-hour
-- lag could show a record one game behind after afternoon slates.

DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'sync-standings';
  IF jid IS NOT NULL THEN
    PERFORM cron.alter_job(jid, schedule => '30 */2 * * *');
  END IF;
END;
$$;
