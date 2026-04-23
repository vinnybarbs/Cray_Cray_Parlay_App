-- Extend standings + current_standings with the richness ESPN already returns
-- but the sync was throwing away: last_10, home_record, away_record, playoff_seed.
-- Also add a sport-aware `record` column on the view (sourced from ESPN metadata
-- via team_latest_record) so consumers stop reconstructing W-L-T incorrectly for
-- soccer (EPL/MLS use W-D-L ordering, not W-L-D).
--
-- See PR #8 for the diagnostic that motivated this.

-- ============================================================================
-- 1. Extend standings with columns ESPN already returns
-- ============================================================================

ALTER TABLE public.standings
  ADD COLUMN IF NOT EXISTS last_10      TEXT,
  ADD COLUMN IF NOT EXISTS home_record  TEXT,
  ADD COLUMN IF NOT EXISTS away_record  TEXT,
  ADD COLUMN IF NOT EXISTS playoff_seed INT;

COMMENT ON COLUMN public.standings.last_10      IS 'ESPN "Last Ten Games" display — e.g. "7-2-1, 0 PTS" (NHL) or "6-4" (NBA).';
COMMENT ON COLUMN public.standings.home_record  IS 'ESPN home-record display — e.g. "29-10-2" (NHL) or "29-12" (NBA).';
COMMENT ON COLUMN public.standings.away_record  IS 'ESPN road-record display — e.g. "24-12-5".';
COMMENT ON COLUMN public.standings.playoff_seed IS 'ESPN current playoff seed (1-8 in most leagues; NULL for non-playoff teams or pre-playoffs).';

-- ============================================================================
-- 2. Rebuild current_standings to expose new fields + the proper `record` string
--    (CREATE OR REPLACE requires same leading columns + same types; new ones
--    append at the end.)
-- ============================================================================

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
  -- New columns (append only — keeps CREATE OR REPLACE happy)
  t.sport,
  s.last_10,
  s.home_record,
  s.away_record,
  s.playoff_seed,
  tlr.record_str AS record,
  tlr.as_of_date AS record_as_of
FROM public.standings s
  JOIN public.teams t ON t.id = s.team_id
  LEFT JOIN public.team_latest_record tlr
    ON tlr.sport = t.sport AND tlr.team_name = t.name
WHERE s.season::numeric = EXTRACT(year FROM CURRENT_DATE)
ORDER BY s.conference, s.division, (rank() OVER (PARTITION BY s.conference, s.division ORDER BY s.wins DESC, s.point_differential DESC));

COMMENT ON VIEW public.current_standings IS
  'Team records + stats for the current season. `record` column is ESPN-authoritative '
  '(sport-correct W-L-T, W-L-OT, or W-D-L) joined from team_latest_record. `wins`/`losses`/`ties` '
  'are raw integer stats. `last_10`, `home_record`, `away_record`, `playoff_seed` added 2026-04-23.';

-- ============================================================================
-- 3. Extend build_game_fact_sheet to surface the new richness
-- ============================================================================

CREATE OR REPLACE FUNCTION public.build_game_fact_sheet(p_game_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  ga RECORD;
  home_cs RECORD;
  away_cs RECORD;
  result JSONB;
BEGIN
  SELECT *
    INTO ga
    FROM public.game_analysis
   WHERE game_key = p_game_key
     AND stale = FALSE
   ORDER BY generated_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Pull the full current_standings row per side (has record + streak + last_10 + splits + seed)
  SELECT * INTO home_cs FROM public.current_standings
    WHERE sport = ga.sport AND team_name = ga.home_team LIMIT 1;
  SELECT * INTO away_cs FROM public.current_standings
    WHERE sport = ga.sport AND team_name = ga.away_team LIMIT 1;

  result := jsonb_build_object(
    'schema_version', 2,
    'built_at', NOW(),
    'game_key', ga.game_key,

    'matchup', jsonb_build_object(
      'sport', ga.sport,
      'home', ga.home_team,
      'away', ga.away_team,
      'game_date', ga.game_date
    ),

    'market', jsonb_build_object(
      'spread_line', ga.spread,
      'total_line', ga.total,
      'moneyline_home', ga.moneyline_home,
      'moneyline_away', ga.moneyline_away
    ),

    'records', jsonb_build_object(
      'home', jsonb_build_object(
        'season_record', COALESCE(home_cs.record, ga.home_record),
        'ranking', ga.home_ranking,
        'streak', home_cs.streak,
        'last_10', home_cs.last_10,
        'home_record', home_cs.home_record,
        'away_record', home_cs.away_record,
        'playoff_seed', home_cs.playoff_seed,
        'source', CASE WHEN home_cs.record IS NOT NULL THEN 'espn' ELSE 'standings_fallback' END,
        'as_of', home_cs.record_as_of
      ),
      'away', jsonb_build_object(
        'season_record', COALESCE(away_cs.record, ga.away_record),
        'ranking', ga.away_ranking,
        'streak', away_cs.streak,
        'last_10', away_cs.last_10,
        'home_record', away_cs.home_record,
        'away_record', away_cs.away_record,
        'playoff_seed', away_cs.playoff_seed,
        'source', CASE WHEN away_cs.record IS NOT NULL THEN 'espn' ELSE 'standings_fallback' END,
        'as_of', away_cs.record_as_of
      )
    ),

    'edge', jsonb_build_object(
      'score', ga.edge_score,
      'recommended_pick', ga.recommended_pick,
      'recommended_side', ga.recommended_side,
      'calc_home_prob', ga.calc_home_prob,
      'calc_away_prob', ga.calc_away_prob,
      'edge_pct', ga.calc_edge,
      'edge_side', ga.calc_edge_side,
      'movement', ga.edge_movement
    ),

    'key_players', jsonb_build_object(
      '_todo', 'Join player_recent_form → rosters → teams to surface top 3 per side by avg_performance_score'
    ),
    'injuries', jsonb_build_object(
      '_todo', 'Structured from injuries table where linkable; fallback to news_cache parsed text for soccer/MMA'
    ),
    'market_edge', jsonb_build_object(
      '_todo', 'Best spread/total/ML across DK/FD/BetMGM/Caesars/BetRivers/Fanatics once PR #5 populates odds_cache'
    ),
    'narrative_hooks', jsonb_build_array()
  );

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.build_game_fact_sheet(TEXT) IS
  'Canonical fact sheet for a single matchup. Records sourced from ESPN via current_standings '
  '(sport-aware record string from team_latest_record + streak/last_10/home-away/playoff_seed from '
  'the sync-standings cron). schema_version 2 adds last_10, home_record, away_record, playoff_seed.';
