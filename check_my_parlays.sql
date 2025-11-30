-- Check your pending parlays and their legs
SELECT 
  p.id as parlay_id,
  p.created_at as locked_at,
  p.status,
  p.final_outcome,
  jsonb_pretty(jsonb_agg(
    jsonb_build_object(
      'leg_id', pl.id,
      'team', pl.pick,
      'bet_type', pl.bet_type,
      'game_date', pl.game_date,
      'hours_since_game', ROUND(EXTRACT(EPOCH FROM (NOW() - pl.game_date)) / 3600, 1),
      'game_completed', pl.game_completed,
      'leg_result', pl.leg_result,
      'home_team', pl.home_team,
      'away_team', pl.away_team,
      'bet_details', pl.bet_details
    ) ORDER BY pl.game_date
  )) as legs_details
FROM parlays p
JOIN parlay_legs pl ON pl.parlay_id = p.id
WHERE p.status = 'pending'
GROUP BY p.id, p.created_at, p.status, p.final_outcome
ORDER BY p.created_at DESC;

-- Count of games that should be settled by now (> 4 hours ago)
SELECT 
  COUNT(*) as total_pending_legs,
  SUM(CASE WHEN game_date < NOW() - INTERVAL '4 hours' THEN 1 ELSE 0 END) as legs_ready_to_settle,
  SUM(CASE WHEN game_completed = true THEN 1 ELSE 0 END) as legs_already_settled
FROM parlay_legs pl
JOIN parlays p ON p.id = pl.parlay_id
WHERE p.status = 'pending';
