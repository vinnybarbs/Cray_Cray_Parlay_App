-- Check which games are old enough to settle (4+ hours after game time)
SELECT 
  game_date,
  sport,
  home_team,
  away_team,
  COUNT(*) as picks_count,
  EXTRACT(EPOCH FROM (NOW() - game_date)) / 3600 as hours_since_game,
  CASE 
    WHEN game_date > NOW() THEN '⏰ Future game'
    WHEN game_date > NOW() - INTERVAL '4 hours' THEN '🏈 Too recent (< 4hrs)'
    ELSE '✅ Ready to settle'
  END as status
FROM ai_suggestions
WHERE was_locked_by_user = true
  AND actual_outcome = 'pending'
GROUP BY game_date, sport, home_team, away_team
ORDER BY game_date DESC
LIMIT 20;
