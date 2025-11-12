-- Enhanced Team Stats Schema for Season Data Caching
-- This creates comprehensive tables for caching current season team and player stats

-- Enhanced team stats table with detailed season performance
CREATE TABLE IF NOT EXISTS team_season_stats (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL,
    team_name VARCHAR(255) NOT NULL,
    sport VARCHAR(50) NOT NULL,
    season INTEGER NOT NULL,
    
    -- Win/Loss Record
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    ties INTEGER DEFAULT 0,
    games_played INTEGER DEFAULT 0,
    win_percentage DECIMAL(5,3) DEFAULT 0.000,
    
    -- Points/Scoring
    points_for INTEGER DEFAULT 0,
    points_against INTEGER DEFAULT 0,
    point_differential INTEGER DEFAULT 0,
    avg_points_for DECIMAL(6,2) DEFAULT 0.00,
    avg_points_against DECIMAL(6,2) DEFAULT 0.00,
    
    -- Conference/Division Standings
    conference VARCHAR(100),
    division VARCHAR(100),
    conference_wins INTEGER DEFAULT 0,
    conference_losses INTEGER DEFAULT 0,
    division_rank INTEGER,
    conference_rank INTEGER,
    
    -- Recent Form (last 5-10 games)
    recent_form VARCHAR(20), -- e.g., "WWLWL" for last 5 games
    streak_type VARCHAR(10), -- "WIN" or "LOSS"
    streak_length INTEGER DEFAULT 0,
    
    -- Home/Away Performance
    home_wins INTEGER DEFAULT 0,
    home_losses INTEGER DEFAULT 0,
    away_wins INTEGER DEFAULT 0,
    away_losses INTEGER DEFAULT 0,
    
    -- Sport-specific stats (stored as JSON)
    sport_specific_stats JSONB DEFAULT '{}',
    
    -- Metadata
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    api_source VARCHAR(50) DEFAULT 'api-sports',
    data_quality VARCHAR(20) DEFAULT 'good', -- good, partial, stale
    
    UNIQUE(team_id, sport, season),
    INDEX idx_team_season_stats_sport_season (sport, season),
    INDEX idx_team_season_stats_team (team_id, sport),
    INDEX idx_team_season_stats_updated (last_updated)
);

-- Player stats table for individual performance tracking
CREATE TABLE IF NOT EXISTS player_season_stats (
    id SERIAL PRIMARY KEY,
    player_id INTEGER NOT NULL,
    player_name VARCHAR(255) NOT NULL,
    team_id INTEGER NOT NULL,
    team_name VARCHAR(255) NOT NULL,
    sport VARCHAR(50) NOT NULL,
    season INTEGER NOT NULL,
    position VARCHAR(50),
    
    -- Basic stats
    games_played INTEGER DEFAULT 0,
    games_started INTEGER DEFAULT 0,
    minutes_played INTEGER DEFAULT 0, -- or plays for football
    
    -- Injury/Availability Status
    injury_status VARCHAR(50) DEFAULT 'healthy', -- healthy, injured, questionable, out
    injury_description TEXT,
    injury_return_date DATE,
    
    -- Performance metrics (sport-agnostic)
    performance_rating DECIMAL(4,2) DEFAULT 0.00, -- 0-10 scale
    consistency_score DECIMAL(4,2) DEFAULT 0.00,  -- variance measure
    recent_form_score DECIMAL(4,2) DEFAULT 0.00,  -- last 5 games
    
    -- Sport-specific statistics (stored as JSON for flexibility)
    sport_stats JSONB DEFAULT '{}',
    
    -- Betting relevance
    prop_bet_eligible BOOLEAN DEFAULT true,
    betting_value_score DECIMAL(4,2) DEFAULT 5.00, -- 1-10 betting value
    
    -- Metadata
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    api_source VARCHAR(50) DEFAULT 'api-sports',
    data_quality VARCHAR(20) DEFAULT 'good',
    
    UNIQUE(player_id, team_id, sport, season),
    INDEX idx_player_season_stats_team (team_id, sport, season),
    INDEX idx_player_season_stats_sport (sport, season),
    INDEX idx_player_season_stats_injury (injury_status),
    INDEX idx_player_season_stats_updated (last_updated)
);

-- Team matchup history for head-to-head analysis
CREATE TABLE IF NOT EXISTS team_matchup_history (
    id SERIAL PRIMARY KEY,
    team1_id INTEGER NOT NULL,
    team1_name VARCHAR(255) NOT NULL,
    team2_id INTEGER NOT NULL,
    team2_name VARCHAR(255) NOT NULL,
    sport VARCHAR(50) NOT NULL,
    
    -- Historical performance
    team1_wins INTEGER DEFAULT 0,
    team2_wins INTEGER DEFAULT 0,
    ties INTEGER DEFAULT 0,
    total_games INTEGER DEFAULT 0,
    
    -- Recent matchups (last 5 games between teams)
    recent_results JSONB DEFAULT '[]', -- array of recent game results
    avg_total_points DECIMAL(6,2) DEFAULT 0.00,
    avg_point_differential DECIMAL(6,2) DEFAULT 0.00,
    
    -- Trends
    team1_ats_record VARCHAR(20), -- Against the spread record
    team2_ats_record VARCHAR(20),
    over_under_trend VARCHAR(20), -- "OVER", "UNDER", or "PUSH" tendency
    
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(team1_id, team2_id, sport),
    INDEX idx_matchup_history_teams (team1_id, team2_id, sport)
);

-- Daily stats sync log for monitoring
CREATE TABLE IF NOT EXISTS stats_sync_log (
    id SERIAL PRIMARY KEY,
    sync_type VARCHAR(50) NOT NULL, -- 'team_stats', 'player_stats', 'matchup_history'
    sport VARCHAR(50) NOT NULL,
    sync_date DATE DEFAULT CURRENT_DATE,
    
    -- Success metrics
    records_processed INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    
    -- Timing
    start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_time TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    
    -- Status
    status VARCHAR(20) DEFAULT 'running', -- running, completed, failed, partial
    error_message TEXT,
    
    -- API usage
    api_calls_made INTEGER DEFAULT 0,
    api_rate_limit_hit BOOLEAN DEFAULT false,
    
    INDEX idx_stats_sync_log_date (sync_date, sync_type),
    INDEX idx_stats_sync_log_status (status, sync_type)
);

-- Comments for documentation
COMMENT ON TABLE team_season_stats IS 'Comprehensive team performance stats cached daily for fast lookups';
COMMENT ON TABLE player_season_stats IS 'Individual player performance and injury status cached daily';
COMMENT ON TABLE team_matchup_history IS 'Historical head-to-head data for team matchup analysis';
COMMENT ON TABLE stats_sync_log IS 'Monitoring and logging for daily stats synchronization processes';