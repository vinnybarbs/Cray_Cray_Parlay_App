-- Check what's actually in the odds_cache to find selection IDs
SELECT 
  game_id,
  sport,
  jsonb_pretty(odds_data->'bookmakers'->0) as first_bookmaker
FROM odds_cache
WHERE commence_time > NOW()
LIMIT 1;

-- Also check if there are any fields that might contain selection IDs
SELECT 
  game_id,
  jsonb_pretty(odds_data->'bookmakers'->0->'markets'->0->'outcomes'->0) as first_outcome
FROM odds_cache  
WHERE commence_time > NOW()
LIMIT 1;
