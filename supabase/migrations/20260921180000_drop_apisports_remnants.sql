-- Owner 2026-09-21: remove every API-Sports ghost. The provider was
-- decommissioned on 2026-07-12 (migration 20260712150000 unscheduled its
-- crons) but its table and id columns stayed behind. apisports_sync_log
-- holds 309 rows of sync history for a feed that no longer exists, and
-- teams.api_sports_id and players.api_sports_id are null on every row
-- (0 of 657 teams, 0 of 11,961 players), read by no view, function or
-- live code path. The api_sync_status view reads only that table and
-- has no dependents, so it goes first.

DROP VIEW IF EXISTS public.api_sync_status;
DROP TABLE IF EXISTS public.apisports_sync_log;
ALTER TABLE public.teams DROP COLUMN IF EXISTS api_sports_id;
ALTER TABLE public.players DROP COLUMN IF EXISTS api_sports_id;

INSERT INTO build_queue (priority, status, title, detail) VALUES
  ('medium', 'done', 'API-Sports ghost removed from the codebase and the database (owner 2026-09-21)',
   'Found by the weekly model review. Removed: the Railway cron in railway.toml that still ran scripts/populate-apisports.js daily, every populate and sync script for the provider (root and scripts), the seven decommissioned edge function folders (sync-apisports-daily, refresh-rosters, populate-teams, populate-team-stats, populate-player-props, refresh-injuries, sync-sports-stats), the API-Sports docs and archived plans, the legacy database schema files, the unused nfl-team-mapping and static-teams modules, the dead NFL stats branch in research-agent, and every comment naming the provider in live code. Database: api_sync_status view and apisports_sync_log dropped, teams.api_sports_id and players.api_sports_id dropped (all null). Versioned migrations that mention it stay as history. Still to do by hand: delete the seven deployed edge functions in the Supabase dashboard (the MCP has no delete) and remove APISPORTS_API_KEY and API_SPORTS_KEY from Railway if set.');
