-- Surface edge-calculator's adjustments + standings factors in the fact sheet.
-- The calc writes both into game_analysis.edge_factors (jsonb). Today the fact
-- sheet only shows the top-level score/prob/edge. Exposing adjustments lets the
-- LLM (and humans debugging) see exactly which signals moved the score.
--
-- See PR #8 for the data plumbing; this follow-up is just surfacing.

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

  SELECT * INTO home_cs FROM public.current_standings
    WHERE sport = ga.sport AND team_name = ga.home_team LIMIT 1;
  SELECT * INTO away_cs FROM public.current_standings
    WHERE sport = ga.sport AND team_name = ga.away_team LIMIT 1;

  result := jsonb_build_object(
    'schema_version', 3,
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
      'movement', ga.edge_movement,
      -- edge_factors is the jsonb the calculator writes; includes adjustments[]
      -- (what moved the needle), factors{} (baseline signals), and confidence.
      -- Default to empty object so consumers don't have to null-check.
      'adjustments', COALESCE(ga.edge_factors->'adjustments', '[]'::jsonb),
      'factors', COALESCE(ga.edge_factors - 'adjustments', '{}'::jsonb)
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
  'Canonical fact sheet for a single matchup. schema_version 3 surfaces edge.adjustments '
  '(array of factors that moved the probability) and edge.factors (standings + records + '
  'home advantage + injury impact) from game_analysis.edge_factors. Edge calculator adds '
  'venue-split / streak / playoff-seed signals as of 2026-04-23.';
