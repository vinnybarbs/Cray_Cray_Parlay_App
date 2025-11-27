/**
 * AI Suggestion Checker Service
 * Validates AI pick suggestions against actual game outcomes
 * Tracks model performance independently of user bets
 */

class AISuggestionChecker {
  constructor(supabase) {
    if (!supabase) {
      throw new Error('AISuggestionChecker requires Supabase client');
    }
    this.supabase = supabase;
  }

  /**
   * Check all pending AI suggestions against game results
   * @returns {Promise<Object>} Summary of checks performed
   */
  async checkAllPendingSuggestions() {
    try {
      console.log('🤖 Checking pending AI suggestions...');

      // Get all pending suggestions for games that should be finished
      const { data: suggestions, error } = await this.supabase
        .from('ai_suggestions')
        .select('*')
        .eq('actual_outcome', 'pending')
        .lte('game_date', new Date().toISOString());

      if (error) throw error;

      if (!suggestions || suggestions.length === 0) {
        console.log('📭 No pending AI suggestions to check');
        return { checked: 0, resolved: 0, still_pending: 0 };
      }

      console.log(`📊 Found ${suggestions.length} pending AI suggestions`);

      let resolvedCount = 0;
      let stillPendingCount = 0;

      for (const suggestion of suggestions) {
        try {
          const resolved = await this.checkSuggestion(suggestion);
          if (resolved) {
            resolvedCount++;
          } else {
            stillPendingCount++;
          }
        } catch (error) {
          console.error(`❌ Error checking suggestion ${suggestion.id}:`, error.message);
          stillPendingCount++;
        }
      }

      const summary = {
        checked: suggestions.length,
        resolved: resolvedCount,
        still_pending: stillPendingCount
      };

      console.log(`✅ AI suggestions check complete:`, summary);
      return summary;

    } catch (error) {
      console.error('❌ Error in checkAllPendingSuggestions:', error);
      throw error;
    }
  }

  /**
   * Check a single AI suggestion
   * @param {Object} suggestion - AI suggestion object
   * @returns {Promise<boolean>} True if resolved, false if still pending
   */
  async checkSuggestion(suggestion) {
    try {
      // Find matching game result
      const gameResult = await this.findMatchingGame(suggestion);

      if (!gameResult) {
        // Game not found or not finished yet
        return false;
      }

      // Game is finished, determine outcome
      const outcome = this.determineOutcome(suggestion, gameResult);

      // Update suggestion with outcome
      await this.updateSuggestionOutcome(suggestion.id, outcome);

      return true;

    } catch (error) {
      console.error(`Error checking suggestion ${suggestion.id}:`, error.message);
      return false;
    }
  }

  /**
   * Find matching game result for a suggestion
   * @param {Object} suggestion - AI suggestion object
   * @returns {Promise<Object|null>} Game result or null
   */
  async findMatchingGame(suggestion) {
    try {
      // Try exact ESPN event ID match first (if available)
      if (suggestion.espn_event_id) {
        const { data: exactMatch, error: exactError } = await this.supabase
          .from('game_results')
          .select('*')
          .eq('espn_event_id', suggestion.espn_event_id)
          .eq('status', 'final')
          .single();

        if (!exactError && exactMatch) {
          return exactMatch;
        }
      }

      // Fallback: Match by teams and date
      const gameDate = new Date(suggestion.game_date);
      const gameDateStr = gameDate.toISOString().split('T')[0]; // YYYY-MM-DD

      const { data: games, error } = await this.supabase
        .from('game_results')
        .select('*')
        .eq('sport', suggestion.sport)
        .eq('game_date', gameDateStr)
        .eq('status', 'final');

      if (error) throw error;

      if (!games || games.length === 0) {
        return null;
      }

      // Find best team name match
      const match = games.find(game => 
        this.teamsMatch(game.home_team, suggestion.home_team) &&
        this.teamsMatch(game.away_team, suggestion.away_team)
      );

      return match || null;

    } catch (error) {
      console.error('Error finding matching game:', error);
      return null;
    }
  }

  /**
   * Check if two team names match (fuzzy matching)
   * @param {string} team1 - First team name
   * @param {string} team2 - Second team name
   * @returns {boolean}
   */
  teamsMatch(team1, team2) {
    if (!team1 || !team2) return false;

    const normalize = (str) => str.toLowerCase().trim();
    const t1 = normalize(team1);
    const t2 = normalize(team2);

    // Exact match
    if (t1 === t2) return true;

    // One contains the other
    if (t1.includes(t2) || t2.includes(t1)) return true;

    // Extract last word (usually team name)
    const getLastWord = (str) => str.split(' ').pop();
    if (getLastWord(t1) === getLastWord(t2)) return true;

    return false;
  }

  /**
   * Determine outcome of a suggestion based on game result
   * @param {Object} suggestion - AI suggestion
   * @param {Object} gameResult - Game result
   * @returns {string} Outcome ('won', 'lost', 'push')
   */
  determineOutcome(suggestion, gameResult) {
    const { home_score, away_score } = gameResult;

    // Handle null scores
    if (home_score === null || away_score === null) {
      return 'pending';
    }

    switch (suggestion.bet_type) {
      case 'Moneyline':
        return this.determineMoneylineOutcome(suggestion, gameResult);
      
      case 'Spread':
        return this.determineSpreadOutcome(suggestion, gameResult);
      
      case 'Totals':
      case 'Total':
        return this.determineTotalsOutcome(suggestion, gameResult);
      
      case 'Player Props':
      case 'TD':
        // Player props require additional data (player stats)
        // For now, mark as pending - will handle in Phase 2
        return 'pending';
      
      default:
        console.warn(`Unknown bet type: ${suggestion.bet_type}`);
        return 'pending';
    }
  }

  /**
   * Determine moneyline outcome
   */
  determineMoneylineOutcome(suggestion, gameResult) {
    const { home_score, away_score, home_team } = gameResult;
    const winner = home_score > away_score ? home_team : gameResult.away_team;
    
    // Check if suggestion pick matches winner
    const pickLower = suggestion.pick.toLowerCase();
    const winnerLower = winner.toLowerCase();
    
    if (pickLower.includes(winnerLower) || winnerLower.includes(pickLower)) {
      return 'won';
    }
    
    // Check for tie
    if (home_score === away_score) {
      return 'push';
    }
    
    return 'lost';
  }

  /**
   * Determine spread outcome
   */
  determineSpreadOutcome(suggestion, gameResult) {
    const { home_score, away_score, home_team, away_team } = gameResult;
    const line = parseFloat(suggestion.point) || 0;

    // Determine which team was picked
    const pickLower = suggestion.pick.toLowerCase();
    const homeTeamLower = home_team.toLowerCase();
    const pickedHome = pickLower.includes(homeTeamLower) || homeTeamLower.includes(pickLower);

    // Apply spread
    const adjustedHomeScore = pickedHome ? home_score + line : home_score - line;
    
    // Determine outcome
    if (adjustedHomeScore > away_score) {
      return 'won';
    } else if (adjustedHomeScore === away_score) {
      return 'push';
    } else {
      return 'lost';
    }
  }

  /**
   * Determine totals outcome
   */
  determineTotalsOutcome(suggestion, gameResult) {
    const { home_score, away_score } = gameResult;
    const actualTotal = home_score + away_score;
    const line = parseFloat(suggestion.point) || 0;

    const isOver = suggestion.pick.toLowerCase().includes('over');

    if (actualTotal === line) {
      return 'push';
    }

    if (isOver) {
      return actualTotal > line ? 'won' : 'lost';
    } else {
      return actualTotal < line ? 'won' : 'lost';
    }
  }

  /**
   * Update suggestion outcome in database
   * @param {number} suggestionId - Suggestion ID
   * @param {string} outcome - Outcome ('won', 'lost', 'push')
   * @returns {Promise}
   */
  async updateSuggestionOutcome(suggestionId, outcome) {
    try {
      const { error } = await this.supabase
        .from('ai_suggestions')
        .update({
          actual_outcome: outcome,
          resolved_at: new Date().toISOString()
        })
        .eq('id', suggestionId);

      if (error) throw error;

      console.log(`✅ Updated suggestion ${suggestionId}: ${outcome}`);

    } catch (error) {
      console.error(`❌ Error updating suggestion ${suggestionId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get AI model performance stats
   * @param {Object} options - Filter options
   * @returns {Promise<Object>} Performance stats
   */
  async getModelPerformance(options = {}) {
    try {
      let query = this.supabase
        .from('ai_suggestions')
        .select('*')
        .in('actual_outcome', ['won', 'lost', 'push']);

      // Apply filters
      if (options.sport) {
        query = query.eq('sport', options.sport);
      }
      if (options.bet_type) {
        query = query.eq('bet_type', options.bet_type);
      }
      if (options.days) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - options.days);
        query = query.gte('created_at', cutoff.toISOString());
      }

      const { data, error } = await query;

      if (error) throw error;

      const total = data.length;
      const wins = data.filter(s => s.actual_outcome === 'won').length;
      const losses = data.filter(s => s.actual_outcome === 'lost').length;
      const pushes = data.filter(s => s.actual_outcome === 'push').length;

      const winRate = total > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : 0;

      return {
        total_suggestions: total,
        wins,
        losses,
        pushes,
        win_rate: parseFloat(winRate),
        filters: options
      };

    } catch (error) {
      console.error('Error getting model performance:', error);
      throw error;
    }
  }
}

module.exports = { AISuggestionChecker };
