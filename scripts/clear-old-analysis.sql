-- Clear old analysis to re-run with research-enhanced version
-- Run this in Supabase SQL Editor, then re-run /api/analyze-outcomes

UPDATE ai_suggestions 
SET 
  post_analysis = NULL,
  lessons_learned = NULL,
  analyzed_at = NULL
WHERE analyzed_at IS NOT NULL;

-- See how many will be re-analyzed
SELECT 
  COUNT(*) as picks_to_reanalyze,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins_to_analyze,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as losses_to_analyze
FROM ai_suggestions
WHERE actual_outcome IN ('won', 'lost')
  AND analyzed_at IS NULL;
