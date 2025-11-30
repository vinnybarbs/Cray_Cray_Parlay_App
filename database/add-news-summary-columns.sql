-- Add summary columns to news_articles for pre-computed insights
-- Run this in Supabase SQL Editor

-- Add columns for betting-relevant summaries
ALTER TABLE news_articles
ADD COLUMN IF NOT EXISTS betting_summary TEXT,
ADD COLUMN IF NOT EXISTS injury_mentions TEXT[],
ADD COLUMN IF NOT EXISTS sentiment TEXT CHECK (sentiment IN ('positive', 'negative', 'neutral'));

-- Index for fast lookup of summarized articles
CREATE INDEX IF NOT EXISTS idx_news_betting_summary ON news_articles(betting_summary) WHERE betting_summary IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_news_published_summary ON news_articles(published_at DESC) WHERE betting_summary IS NOT NULL;

-- Comment
COMMENT ON COLUMN news_articles.betting_summary IS 'Pre-computed betting-relevant insights from article (bullet points)';
COMMENT ON COLUMN news_articles.injury_mentions IS 'Array of player names mentioned as injured/questionable';
COMMENT ON COLUMN news_articles.sentiment IS 'Team sentiment from article: positive, negative, or neutral';
