-- API-Sports Data Schema
-- Comprehensive NFL & NCAAF statistics from API-Sports

-- ============================================
-- 1. TEAMS (Enhanced)
-- ============================================
-- Note: Reuse existing 'teams' table but add API-Sports mapping
ALTER TABLE teams 
ADD COLUMN IF NOT EXISTS apisports_id INTEGER,
ADD COLUMN IF NOT EXISTS apisports_league VARCHAR(10); -- 'nfl' or 'ncaaf'

CREATE INDEX IF NOT EXISTS idx_teams_apisports ON teams(apisports_id, apisports_league);

-- ============================================
-- 2. PLAYERS
-- ============================================
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apisports_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  team_id UUID REFERENCES teams(id),
  position VARCHAR(10),
  jersey_number INTEGER,
  height VARCHAR(10),
  weight VARCHAR(10),
  birth_date DATE,
  college VARCHAR(255),
  experience INTEGER,
  league VARCHAR(10), -- 'nfl' or 'ncaaf'
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(apisports_id, league)
);

CREATE INDEX idx_players_team ON players(team_id);
CREATE INDEX idx_players_position ON players(position);
CREATE INDEX idx_players_active ON players(active) WHERE active = true;

-- ============================================
-- 3. INJURIES (The Game Changer!)
-- ============================================
CREATE TABLE IF NOT EXISTS injuries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES players(id),
  team_id UUID REFERENCES teams(id),
  status VARCHAR(50), -- 'Out', 'Questionable', 'Doubtful', 'IR', etc.
  injury_type VARCHAR(255), -- 'Knee', 'Ankle', 'Concussion', etc.
  description TEXT,
  date_reported DATE,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  is_current BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_injuries_player ON injuries(player_id);
CREATE INDEX idx_injuries_team ON injuries(team_id);
CREATE INDEX idx_injuries_current ON injuries(is_current) WHERE is_current = true;

-- ============================================
-- 4. TEAM STATS (Season & Game Level)
-- ============================================
-- Enhance existing or create new detailed stats
CREATE TABLE IF NOT EXISTS team_stats_detailed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id),
  season INTEGER NOT NULL,
  week INTEGER, -- NULL for season totals
  
  -- Offense
  points_per_game DECIMAL(5,2),
  total_yards_per_game DECIMAL(6,2),
  passing_yards_per_game DECIMAL(6,2),
  rushing_yards_per_game DECIMAL(6,2),
  turnovers_lost INTEGER,
  
  -- Defense
  points_allowed_per_game DECIMAL(5,2),
  yards_allowed_per_game DECIMAL(6,2),
  passing_yards_allowed DECIMAL(6,2),
  rushing_yards_allowed DECIMAL(6,2),
  turnovers_gained INTEGER,
  sacks INTEGER,
  
  -- Special Teams
  field_goal_percentage DECIMAL(5,2),
  
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, season, week)
);

CREATE INDEX idx_team_stats_season ON team_stats_detailed(team_id, season);

-- ============================================
-- 5. PLAYER GAME STATS (Historical Performance)
-- ============================================
CREATE TABLE IF NOT EXISTS player_game_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES players(id),
  game_id VARCHAR(50) NOT NULL, -- API-Sports game ID
  game_date DATE NOT NULL,
  opponent_team_id UUID REFERENCES teams(id),
  
  -- Passing
  passing_attempts INTEGER,
  passing_completions INTEGER,
  passing_yards INTEGER,
  passing_touchdowns INTEGER,
  interceptions INTEGER,
  
  -- Rushing
  rushing_attempts INTEGER,
  rushing_yards INTEGER,
  rushing_touchdowns INTEGER,
  
  -- Receiving
  receptions INTEGER,
  receiving_yards INTEGER,
  receiving_touchdowns INTEGER,
  targets INTEGER,
  
  -- Defense
  tackles INTEGER,
  sacks DECIMAL(3,1),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, game_id)
);

CREATE INDEX idx_player_game_stats_player ON player_game_stats(player_id, game_date DESC);
CREATE INDEX idx_player_game_stats_game ON player_game_stats(game_id);

-- ============================================
-- 6. PLAYER SEASON STATS (Aggregated)
-- ============================================
CREATE TABLE IF NOT EXISTS player_season_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES players(id),
  season INTEGER NOT NULL,
  
  games_played INTEGER,
  
  -- Passing
  passing_yards INTEGER,
  passing_touchdowns INTEGER,
  interceptions INTEGER,
  completion_percentage DECIMAL(5,2),
  
  -- Rushing
  rushing_yards INTEGER,
  rushing_touchdowns INTEGER,
  yards_per_carry DECIMAL(4,2),
  
  -- Receiving
  receptions INTEGER,
  receiving_yards INTEGER,
  receiving_touchdowns INTEGER,
  yards_per_reception DECIMAL(5,2),
  
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, season)
);

CREATE INDEX idx_player_season_stats ON player_season_stats(player_id, season);

-- ============================================
-- 7. STANDINGS (Current Season)
-- ============================================
CREATE TABLE IF NOT EXISTS standings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id),
  season INTEGER NOT NULL,
  conference VARCHAR(10), -- 'AFC', 'NFC'
  division VARCHAR(10), -- 'East', 'West', 'North', 'South'
  
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  ties INTEGER DEFAULT 0,
  
  points_for INTEGER,
  points_against INTEGER,
  point_differential INTEGER,
  
  streak VARCHAR(10), -- 'W3', 'L2', etc.
  
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, season)
);

CREATE INDEX idx_standings_season ON standings(season, conference, division);

-- ============================================
-- 8. API SYNC LOG (Track Updates)
-- ============================================
CREATE TABLE IF NOT EXISTS apisports_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint VARCHAR(100) NOT NULL, -- 'players', 'injuries', 'standings', etc.
  league VARCHAR(10) NOT NULL, -- 'nfl', 'ncaaf'
  season INTEGER,
  sync_started_at TIMESTAMPTZ NOT NULL,
  sync_completed_at TIMESTAMPTZ,
  records_updated INTEGER,
  status VARCHAR(20), -- 'running', 'completed', 'failed'
  error_message TEXT,
  api_calls_used INTEGER DEFAULT 0
);

CREATE INDEX idx_sync_log_status ON apisports_sync_log(endpoint, status, sync_started_at DESC);

-- ============================================
-- VIEWS FOR EASY QUERYING
-- ============================================

-- Current injuries by team
CREATE OR REPLACE VIEW current_injuries_by_team AS
SELECT 
  t.name as team_name,
  p.name as player_name,
  p.position,
  i.status,
  i.injury_type,
  i.description,
  i.date_reported
FROM injuries i
JOIN players p ON p.id = i.player_id
JOIN teams t ON t.id = i.team_id
WHERE i.is_current = true
ORDER BY t.name, i.status, p.position;

-- Player recent performance (last 5 games)
CREATE OR REPLACE VIEW player_recent_performance AS
SELECT 
  p.name as player_name,
  p.position,
  t.name as team_name,
  pgs.game_date,
  pgs.passing_yards,
  pgs.rushing_yards,
  pgs.receiving_yards,
  pgs.passing_touchdowns + pgs.rushing_touchdowns + pgs.receiving_touchdowns as total_tds
FROM player_game_stats pgs
JOIN players p ON p.id = pgs.player_id
JOIN teams t ON t.id = p.team_id
WHERE pgs.game_date >= CURRENT_DATE - INTERVAL '35 days'
ORDER BY p.name, pgs.game_date DESC;

-- Season standings with rankings
CREATE OR REPLACE VIEW current_standings AS
SELECT 
  t.name as team_name,
  s.conference,
  s.division,
  s.wins,
  s.losses,
  s.ties,
  ROUND(s.wins::DECIMAL / NULLIF(s.wins + s.losses + s.ties, 0), 3) as win_percentage,
  s.point_differential,
  s.streak,
  RANK() OVER (PARTITION BY s.conference, s.division ORDER BY s.wins DESC, s.point_differential DESC) as division_rank
FROM standings s
JOIN teams t ON t.id = s.team_id
WHERE s.season = EXTRACT(YEAR FROM CURRENT_DATE)
ORDER BY s.conference, s.division, division_rank;

-- API sync status
CREATE OR REPLACE VIEW api_sync_status AS
SELECT 
  endpoint,
  league,
  MAX(sync_completed_at) as last_sync,
  SUM(api_calls_used) as total_calls_today,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
  COUNT(*) FILTER (WHERE status = 'completed') as success_count
FROM apisports_sync_log
WHERE sync_started_at >= CURRENT_DATE
GROUP BY endpoint, league
ORDER BY last_sync DESC NULLS LAST;

-- Confirm
SELECT 'API-Sports schema created successfully!' as status;
