-- Reverse the source preference on current_standings.record column.
--
-- PR #8 wired `record` to pull from team_latest_record (ESPN metadata stamped
-- on game_results). That was the right call when standings was BROKEN (NHL
-- ties=0, soccer teams missing, etc). But:
--
--   * PR #8 also fixed sync-standings to capture per-sport stat keys correctly
--   * ESPN stamps PRE-game records on each game_results row, so the stamp is
--     ALWAYS 1 game lagged relative to a team's current W-L
--   * Standings table (synced every 6h from ESPN's standings page) is
--     POST-game — actually current
--
-- Real-world observation: Cubs played Apr 22 (7-2 W), their record entering
-- that game per ESPN metadata = "15-9", their actual record after = "16-9".
-- Standings shows 16-9. team_latest_record still returns 15-9. Every user-
-- facing tile was showing 15-9 — "1 game behind" the truth for every MLB team
-- that played yesterday.
--
-- Fix: build `record` sport-aware from standings.{wins,losses,ties}, fall
-- back to team_latest_record only when standings has no row for that team.

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
  -- Sport-aware record construction from fresh standings; fall back to
  -- team_latest_record (which itself is ESPN-stamped from game_results)
  -- only when standings has no wins data for this team.
  COALESCE(
    CASE
      WHEN s.wins IS NULL THEN NULL
      WHEN t.sport = 'NHL' THEN
        s.wins || '-' || s.losses || '-' || COALESCE(s.ties, 0)
      WHEN t.sport IN ('EPL', 'MLS') THEN
        -- Soccer displays as W-D-L. `ties` column stores draws.
        s.wins || '-' || COALESCE(s.ties, 0) || '-' || s.losses
      ELSE
        s.wins || '-' || s.losses
    END,
    tlr.record_str
  ) AS record,
  -- as_of reflects whichever source fed `record`: standings.updated_at for
  -- the standings-constructed path, TLR's as_of_date for the fallback path.
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

COMMENT ON VIEW public.current_standings IS
  'Team records + stats for the current season. As of 2026-04-24, `record` is '
  'constructed sport-aware from fresh standings (W-L for NBA/MLB/NFL/NCAAB, '
  'W-L-OT for NHL, W-D-L for EPL/MLS), falling back to team_latest_record '
  '(ESPN game_results metadata stamp, always 1 game lagged) only when standings '
  'has no row for a team.';
