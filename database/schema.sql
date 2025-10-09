-- RAG Parlay Learning Database Schema

-- Core parlay tracking table
CREATE TABLE parlays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP DEFAULT NOW(),
    ai_model VARCHAR(50) NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    sportsbook VARCHAR(50) NOT NULL,
    preference_type VARCHAR(20) NOT NULL,
    total_legs INTEGER NOT NULL,
    combined_odds VARCHAR(20),
    potential_payout DECIMAL(10,2),
    is_lock_bet BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'pending', -- pending, completed, cancelled
    final_outcome VARCHAR(20), -- won, lost, push, partial
    hit_percentage DECIMAL(5,2), -- percentage of legs that hit
    profit_loss DECIMAL(10,2), -- actual profit/loss if bet
    confidence_score DECIMAL(3,2), -- AI confidence 0-1
    metadata JSONB -- store additional context
);

-- Individual leg tracking
CREATE TABLE parlay_legs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parlay_id UUID REFERENCES parlays(id) ON DELETE CASCADE,
    leg_number INTEGER NOT NULL,
    game_date DATE NOT NULL,
    sport VARCHAR(50) NOT NULL,
    home_team VARCHAR(100) NOT NULL,
    away_team VARCHAR(100) NOT NULL,
    bet_type VARCHAR(50) NOT NULL, -- moneyline, spread, total, prop
    bet_details JSONB NOT NULL, -- specific bet info (line, player, etc)
    odds VARCHAR(20) NOT NULL,
    confidence INTEGER, -- 1-10 AI confidence
    reasoning TEXT,
    -- Outcome tracking
    game_completed BOOLEAN DEFAULT FALSE,
    leg_result VARCHAR(20), -- won, lost, push, void
    actual_value DECIMAL(10,2), -- actual game result for comparison
    margin_of_victory DECIMAL(10,2), -- how close the bet was
    created_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP
);

-- Performance analytics by various dimensions
CREATE TABLE performance_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_type VARCHAR(50) NOT NULL, -- team, bet_type, risk_level, etc
    metric_value VARCHAR(100) NOT NULL,
    time_period VARCHAR(20) NOT NULL, -- daily, weekly, monthly
    total_bets INTEGER DEFAULT 0,
    won_bets INTEGER DEFAULT 0,
    lost_bets INTEGER DEFAULT 0,
    push_bets INTEGER DEFAULT 0,
    hit_rate DECIMAL(5,2) DEFAULT 0,
    avg_odds DECIMAL(8,2),
    total_profit_loss DECIMAL(10,2) DEFAULT 0,
    roi DECIMAL(5,2) DEFAULT 0,
    confidence_correlation DECIMAL(5,2), -- how well confidence predicts outcomes
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Vector embeddings for RAG retrieval
CREATE TABLE parlay_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parlay_id UUID REFERENCES parlays(id) ON DELETE CASCADE,
    embedding_type VARCHAR(50) NOT NULL, -- contextual, outcome, pattern
    embedding VECTOR(1536), -- OpenAI embedding size
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Historical patterns for learning
CREATE TABLE betting_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern_type VARCHAR(50) NOT NULL,
    pattern_description TEXT NOT NULL,
    success_rate DECIMAL(5,2),
    sample_size INTEGER,
    confidence_interval DECIMAL(5,2),
    last_updated TIMESTAMP DEFAULT NOW(),
    pattern_data JSONB -- store the actual pattern details
);

-- Indexes for performance
CREATE INDEX idx_parlays_created_at ON parlays(created_at);
CREATE INDEX idx_parlays_status ON parlays(status);
CREATE INDEX idx_parlays_outcome ON parlays(final_outcome);
CREATE INDEX idx_parlay_legs_game_date ON parlay_legs(game_date);
CREATE INDEX idx_parlay_legs_teams ON parlay_legs(home_team, away_team);
CREATE INDEX idx_parlay_legs_bet_type ON parlay_legs(bet_type);
CREATE INDEX idx_performance_metrics_type ON performance_metrics(metric_type, metric_value);
CREATE INDEX idx_embeddings_type ON parlay_embeddings(embedding_type);

-- Views for analytics
CREATE VIEW parlay_success_rates AS
SELECT 
    ai_model,
    risk_level,
    preference_type,
    COUNT(*) as total_parlays,
    COUNT(CASE WHEN final_outcome = 'won' THEN 1 END) as won_parlays,
    ROUND(COUNT(CASE WHEN final_outcome = 'won' THEN 1 END)::DECIMAL / COUNT(*) * 100, 2) as win_rate,
    AVG(hit_percentage) as avg_hit_percentage,
    SUM(profit_loss) as total_profit_loss
FROM parlays 
WHERE status = 'completed'
GROUP BY ai_model, risk_level, preference_type;

CREATE VIEW leg_performance_by_type AS
SELECT 
    bet_type,
    sport,
    COUNT(*) as total_legs,
    COUNT(CASE WHEN leg_result = 'won' THEN 1 END) as won_legs,
    ROUND(COUNT(CASE WHEN leg_result = 'won' THEN 1 END)::DECIMAL / COUNT(*) * 100, 2) as win_rate,
    AVG(confidence) as avg_confidence,
    CORR(confidence, CASE WHEN leg_result = 'won' THEN 1 ELSE 0 END) as confidence_correlation
FROM parlay_legs 
WHERE game_completed = true
GROUP BY bet_type, sport;