-- Materialize team_latest_record so consumers stop re-running its DISTINCT ON
-- over every game_results row on every read.
--
-- Code reviewer flagged: pre-analyze (per game) + digest (per game) + edge-calc
-- (per team) collectively hit current_standings (which LEFT JOINs TLR) ~100×
-- per cycle. Each call re-scans game_results metadata to recompute the
-- DISTINCT ON. Materializing turns it into a simple index lookup.
--
-- Refresh cadence: 15 min via pg_cron. CONCURRENT refresh requires a unique
-- index on the rows. Backfill-game-results runs every 6h (4×/day), so 15 min
-- granularity easily covers any new game_results rows arriving between cron
-- fires and keeps the fallback record path responsive.
--
-- current_standings depends on TLR, so the swap order is:
--   1. DROP current_standings (cheap to recreate)
--   2. DROP existing TLR view
--   3. CREATE MATERIALIZED VIEW with same name + columns + grants
--   4. UNIQUE INDEX on (sport, team_name) for CONCURRENT refresh
--   5. Initial REFRESH MATERIALIZED VIEW
--   6. Recreate current_standings (verbatim definition from migration
--      20260424000000) — references resolve to the matview now
--   7. pg_cron job to REFRESH CONCURRENTLY every 15 min

DROP VIEW IF EXISTS public.current_standings;
DROP VIEW IF EXISTS public.team_latest_record;

CREATE MATERIALIZED VIEW public.team_latest_record AS
WITH unified AS (
  SELECT sport, home_team_name AS team_name,
         metadata->>'home_record' AS record_str,
         date
  FROM public.game_results
  WHERE metadata->>'home_record' IS NOT NULL
  UNION ALL
  SELECT sport, away_team_name AS team_name,
         metadata->>'away_record' AS record_str,
         date
  FROM public.game_results
  WHERE metadata->>'away_record' IS NOT NULL
)
SELECT DISTINCT ON (sport, team_name)
  sport, team_name, record_str, date AS as_of_date
FROM unified
ORDER BY sport, team_name, date DESC;

COMMENT ON MATERIALIZED VIEW public.team_latest_record IS
  'Materialized 2026-04-28: ESPN-stamped record per (sport, team_name) from '
  'most-recent game_results row. Refreshed CONCURRENTLY every 15 min by pg_cron '
  'job refresh_team_latest_record. Used as fallback by current_standings.record '
  'when standings has no row for a team (off-season sports).';

CREATE UNIQUE INDEX team_latest_record_pk
  ON public.team_latest_record (sport, team_name);

REFRESH MATERIALIZED VIEW public.team_latest_record;

GRANT SELECT ON public.team_latest_record TO anon, authenticated, service_role;

-- Recreate current_standings (verbatim from 20260424000000) — the join target
-- is now the matview, so reads are an index lookup not a recompute.
CREATE OR REPLACE VIEW public.current_standings AS
SELECT
  t.name AS team_name,
  s.conference,
  s.division,
  s.wins,
  s.losses,
  s.ties,
  round(s.wins::numeric / NULLIF(s.wins + s.losses + s.ties, 0)::numeric, 3) AS win_percentage,
  s.point_differential,
  s.streak,
  rank() OVER (PARTITION BY s.conference, s.division ORDER BY s.wins DESC, s.point_differential DESC) AS division_rank,
  t.sport,
  s.last_10,
  s.home_record,
  s.away_record,
  s.playoff_seed,
  COALESCE(
    CASE
      WHEN s.wins IS NULL THEN NULL
      WHEN t.sport = 'NHL' THEN
        s.wins || '-' || s.losses || '-' || COALESCE(s.ties, 0)
      WHEN t.sport IN ('EPL', 'MLS') THEN
        s.wins || '-' || COALESCE(s.ties, 0) || '-' || s.losses
      ELSE
        s.wins || '-' || s.losses
    END,
    tlr.record_str
  ) AS record,
  CASE
    WHEN s.wins IS NOT NULL THEN s.updated_at::date
    ELSE tlr.as_of_date
  END AS record_as_of
FROM public.standings s
  JOIN public.teams t ON t.id = s.team_id
  LEFT JOIN public.team_latest_record tlr
    ON tlr.sport = t.sport AND tlr.team_name = t.name
WHERE s.season::numeric = EXTRACT(year FROM CURRENT_DATE)
ORDER BY s.conference, s.division, (rank() OVER (PARTITION BY s.conference, s.division ORDER BY s.wins DESC, s.point_differential DESC));

-- Schedule the refresh
SELECT cron.schedule(
  'refresh_team_latest_record',
  '*/15 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.team_latest_record;$$
);
