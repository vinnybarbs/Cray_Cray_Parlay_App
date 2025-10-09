/**
 * Parlay Tracking Service - Stores and tracks parlay outcomes
 * Part of the RAG learning system for improving bet accuracy
 */

class ParlayTracker {
    constructor(database) {
        this.db = database;
        this.pendingParlays = new Map(); // In-memory tracking of active parlays
    }

    /**
     * Store a newly generated parlay for tracking
     */
    async storeParlayForTracking(parlayData, parlayContent) {
        try {
            const parlayId = await this.db.transaction(async (trx) => {
                // Parse the parlay content to extract structured data
                const parsedParlay = this.parseParlayContent(parlayContent);
                
                // Insert main parlay record
                const [parlay] = await trx('parlays').insert({
                    ai_model: parlayData.aiModel,
                    risk_level: parlayData.riskLevel,
                    sportsbook: parlayData.sportsbook,
                    preference_type: parlayData.preferenceType,
                    total_legs: parsedParlay.legs.length,
                    combined_odds: parsedParlay.combinedOdds,
                    potential_payout: parsedParlay.potentialPayout,
                    is_lock_bet: parsedParlay.isLockBet || false,
                    confidence_score: parsedParlay.overallConfidence / 10,
                    metadata: {
                        originalRequest: parlayData,
                        rawContent: parlayContent,
                        generatedAt: new Date().toISOString()
                    }
                }).returning('id');

                // Insert individual legs
                for (let i = 0; i < parsedParlay.legs.length; i++) {
                    const leg = parsedParlay.legs[i];
                    await trx('parlay_legs').insert({
                        parlay_id: parlay.id,
                        leg_number: i + 1,
                        game_date: leg.date,
                        sport: this.extractSport(parlayData.selectedSports),
                        home_team: leg.homeTeam,
                        away_team: leg.awayTeam,
                        bet_type: leg.betType,
                        bet_details: {
                            description: leg.description,
                            line: leg.line,
                            player: leg.player || null
                        },
                        odds: leg.odds,
                        confidence: leg.confidence,
                        reasoning: leg.reasoning
                    });
                }

                return parlay.id;
            });

            // Add to pending tracking
            this.pendingParlays.set(parlayId, {
                legs: parsedParlay.legs,
                trackingStarted: new Date()
            });

            console.log(`✅ Stored parlay ${parlayId} for outcome tracking`);
            return parlayId;

        } catch (error) {
            console.error('❌ Error storing parlay for tracking:', error);
            throw error;
        }
    }

    /**
     * Parse AI-generated parlay content into structured data
     */
    parseParlayContent(content) {
        try {
            const legs = [];
            const lockParlays = [];
            
            // Extract main parlay legs
            const legMatches = content.match(/\d+\.\s+📅\s+DATE:\s+(\d{2}\/\d{2}\/\d{4})\s+Game:\s+(.+?)\s+Bet:\s+(.+?)\s+Odds:\s+(.+?)\s+Confidence:\s+(\d+)\/10\s+Reasoning:\s+(.+?)(?=\n\d+\.|$)/gs);
            
            if (legMatches) {
                legMatches.forEach(match => {
                    const [, date, game, bet, odds, confidence, reasoning] = match.match(/📅\s+DATE:\s+(\d{2}\/\d{2}\/\d{4})\s+Game:\s+(.+?)\s+Bet:\s+(.+?)\s+Odds:\s+(.+?)\s+Confidence:\s+(\d+)\/10\s+Reasoning:\s+(.+)/s);
                    
                    const [awayTeam, homeTeam] = game.includes('@') ? 
                        game.split('@').map(t => t.trim()) : 
                        game.split(' vs ').map(t => t.trim());

                    legs.push({
                        date: this.parseDate(date),
                        game,
                        homeTeam: homeTeam || '',
                        awayTeam: awayTeam || '',
                        betType: this.categorizeBetType(bet),
                        description: bet,
                        odds,
                        confidence: parseInt(confidence),
                        reasoning: reasoning.trim(),
                        line: this.extractLine(bet)
                    });
                });
            }

            // Extract combined odds and payout
            const combinedOddsMatch = content.match(/\*\*Combined Odds:\*\*\s+(.+)/);
            const payoutMatch = content.match(/\*\*Payout on \$100:\*\*\s+\$(.+)/);
            const confidenceMatch = content.match(/\*\*Overall Confidence:\*\*\s+(\d+)\/10/);

            // Check for lock bets
            const hasLockBet = content.includes('🔒 BONUS LOCK PARLAY');

            return {
                legs,
                combinedOdds: combinedOddsMatch ? combinedOddsMatch[1].trim() : null,
                potentialPayout: payoutMatch ? parseFloat(payoutMatch[1].replace(',', '')) : null,
                overallConfidence: confidenceMatch ? parseInt(confidenceMatch[1]) : null,
                isLockBet: hasLockBet,
                hasLockParlay: hasLockBet
            };

        } catch (error) {
            console.error('❌ Error parsing parlay content:', error);
            return { legs: [], combinedOdds: null, potentialPayout: null, overallConfidence: null };
        }
    }

    /**
     * Categorize bet type for analytics
     */
    categorizeBetType(betDescription) {
        const desc = betDescription.toLowerCase();
        if (desc.includes('moneyline')) return 'moneyline';
        if (desc.includes('spread') || desc.includes('point spread')) return 'spread';
        if (desc.includes('total') || desc.includes('over') || desc.includes('under')) return 'total';
        if (desc.includes('touchdown') || desc.includes('yards') || desc.includes('reception')) return 'prop';
        return 'other';
    }

    /**
     * Extract betting line from description
     */
    extractLine(betDescription) {
        const spreadMatch = betDescription.match(/([-+]\d+\.?\d*)/);
        const totalMatch = betDescription.match(/over|under\s+(\d+\.?\d*)/i);
        
        if (spreadMatch) return parseFloat(spreadMatch[1]);
        if (totalMatch) return parseFloat(totalMatch[1]);
        return null;
    }

    /**
     * Parse date string to proper format
     */
    parseDate(dateString) {
        const [month, day, year] = dateString.split('/');
        return new Date(year, month - 1, day).toISOString().split('T')[0];
    }

    /**
     * Extract sport from selected sports array
     */
    extractSport(selectedSports) {
        if (!selectedSports || selectedSports.length === 0) return 'unknown';
        const sport = selectedSports[0];
        if (sport.includes('nfl')) return 'nfl';
        if (sport.includes('nba')) return 'nba';
        if (sport.includes('mlb')) return 'mlb';
        if (sport.includes('nhl')) return 'nhl';
        return sport;
    }

    /**
     * Update parlay outcome when games complete
     */
    async updateParlayOutcome(parlayId, outcome, hitPercentage, profitLoss = null) {
        try {
            await this.db('parlays')
                .where('id', parlayId)
                .update({
                    status: 'completed',
                    final_outcome: outcome,
                    hit_percentage: hitPercentage,
                    profit_loss: profitLoss,
                    updated_at: new Date()
                });

            // Remove from pending tracking
            this.pendingParlays.delete(parlayId);

            console.log(`✅ Updated parlay ${parlayId} outcome: ${outcome}`);
            
            // Trigger analytics update
            await this.updatePerformanceMetrics();

        } catch (error) {
            console.error('❌ Error updating parlay outcome:', error);
            throw error;
        }
    }

    /**
     * Update individual leg outcome
     */
    async updateLegOutcome(parlayId, legNumber, result, actualValue = null, marginOfVictory = null) {
        try {
            await this.db('parlay_legs')
                .where({ parlay_id: parlayId, leg_number: legNumber })
                .update({
                    game_completed: true,
                    leg_result: result,
                    actual_value: actualValue,
                    margin_of_victory: marginOfVictory,
                    resolved_at: new Date()
                });

            console.log(`✅ Updated leg ${legNumber} for parlay ${parlayId}: ${result}`);

        } catch (error) {
            console.error('❌ Error updating leg outcome:', error);
            throw error;
        }
    }

    /**
     * Calculate hit percentage for a parlay
     */
    async calculateParlayHitRate(parlayId) {
        const legs = await this.db('parlay_legs')
            .where('parlay_id', parlayId)
            .where('game_completed', true);

        if (legs.length === 0) return 0;

        const wonLegs = legs.filter(leg => leg.leg_result === 'won').length;
        return (wonLegs / legs.length) * 100;
    }

    /**
     * Update performance metrics for analytics
     */
    async updatePerformanceMetrics() {
        try {
            // Update various performance dimensions
            await this.updateMetricsByDimension('ai_model');
            await this.updateMetricsByDimension('risk_level');
            await this.updateMetricsByDimension('bet_type');
            await this.updateMetricsByDimension('sportsbook');

            console.log('✅ Performance metrics updated');

        } catch (error) {
            console.error('❌ Error updating performance metrics:', error);
        }
    }

    /**
     * Update metrics for a specific dimension
     */
    async updateMetricsByDimension(dimension) {
        // Implementation would vary by dimension
        // This is a placeholder for the metric calculation logic
        console.log(`Updating metrics for dimension: ${dimension}`);
    }

    /**
     * Get performance analytics
     */
    async getPerformanceAnalytics(timeframe = '30days') {
        try {
            const analytics = await this.db.raw(`
                SELECT 
                    ai_model,
                    risk_level,
                    COUNT(*) as total_parlays,
                    AVG(hit_percentage) as avg_hit_rate,
                    SUM(CASE WHEN final_outcome = 'won' THEN 1 ELSE 0 END) as won_parlays,
                    SUM(profit_loss) as total_profit_loss,
                    AVG(confidence_score) as avg_confidence
                FROM parlays 
                WHERE status = 'completed' 
                AND created_at >= NOW() - INTERVAL '${timeframe === '30days' ? '30 days' : '7 days'}'
                GROUP BY ai_model, risk_level
                ORDER BY avg_hit_rate DESC
            `);

            return analytics.rows;

        } catch (error) {
            console.error('❌ Error getting performance analytics:', error);
            return [];
        }
    }
}

module.exports = ParlayTracker;