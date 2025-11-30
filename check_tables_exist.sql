-- Check what tables actually exist in your database
SELECT 
  table_schema,
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('parlays', 'parlay_legs', 'picks', 'ai_suggestions')
ORDER BY table_name;

-- If parlay_legs exists, show its structure
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'parlay_legs'
ORDER BY ordinal_position;
