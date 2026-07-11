-- supabase/migrations/20260711113000_rls_lockdown_followups.sql
--
-- Follow-ups from the post-lockdown advisor sweep. The table lockdown
-- (20260711110000) closed direct access, but three side doors remained:
--
-- 1. Eight SECURITY DEFINER views in public read the now-locked tables with
--    owner privileges, so anyone querying the view would bypass RLS. Flip
--    them to security_invoker and drop anon/authenticated grants. The
--    backend reads them with the service role, which bypasses RLS anyway.
-- 2. Seven SECURITY DEFINER functions were executable by anon over
--    PostgREST RPC, including rosters_bulk_upsert (a write path) and the
--    new calibration/closing-line jobs (denial-of-budget if hammered).
--    pg_cron runs them as postgres, so revoking API roles changes nothing
--    for the schedules.
-- 3. Two tables in the archived_tables_20251114 schema had policies but RLS
--    off. Archived data, lock and forget.

-- 1. Views: invoker semantics + no API-role grants.
DO $$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'team_identity_view', 'ai_model_performance', 'learning_insights',
    'current_injuries_by_team', 'player_recent_performance',
    'api_sync_status', 'player_identity_view', 'current_standings',
    'v_pick_clv'
  ] LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v);
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', v);
  END LOOP;
END;
$$;

-- 2. Functions: API roles lose EXECUTE (covers every overload).
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'capture_closing_lines', 'refresh_edge_calibration',
        'ensure_pg_net_enabled', 'get_cron_errors', 'get_cron_health',
        'process_staging_player_row', 'rosters_bulk_upsert'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
  END LOOP;
END;
$$;

-- 3. Archived schema stragglers.
ALTER TABLE archived_tables_20251114.cron_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE archived_tables_20251114.game_research_cache ENABLE ROW LEVEL SECURITY;
