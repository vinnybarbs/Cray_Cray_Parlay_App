/**
 * AI Suggestion Outcome Checker
 * Checks ALL AI suggestions (not just user-selected ones) to track model accuracy
 * Separate from parlay outcome checking - this tracks AI performance
 */

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../../shared/logger');

class AISuggestionOutcomeChecker {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  /**
   * Check all pending AI suggestions and update outcomes
   * This tracks MODEL ACCURACY - not user parlay outcomes
   */
  async checkAllPendingSuggestions() {
    try {
      logger.info('🤖 Starting AI suggestion outcome check (model accuracy tracking)...');

      // Get all pending AI suggestions from last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: pendingSuggestions, error } = await this.supabase
        .from('ai_suggestions')
        .select('*')
        .eq('actual_outcome', 'pending')
        .gte('game_date', sevenDaysAgo.toISOString().split('T')[0])
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (!pendingSuggestions?.length) {
        logger.info('No pending AI suggestions found');
        return { checked: 0, updated: 0 };
      }

      logger.info(`Found ${pendingSuggestions.length} pending AI suggestions to check`);

      let updatedCount = 0;
      
      for (const suggestion of pendingSuggestions) {
        try {
          const result = await this.checkSuggestionOutcome(suggestion);
          if (result.updated) {
            updatedCount++;
          }
        } catch (error) {
          logger.error(`Error checking suggestion ${suggestion.id}:`, error);
        }
      }

      logger.info(`✅ AI suggestion check complete: ${updatedCount}/${pendingSuggestions.length} updated`);
      
      // Calculate and log updated model accuracy
      await this.logModelAccuracy();
      
      return {
        checked: pendingSuggestions.length,
        updated: updatedCount
      };

    } catch (error) {
      logger.error('Error in checkAllPendingSuggestions:', error);
      throw error;
    }
  }

  /**
   * Check outcome for a single AI suggestion
   */
  async checkSuggestionOutcome(suggestion) {
    try {
      logger.info(`Checking AI suggestion: ${suggestion.sport} - ${suggestion.away_team} @ ${suggestion.home_team}`);

      // Get game result (reuse same logic as parlay checker)
      const gameResult = await this.getGameResult(suggestion);
      
      if (!gameResult) {
        logger.info(`  No result found yet`);
        return { updated: false, reason: 'Game not completed' };
      }

      logger.info(`  Found result: ${gameResult.awayScore}-${gameResult.homeScore}`);

      // Determine if AI suggestion was correct
      const outcome = this.determineSuggestionOutcome(suggestion, gameResult);
      
      if (!outcome) {
        return { updated: false, reason: 'Could not determine outcome' };
      }

      // Update the suggestion
      const { error } = await this.supabase
        .from('ai_suggestions')
        .update({
          actual_outcome: outcome.result,
          resolved_at: new Date().toISOString()
        })
        .eq('id', suggestion.id);

      if (error) throw error;

      logger.info(`✅ AI suggestion ${suggestion.id}: ${outcome.result}`);
      return { updated: true, outcome: outcome.result };

    } catch (error) {
      logger.error(`Error checking suggestion ${suggestion.id}:`, error);
      return { updated: false, error: error.message };
    }
  }

  /**
   * Determine if AI suggestion was correct
   */
  determineSuggestionOutcome(suggestion, gameResult) {
    const betType = suggestion.bet_type;
    const scoreDiff = gameResult.homeScore - gameResult.awayScore;

    switch (betType) {
      case 'Moneyline':
        return this.checkMoneylineOutcome(suggestion, scoreDiff);
      
      case 'Spread':
        return this.checkSpreadOutcome(suggestion, scoreDiff);
      
      case 'Total':
      case 'Totals (O/U)':
        return this.checkTotalOutcome(suggestion, gameResult);
      
      case 'Player Props':
      case 'TD Props':
      case 'Player Pass TDs':
      case 'Player Rush Yards':
      case 'Player Receptions':
        // Player props need live stats - skip for now, mark as push
        return { result: 'push' };
      
      default:
        logger.warn(`Unknown bet type: ${betType}`);
        return null;
    }
  }

  /**
   * Check moneyline outcome
   */
  checkMoneylineOutcome(suggestion, scoreDiff) {
    const pick = suggestion.pick || '';
    const homeTeam = suggestion.home_team || '';
    
    const pickedHome = pick.toLowerCase().includes(homeTeam.toLowerCase());
    
    if (scoreDiff === 0) {
      return { result: 'push' };
    }

    let teamWon = false;
    if (pickedHome) {
      teamWon = scoreDiff > 0;
    } else {
      teamWon = scoreDiff < 0;
    }

    return { result: teamWon ? 'won' : 'lost' };
  }

  /**
   * Check spread outcome
   */
  checkSpreadOutcome(suggestion, scoreDiff) {
    const line = suggestion.point ? parseFloat(suggestion.point) : 0;
    const pick = suggestion.pick || '';
    const homeTeam = suggestion.home_team || '';
    
    const pickedHome = pick.toLowerCase().includes(homeTeam.toLowerCase());
    
    let adjustedDiff;
    if (pickedHome) {
      adjustedDiff = scoreDiff - line;
    } else {
      adjustedDiff = -scoreDiff - line;
    }

    if (Math.abs(adjustedDiff) < 0.01) {
      return { result: 'push' };
    }

    return { result: adjustedDiff > 0 ? 'won' : 'lost' };
  }

  /**
   * Check total outcome
   */
  checkTotalOutcome(suggestion, gameResult) {
    const line = suggestion.point ? parseFloat(suggestion.point) : 0;
    const pick = suggestion.pick || '';
    const totalScore = gameResult.homeScore + gameResult.awayScore;
    
    const pickedOver = pick.toLowerCase().includes('over');
    const pickedUnder = pick.toLowerCase().includes('under');
    
    if (totalScore === line) {
      return { result: 'push' };
    }

    let correct = false;
    if (pickedOver) {
      correct = totalScore > line;
    } else if (pickedUnder) {
      correct = totalScore < line;
    }

    return { result: correct ? 'won' : 'lost' };
  }

  /**
   * Get game result - reuse same logic as parlay checker
   */
  async getGameResult(suggestion) {
    try {
      const gameDate = new Date(suggestion.game_date);
      const today = new Date();
      
      // Only check games at least 4 hours old
      if (gameDate > new Date(today.getTime() - 4 * 60 * 60 * 1000)) {
        return null;
      }

      // Try ESPN API (free)
      return await this.getGameResultFromESPN(suggestion);

    } catch (error) {
      logger.error('Error getting game result:', error);
      return null;
    }
  }

  /**
   * Get game result from ESPN API
   */
  async getGameResultFromESPN(suggestion) {
    try {
      const sportMap = {
        'NFL': 'football/nfl',
        'NBA': 'basketball/nba',
        'MLB': 'baseball/mlb',
        'NHL': 'hockey/nhl'
      };

      const sportPath = sportMap[suggestion.sport];
      if (!sportPath) return null;

      const gameDate = new Date(suggestion.game_date);
      const dateStr = gameDate.toISOString().split('T')[0].replace(/-/g, '');

      const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${dateStr}`;
      const response = await fetch(url);

      if (!response.ok) return null;

      const data = await response.json();
      
      const game = data.events?.find(event => {
        const homeTeam = event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home');
        const awayTeam = event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away');
        
        return (
          this.teamsMatch(homeTeam?.team?.displayName, suggestion.home_team) &&
          this.teamsMatch(awayTeam?.team?.displayName, suggestion.away_team)
        );
      });

      if (!game || game.status?.type?.state !== 'post') {
        return null;
      }

      const homeComp = game.competitions[0].competitors.find(c => c.homeAway === 'home');
      const awayComp = game.competitions[0].competitors.find(c => c.homeAway === 'away');

      return {
        homeScore: parseInt(homeComp.score) || 0,
        awayScore: parseInt(awayComp.score) || 0,
        status: 'completed',
        source: 'espn'
      };

    } catch (error) {
      logger.error('Error fetching from ESPN:', error);
      return null;
    }
  }

  /**
   * Check if team names match (fuzzy matching)
   */
  teamsMatch(name1, name2) {
    if (!name1 || !name2) return false;
    
    const clean1 = name1.toLowerCase().replace(/[^a-z]/g, '');
    const clean2 = name2.toLowerCase().replace(/[^a-z]/g, '');
    
    return clean1.includes(clean2) || clean2.includes(clean1);
  }

  /**
   * Calculate and log model accuracy
   */
  async logModelAccuracy() {
    try {
      const { data, error } = await this.supabase
        .from('ai_suggestions')
        .select('actual_outcome, confidence, bet_type, sport')
        .in('actual_outcome', ['won', 'lost']);

      if (error) throw error;
      if (!data || data.length === 0) {
        logger.info('📊 No resolved suggestions yet for accuracy calculation');
        return;
      }

      const total = data.length;
      const wins = data.filter(s => s.actual_outcome === 'won').length;
      const losses = data.filter(s => s.actual_outcome === 'lost').length;
      const accuracy = ((wins / (wins + losses)) * 100).toFixed(1);

      logger.info(`📊 MODEL ACCURACY: ${accuracy}% (${wins}W-${losses}L out of ${total} resolved suggestions)`);

      // Break down by bet type
      const byType = {};
      data.forEach(s => {
        if (!byType[s.bet_type]) {
          byType[s.bet_type] = { wins: 0, losses: 0 };
        }
        if (s.actual_outcome === 'won') byType[s.bet_type].wins++;
        if (s.actual_outcome === 'lost') byType[s.bet_type].losses++;
      });

      logger.info('📊 Accuracy by bet type:');
      Object.entries(byType).forEach(([type, stats]) => {
        const typeAccuracy = ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1);
        logger.info(`   ${type}: ${typeAccuracy}% (${stats.wins}W-${stats.losses}L)`);
      });

    } catch (error) {
      logger.error('Error calculating model accuracy:', error);
    }
  }
}

module.exports = AISuggestionOutcomeChecker;
