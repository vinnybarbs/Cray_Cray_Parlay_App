-- API-Sports Data Cache
-- Stores team stats, standings, injuries, and H2H data from API-Sports
-- Refreshed daily to minimize API calls

-- Team Statistics Cache
CREATE TABLE IF NOT EXISTS team_stats_cache (
  id BIGSERIAL PRIMARY KEY,
  sport VARCHAR(50) NOT NULL,
  season INTEGER NOT NULL,
  team_id VARCHAR(100) NOT NULL,
  team_name VARCHAR(255) NOT NULL,
  stats JSONB NOT NULL, -- Full stats object from API-Sports
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(sport, season, team_id)
);

CREATE INDEX idx_team_stats_sport_season ON team_stats_cache(sport, season);
CREATE INDEX idx_team_stats_team_id ON team_stats_cache(team_id);
CREATE INDEX idx_team_stats_updated ON team_stats_cache(last_updated);

-- Standings Cache
CREATE TABLE IF NOT EXISTS standings_cache (
  id BIGSERIAL PRIMARY KEY,
  sport VARCHAR(50) NOT NULL,
  season INTEGER NOT NULL,
  league VARCHAR(100) NOT NULL,
  standings JSONB NOT NULL, -- Full standings array from API-Sports
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(sport, season, league)
);

CREATE INDEX idx_standings_sport_season ON standings_cache(sport, season);
CREATE INDEX idx_standings_updated ON standings_cache(last_updated);

-- Injuries Cache
CREATE TABLE IF NOT EXISTS injuries_cache (
  id BIGSERIAL PRIMARY KEY,
  sport VARCHAR(50) NOT NULL,
  season INTEGER NOT NULL,
  team_id VARCHAR(100),
  player_name VARCHAR(255) NOT NULL,
  injury_status VARCHAR(100),
  injury_details JSONB, -- Full injury object from API-Sports
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_injuries_sport_season ON injuries_cache(sport, season);
CREATE INDEX idx_injuries_team ON injuries_cache(team_id);
CREATE INDEX idx_injuries_updated ON injuries_cache(last_updated);

-- Head-to-Head Cache
CREATE TABLE IF NOT EXISTS h2h_cache (
  id BIGSERIAL PRIMARY KEY,
  sport VARCHAR(50) NOT NULL,
  team1_id VARCHAR(100) NOT NULL,
  team2_id VARCHAR(100) NOT NULL,
  team1_name VARCHAR(255) NOT NULL,
  team2_name VARCHAR(255) NOT NULL,
  games JSONB NOT NULL, -- Array of past games from API-Sports
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(sport, team1_id, team2_id)
);

CREATE INDEX idx_h2h_sport ON h2h_cache(sport);
CREATE INDEX idx_h2h_teams ON h2h_cache(team1_id, team2_id);
CREATE INDEX idx_h2h_updated ON h2h_cache(last_updated);

-- Player Statistics Cache (for prop research)
CREATE TABLE IF NOT EXISTS player_stats_cache (
  id BIGSERIAL PRIMARY KEY,
  sport VARCHAR(50) NOT NULL,
  season INTEGER NOT NULL,
  player_id VARCHAR(100) NOT NULL,
  player_name VARCHAR(255) NOT NULL,
  team_id VARCHAR(100),
  stats JSONB NOT NULL, -- Full player stats from API-Sports
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(sport, season, player_id)
);

CREATE INDEX idx_player_stats_sport_season ON player_stats_cache(sport, season);
CREATE INDEX idx_player_stats_player ON player_stats_cache(player_id);
CREATE INDEX idx_player_stats_team ON player_stats_cache(team_id);
CREATE INDEX idx_player_stats_updated ON player_stats_cache(last_updated);

-- Enable Row Level Security
ALTER TABLE team_stats_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE standings_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE injuries_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE h2h_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_stats_cache ENABLE ROW LEVEL SECURITY;

-- Public read access (data is public sports stats)
CREATE POLICY "Allow public read on team_stats_cache" ON team_stats_cache FOR SELECT USING (true);
CREATE POLICY "Allow public read on standings_cache" ON standings_cache FOR SELECT USING (true);
CREATE POLICY "Allow public read on injuries_cache" ON injuries_cache FOR SELECT USING (true);
CREATE POLICY "Allow public read on h2h_cache" ON h2h_cache FOR SELECT USING (true);
CREATE POLICY "Allow public read on player_stats_cache" ON player_stats_cache FOR SELECT USING (true);

-- Service role can write (for cron job)
CREATE POLICY "Allow service role write on team_stats_cache" ON team_stats_cache FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role write on standings_cache" ON standings_cache FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role write on injuries_cache" ON injuries_cache FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role write on h2h_cache" ON h2h_cache FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role write on player_stats_cache" ON player_stats_cache FOR ALL USING (auth.role() = 'service_role');
