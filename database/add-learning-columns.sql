-- Add learning loop columns to ai_suggestions table
-- Run this in Supabase SQL Editor

-- Add analysis columns
ALTER TABLE ai_suggestions
ADD COLUMN IF NOT EXISTS post_analysis TEXT,
ADD COLUMN IF NOT EXISTS lessons_learned JSONB,
ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMPTZ;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_analyzed 
  ON ai_suggestions(analyzed_at) 
  WHERE analyzed_at IS NOT NULL;

-- Create index for outcome + sport (for pattern matching)
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_patterns 
  ON ai_suggestions(sport, bet_type, actual_outcome);

-- Create view for easy access to lessons
CREATE OR REPLACE VIEW learning_insights AS
SELECT 
  sport,
  bet_type,
  actual_outcome,
  COUNT(*) as occurrences,
  jsonb_agg(
    jsonb_build_object(
      'pick', pick,
      'reasoning', reasoning,
      'lesson', post_analysis,
      'game', home_team || ' vs ' || away_team,
      'date', game_date
    ) ORDER BY analyzed_at DESC
  ) FILTER (WHERE post_analysis IS NOT NULL) as insights
FROM ai_suggestions
WHERE actual_outcome IN ('won', 'lost')
GROUP BY sport, bet_type, actual_outcome
HAVING COUNT(*) FILTER (WHERE post_analysis IS NOT NULL) > 0;

-- Confirm
SELECT 'Learning columns added successfully!' as status;
