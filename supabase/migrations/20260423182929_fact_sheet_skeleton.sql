-- FACT-SHEET SKELETON — the first concrete step of the "LLM as stylist, DB does
-- the analysis" architecture. See memory/project_llm_in_digest_tile.md.
--
-- What lands here:
--   1) ai_suggestions.pipeline_version column (4 = pre-fact-sheet, 5 = current)
--   2) build_game_fact_sheet(game_key) — returns canonical JSONB per matchup
--
-- What's intentionally STUB in this migration:
--   - key_players   (waits on player_recent_form integration)
--   - injuries      (waits on structured-injury design)
--   - market_edge   (waits on multi-book odds_cache coverage from PR #5)
--   - narrative_hooks (waits on rules design — streaks, H2H, line movement)
--
-- Those sections ship in follow-up migrations as we design each. The
-- consuming code (digest tile, chat, pre-analyze prompt) can already wire to
-- the existing sections today; the missing ones render as empty objects and
-- don't break anything.

-- ============================================================================
-- 1. pipeline_version column
--    Resets the success-rate scoreboard at fact-sheet launch. All existing
--    picks tagged as v4 ("legacy / noisy regime"). New picks written via the
--    fact-sheet-driven flow will set version 5. MV filters by version so the
--    public scoreboard shows a clean new start.
-- ============================================================================

ALTER TABLE public.ai_suggestions
  ADD COLUMN IF NOT EXISTS pipeline_version INT NOT NULL DEFAULT 4;

COMMENT ON COLUMN public.ai_suggestions.pipeline_version IS
  'Pipeline regime this pick was generated under. 4 = pre-fact-sheet (legacy). '
  '5 = fact-sheet-driven (current). Bump when architecture changes materially. '
  'MV aggregations filter by version to avoid mixing regimes.';

-- ============================================================================
-- 2. build_game_fact_sheet(p_game_key) — canonical per-matchup JSONB
-- ============================================================================

CREATE OR REPLACE FUNCTION public.build_game_fact_sheet(p_game_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  ga RECORD;
  result JSONB;
BEGIN
  -- Anchor on the most-recent non-stale game_analysis row. It already carries
  -- home/away, records (from current_standings via PR #3), odds lines, and
  -- edge-calc outputs, so this function is mostly assembly for now.
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

  result := jsonb_build_object(
    'schema_version', 1,
    'built_at', NOW(),
    'game_key', ga.game_key,

    -- Matchup — who's playing, when.
    'matchup', jsonb_build_object(
      'sport', ga.sport,
      'home', ga.home_team,
      'away', ga.away_team,
      'game_date', ga.game_date
    ),

    -- Market — the lines and prices as of last pre-analysis run.
    -- Note: today this reflects one book (DraftKings preferred, FanDuel fallback).
    -- Multi-book comparison lands when market_edge section is designed (PR #5 groundwork).
    'market', jsonb_build_object(
      'spread_line', ga.spread,
      'total_line', ga.total,
      'moneyline_home', ga.moneyline_home,
      'moneyline_away', ga.moneyline_away
    ),

    -- Records — real season W-L from current_standings, per PR #3.
    'records', jsonb_build_object(
      'home', jsonb_build_object(
        'season_record', ga.home_record,
        'ranking', ga.home_ranking
      ),
      'away', jsonb_build_object(
        'season_record', ga.away_record,
        'ranking', ga.away_ranking
      )
    ),

    -- Edge — what the calculator says about the matchup.
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

    -- STUB SECTIONS — populated in follow-up migrations.
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

GRANT EXECUTE ON FUNCTION public.build_game_fact_sheet(TEXT) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.build_game_fact_sheet(TEXT) IS
  'Canonical fact sheet for a single matchup. Returns JSONB with matchup, market, '
  'records, edge (populated) and key_players, injuries, market_edge, narrative_hooks '
  '(stub TODOs — expanded in follow-up migrations). Consumers pass game_key, get back '
  'a complete view of what the DB knows about this game. Replaces fragmented multi-query '
  'assembly in Node. See memory/project_llm_in_digest_tile.md.';
