-- News and Analysis Cache
-- Stores proactive Serper searches for injuries, analyst picks, team news
-- Refreshed daily to provide rich context for AI without live API calls

CREATE TABLE IF NOT EXISTS news_cache (
  id BIGSERIAL PRIMARY KEY,
  sport VARCHAR(50) NOT NULL,
  search_type VARCHAR(50) NOT NULL, -- 'injuries', 'analyst_picks', 'team_news', 'player_news'
  team_name VARCHAR(255),
  player_name VARCHAR(255),
  search_query TEXT NOT NULL,
  articles JSONB NOT NULL, -- Array of articles with title, link, snippet, date
  summary TEXT, -- AI-generated summary of key points
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_news_sport_type ON news_cache(sport, search_type);
CREATE INDEX idx_news_team ON news_cache(team_name);
CREATE INDEX idx_news_player ON news_cache(player_name);
CREATE INDEX idx_news_updated ON news_cache(last_updated);
CREATE INDEX idx_news_expires ON news_cache(expires_at);

-- Enable Row Level Security
ALTER TABLE news_cache ENABLE ROW LEVEL SECURITY;

-- Public read access (news is public)
CREATE POLICY "Allow public read on news_cache" ON news_cache FOR SELECT USING (true);

-- Service role can write (for cron job)
CREATE POLICY "Allow service role write on news_cache" ON news_cache FOR ALL USING (auth.role() = 'service_role');

-- Betting trends cache (from analyst sites)
CREATE TABLE IF NOT EXISTS betting_trends_cache (
  id BIGSERIAL PRIMARY KEY,
  sport VARCHAR(50) NOT NULL,
  game_id VARCHAR(255), -- External game ID if available
  home_team VARCHAR(255) NOT NULL,
  away_team VARCHAR(255) NOT NULL,
  game_date TIMESTAMP WITH TIME ZONE NOT NULL,
  public_betting_percentage JSONB, -- % on each side
  sharp_money_indicator VARCHAR(50), -- 'home', 'away', 'neutral'
  line_movement JSONB, -- Opening vs current line
  analyst_consensus JSONB, -- Array of analyst picks
  trends_summary TEXT,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_betting_trends_sport ON betting_trends_cache(sport);
CREATE INDEX idx_betting_trends_teams ON betting_trends_cache(home_team, away_team);
CREATE INDEX idx_betting_trends_date ON betting_trends_cache(game_date);
CREATE INDEX idx_betting_trends_updated ON betting_trends_cache(last_updated);

ALTER TABLE betting_trends_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on betting_trends_cache" ON betting_trends_cache FOR SELECT USING (true);
CREATE POLICY "Allow service role write on betting_trends_cache" ON betting_trends_cache FOR ALL USING (auth.role() = 'service_role');
