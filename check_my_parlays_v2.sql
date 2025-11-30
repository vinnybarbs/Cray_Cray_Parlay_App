-- Universal query that works with either table structure
-- First check: Using ai_suggestions (if parlay_legs doesn't exist)

SELECT 
  p.id as parlay_id,
  p.created_at as locked_at,
  p.status,
  p.final_outcome,
  p.total_legs,
  COUNT(s.id) as suggestions_found,
  jsonb_pretty(jsonb_agg(
    jsonb_build_object(
      'suggestion_id', s.id,
      'pick', s.pick_text,
      'bet_type', s.bet_type,
      'game_date', s.game_date,
      'hours_since_game', ROUND(EXTRACT(EPOCH FROM (NOW() - s.game_date)) / 3600, 1),
      'actual_outcome', s.actual_outcome,
      'home_team', s.home_team,
      'away_team', s.away_team,
      'odds', s.odds
    ) ORDER BY s.game_date
  )) as picks_details
FROM parlays p
LEFT JOIN ai_suggestions s ON s.parlay_id = p.id
WHERE p.status = 'pending'
GROUP BY p.id, p.created_at, p.status, p.final_outcome, p.total_legs
ORDER BY p.created_at DESC;

-- Count summary
SELECT 
  COUNT(DISTINCT p.id) as total_pending_parlays,
  COUNT(s.id) as total_suggestions_for_pending_parlays,
  SUM(CASE WHEN s.game_date < NOW() - INTERVAL '4 hours' THEN 1 ELSE 0 END) as games_ready_to_settle,
  SUM(CASE WHEN s.actual_outcome IN ('won', 'lost', 'push') THEN 1 ELSE 0 END) as already_settled
FROM parlays p
LEFT JOIN ai_suggestions s ON s.parlay_id = p.id
WHERE p.status = 'pending';
