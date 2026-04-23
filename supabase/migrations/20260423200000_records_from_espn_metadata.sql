-- Source team records directly from ESPN's metadata stamp on game_results,
-- instead of the `standings` table. Diagnostic showed standings is broken for
-- NHL (100% OT column missing), EPL/MLS (0% matching), NCAAB (0% matching).
-- ESPN's `records[0].summary` is correct for every sport and every team that
-- has played a game — we already capture it at ingest but weren't using it.
--
-- Display formats pass through as-is (no parsing):
--   NBA/MLB: "50-32"
--   NHL:     "55-16-11"  (W-L-OT)
--   EPL/MLS: "17-7-5"    (W-D-L)
--
-- Teams with no games in window render as NULL → tile suppresses record field
-- (honest absence beats a wrong number).

-- ============================================================================
-- 1. team_latest_record — canonical "what's this team's record RIGHT NOW"
--    One row per (sport, team_name) with ESPN-authoritative record string.
-- ============================================================================

CREATE OR REPLACE VIEW public.team_latest_record AS
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

COMMENT ON VIEW public.team_latest_record IS
  'Authoritative team record sourced from ESPN metadata on most-recent game_results row. '
  'Replaces current_standings for tile rendering — standings sync is broken for NHL/EPL/MLS/NCAAB. '
  'Pass record_str through unchanged; format varies by sport (W-L, W-L-OT, W-D-L).';

GRANT SELECT ON public.team_latest_record TO anon, authenticated, service_role;

-- ============================================================================
-- 2. build_game_fact_sheet — prefer ESPN-metadata record, fall back to
--    game_analysis.home_record only if the team has zero game_results rows
--    (e.g. NFL/NCAAF in off-season).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.build_game_fact_sheet(p_game_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  ga RECORD;
  home_rec TEXT;
  away_rec TEXT;
  home_rec_date DATE;
  away_rec_date DATE;
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

  -- ESPN-sourced records (authoritative).
  SELECT record_str, as_of_date INTO home_rec, home_rec_date
    FROM public.team_latest_record
   WHERE sport = ga.sport AND team_name = ga.home_team;

  SELECT record_str, as_of_date INTO away_rec, away_rec_date
    FROM public.team_latest_record
   WHERE sport = ga.sport AND team_name = ga.away_team;

  result := jsonb_build_object(
    'schema_version', 1,
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

    -- Records — prefer ESPN metadata; fall back to game_analysis column only
    -- if ESPN has no record for that team (off-season sports).
    'records', jsonb_build_object(
      'home', jsonb_build_object(
        'season_record', COALESCE(home_rec, ga.home_record),
        'ranking', ga.home_ranking,
        'source', CASE WHEN home_rec IS NOT NULL THEN 'espn' ELSE 'standings_fallback' END,
        'as_of', home_rec_date
      ),
      'away', jsonb_build_object(
        'season_record', COALESCE(away_rec, ga.away_record),
        'ranking', ga.away_ranking,
        'source', CASE WHEN away_rec IS NOT NULL THEN 'espn' ELSE 'standings_fallback' END,
        'as_of', away_rec_date
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
  'Canonical fact sheet for a single matchup. Records now sourced from ESPN metadata '
  '(team_latest_record view), not the stale standings table. See migration '
  '20260423200000 for diagnostic that motivated the swap.';
