-- supabase/migrations/20260711110000_rls_lockdown.sql
--
-- RLS lockdown. Applied to production in two batches on 2026-07-11
-- (rls_lockdown_batch1_reference, rls_lockdown_batch2_pipeline); this file
-- is the combined record.
--
-- Why: the anon key ships in the frontend bundle, and 32 public tables had
-- RLS disabled — readable and writable by anyone who opened dev tools.
-- Worst cases: ai_instructions (the playbook that steers the AI) and
-- game_analysis (published edges) were both writable by strangers.
--
-- Approach: frontend inventory (2026-07-11) showed the browser only touches
-- parlays, parlay_legs, ai_suggestions, and mv_model_accuracy. Everything
-- else is backend-only, and the Express server, edge functions, and pg_cron
-- all run with roles that bypass RLS. So: enable RLS with NO policies on
-- the backend-only tables (deny anon/authenticated outright), fix the two
-- broken ai_suggestions policies, and tighten grants on the analytics
-- relations.
--
-- Rollback per table if ever needed:
--   ALTER TABLE public.<name> DISABLE ROW LEVEL SECURITY;

-- 1. Backend-only tables: RLS on, no policies.
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_stats_season ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_stats_season ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_stats_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standings_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_stats_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.injuries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_stats_detailed ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_game_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_season_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apisports_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unified_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_recent_form ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staging_player_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rankings_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_ats_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odds_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_job_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edge_calibration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closing_lines ENABLE ROW LEVEL SECURITY;

-- 2. ai_suggestions policy fixes. The old insert policy was CHECK (true),
-- letting anyone inject fake picks into the public track record. The old
-- update policy allowed updates on any NULL-user_id row, which is most of
-- the ledger. The only legitimate browser write is a signed-in user locking
-- their own picks (MainApp.jsx sets user_id = auth user).
DROP POLICY IF EXISTS ai_suggestions_insert ON public.ai_suggestions;
CREATE POLICY ai_suggestions_insert_own ON public.ai_suggestions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS ai_suggestions_update_own ON public.ai_suggestions;
CREATE POLICY ai_suggestions_update_own ON public.ai_suggestions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- 3. Grant tightening. Landing reads stats via /api/public-stats (service
-- role), so anon needs no direct MV access. ResultsPage reads the MV as
-- authenticated, which stays. Calibration and closing lines are backend-only.
REVOKE SELECT ON public.mv_model_accuracy FROM anon;
REVOKE SELECT ON public.edge_calibration FROM anon, authenticated;
REVOKE SELECT ON public.closing_lines FROM anon, authenticated;
REVOKE SELECT ON public.v_pick_clv FROM anon, authenticated;

-- Verified post-apply (2026-07-11): anon sees 0 rows in locked tables and
-- cannot insert into ai_suggestions; authenticated cannot update NULL-user
-- ledger rows; mv readable by authenticated, not anon; /api/public-stats,
-- /api/public-ticker, /api/public-pod all 200 with data.
