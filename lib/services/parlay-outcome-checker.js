/**
 * Parlay Outcome Checker Service
 * Automatically checks pending parlays against game results and updates outcomes
 */

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../../shared/logger');

class ParlayOutcomeChecker {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Team name mappings for different APIs
    this.teamMappings = {
      // NFL mappings
      'Kansas City Chiefs': ['KC', 'Kansas City', 'Chiefs'],
      'Buffalo Bills': ['BUF', 'Buffalo', 'Bills'],
      'Los Angeles Chargers': ['LAC', 'LA Chargers', 'Chargers'],
      'Pittsburgh Steelers': ['PIT', 'Pittsburgh', 'Steelers'],
      'Detroit Lions': ['DET', 'Detroit', 'Lions'],
      'Washington Commanders': ['WAS', 'Washington', 'Commanders'],
      // Add more team mappings as needed
    };
  }

  /**
   * Check all pending parlays and update outcomes
   */
  async checkAllPendingParlays() {
    try {
      logger.info('🔍 Starting parlay outcome check...');

      // Get all pending parlays
      const { data: pendingParlays, error } = await this.supabase
        .from('parlays')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (!pendingParlays?.length) {
        logger.info('No pending parlays found');
        return { checked: 0, updated: 0 };
      }

      logger.info(`Found ${pendingParlays.length} pending parlays`);

      let updatedCount = 0;
      
      for (const parlay of pendingParlays) {
        try {
          const result = await this.checkParlayOutcome(parlay);
          if (result.updated) {
            updatedCount++;
          }
        } catch (error) {
          logger.error(`Error checking parlay ${parlay.id}:`, error);
        }
      }

      logger.info(`✅ Parlay outcome check complete: ${updatedCount}/${pendingParlays.length} updated`);
      
      return {
        checked: pendingParlays.length,
        updated: updatedCount
      };

    } catch (error) {
      logger.error('Error in checkAllPendingParlays:', error);
      throw error;
    }
  }

  /**
   * Check outcome for a single parlay
   */
  async checkParlayOutcome(parlay) {
    try {
      // Fetch ai_suggestions for this parlay
      const { data: picks, error: picksError } = await this.supabase
        .from('ai_suggestions')
        .select('*')
        .eq('parlay_id', parlay.id);

      if (picksError) {
        logger.error(`Error fetching picks for parlay ${parlay.id}:`, picksError);
        throw picksError;
      }

      logger.info(`Checking parlay ${parlay.id} with ${picks?.length || 0} picks`);

      let allLegsResolved = true;
      let wonLegs = 0;
      let lostLegs = 0;
      let pushLegs = 0;
      
      const legUpdates = [];

      for (const leg of picks) {
        // Skip legs that are already resolved
        if (leg.actual_outcome && leg.actual_outcome !== 'pending') {
          if (leg.actual_outcome === 'won') wonLegs++;
          else if (leg.actual_outcome === 'lost') lostLegs++;
          else if (leg.actual_outcome === 'push') pushLegs++;
          continue;
        }

        // Check if the game has completed
        const gameResult = await this.getGameResult(leg);
        
        if (!gameResult) {
          allLegsResolved = false;
          continue; // Game not completed yet
        }

        // Determine leg outcome based on bet type
        const legOutcome = this.determineLegOutcome(leg, gameResult);
        
        if (legOutcome) {
          legUpdates.push({
            legId: leg.id,
            result: legOutcome.result,
            actualValue: legOutcome.actualValue,
            marginOfVictory: legOutcome.marginOfVictory
          });

          if (legOutcome.result === 'won') wonLegs++;
          else if (legOutcome.result === 'lost') lostLegs++;
          else if (legOutcome.result === 'push') pushLegs++;
        } else {
          allLegsResolved = false;
        }
      }

      // Update individual legs
      for (const update of legUpdates) {
        await this.updateLegOutcome(update);
      }

      // If all legs are resolved, update parlay outcome
      if (allLegsResolved) {
        const parlayOutcome = this.calculateParlayOutcome(wonLegs, lostLegs, pushLegs);
        await this.updateParlayOutcome(parlay.id, parlayOutcome, parlay);
        
        logger.info(`✅ Updated parlay ${parlay.id}: ${parlayOutcome.outcome}`);
        return { updated: true, outcome: parlayOutcome };
      } else {
        logger.info(`⏳ Parlay ${parlay.id} still has unresolved games`);
        return { updated: false, reason: 'Games pending' };
      }

    } catch (error) {
      logger.error(`Error checking parlay ${parlay.id}:`, error);
      return { updated: false, error: error.message };
    }
  }

  /**
   * Get game result from sports API
   */
  async getGameResult(leg) {
    try {
      const gameDate = new Date(leg.game_date);
      const today = new Date();
      
      // Only check games that should be completed (at least 4 hours after game date)
      if (gameDate > new Date(today.getTime() - 4 * 60 * 60 * 1000)) {
        return null; // Game likely not finished yet
      }

      // Try API-Sports first (if configured)
      if (process.env.APISPORTS_API_KEY) {
        const result = await this.getGameResultFromAPISports(leg);
        if (result) return result;
      }

      // Fallback to ESPN API (free)
      return await this.getGameResultFromESPN(leg);

    } catch (error) {
      logger.error('Error getting game result:', error);
      return null;
    }
  }

  /**
   * Get game result from API-Sports
   */
  async getGameResultFromAPISports(leg) {
    try {
      // Map sport to API-Sports league ID
      const leagueMap = {
        'NFL': 1,
        'NBA': 12,
        'MLB': 1,
        'NHL': 61
      };

      const leagueId = leagueMap[leg.sport];
      if (!leagueId) return null;

      const gameDate = new Date(leg.game_date).toISOString().split('T')[0];
      
      const response = await fetch(`https://v1.api-sports.io/games?league=${leagueId}&date=${gameDate}`, {
        headers: {
          'X-RapidAPI-Key': process.env.APISPORTS_API_KEY,
          'X-RapidAPI-Host': 'v1.api-sports.io'
        }
      });

      if (!response.ok) return null;

      const data = await response.json();
      
      // Find the matching game
      const game = data.response?.find(g => 
        this.teamsMatch(g.teams.home.name, leg.home_team) &&
        this.teamsMatch(g.teams.away.name, leg.away_team)
      );

      if (!game || game.fixture.status.short !== 'FT') {
        return null; // Game not found or not finished
      }

      return {
        homeScore: game.goals?.home || game.scores?.home?.total || 0,
        awayScore: game.goals?.away || game.scores?.away?.total || 0,
        status: 'completed',
        source: 'api-sports'
      };

    } catch (error) {
      logger.error('Error fetching from API-Sports:', error);
      return null;
    }
  }

  /**
   * Get game result from ESPN API (free fallback)
   */
  async getGameResultFromESPN(leg) {
    try {
      // ESPN API endpoints by sport
      const espnEndpoints = {
        'NFL': 'http://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
        'NBA': 'http://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
        'MLB': 'http://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
        'NHL': 'http://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard'
      };

      const endpoint = espnEndpoints[leg.sport];
      if (!endpoint) return null;

      const gameDate = new Date(leg.game_date);
      const dateStr = gameDate.toISOString().split('T')[0].replace(/-/g, '');
      
      const response = await fetch(`${endpoint}?dates=${dateStr}`);
      if (!response.ok) return null;

      const data = await response.json();
      
      // Find matching game
      const game = data.events?.find(event => {
        const competition = event.competitions[0];
        const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
        const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
        
        return this.teamsMatch(homeTeam.team.displayName, leg.home_team) &&
               this.teamsMatch(awayTeam.team.displayName, leg.away_team);
      });

      if (!game) return null;

      const competition = game.competitions[0];
      const status = competition.status;
      
      // Check if game is completed
      if (status.type.completed !== true) {
        return null;
      }

      const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
      const awayTeam = competition.competitors.find(c => c.homeAway === 'away');

      return {
        homeScore: parseInt(homeTeam.score) || 0,
        awayScore: parseInt(awayTeam.score) || 0,
        status: 'completed',
        source: 'espn'
      };

    } catch (error) {
      logger.error('Error fetching from ESPN:', error);
      return null;
    }
  }

  /**
   * Check if team names match accounting for variations
   */
  teamsMatch(apiTeamName, legTeamName) {
    if (!apiTeamName || !legTeamName) return false;
    
    // Direct match
    if (apiTeamName.toLowerCase() === legTeamName.toLowerCase()) {
      return true;
    }

    // Check mappings
    const mappings = this.teamMappings[legTeamName] || [];
    return mappings.some(variant => 
      apiTeamName.toLowerCase().includes(variant.toLowerCase()) ||
      variant.toLowerCase().includes(apiTeamName.toLowerCase())
    );
  }

  /**
   * Determine leg outcome based on bet type and game result
   */
  determineLegOutcome(leg, gameResult) {
    try {
      // Construct bet_details from ai_suggestions fields
      const betDetails = {
        description: leg.pick,
        line: leg.point ? parseFloat(leg.point) : 0,
        pick: leg.pick
      };

      const homeScore = gameResult.homeScore;
      const awayScore = gameResult.awayScore;
      const scoreDiff = homeScore - awayScore; // Positive = home wins

      switch (leg.bet_type?.toLowerCase()) {
        case 'moneyline':
        case 'moneyline/spread':
          return this.checkMoneylineOutcome(leg, betDetails, scoreDiff, homeScore, awayScore);
          
        case 'spread':
          return this.checkSpreadOutcome(leg, betDetails, scoreDiff, homeScore, awayScore);
          
        case 'total':
        case 'totals (o/u)':
        case 'over/under':
          return this.checkTotalOutcome(leg, betDetails, homeScore + awayScore);
          
        default:
          logger.warn(`Unknown bet type: ${leg.bet_type}`);
          return null;
      }
      
    } catch (error) {
      logger.error('Error determining leg outcome:', error);
      return null;
    }
  }

  /**
   * Check moneyline bet outcome
   */
  checkMoneylineOutcome(leg, betDetails, scoreDiff, homeScore, awayScore) {
    const pick = leg.pick || '';
    const homeTeam = leg.home_team || '';
    const awayTeam = leg.away_team || '';
    
    // Determine which team was picked
    let pickedHome = pick.toLowerCase().includes(homeTeam.toLowerCase());
    let pickedAway = pick.toLowerCase().includes(awayTeam.toLowerCase());
    
    // If still unclear, check the description
    if (!pickedHome && !pickedAway) {
      const description = betDetails.description?.toLowerCase() || '';
      pickedHome = description.includes('home');
      pickedAway = description.includes('away');
    }

    if (scoreDiff === 0) {
      return { result: 'push', actualValue: 0, marginOfVictory: 0 };
    }

    let teamWon = false;
    if (pickedHome) {
      teamWon = scoreDiff > 0; // Home team won
    } else if (pickedAway) {
      teamWon = scoreDiff < 0; // Away team won
    } else {
      logger.warn(`Could not determine picked team for leg ${leg.id}`);
      return null;
    }

    return {
      result: teamWon ? 'won' : 'lost',
      actualValue: scoreDiff,
      marginOfVictory: Math.abs(scoreDiff)
    };
  }

  /**
   * Check spread bet outcome
   */
  checkSpreadOutcome(leg, betDetails, scoreDiff, homeScore, awayScore) {
    const line = leg.point ? parseFloat(leg.point) : 0;
    const pick = leg.pick || '';
    const homeTeam = leg.home_team || '';
    
    // Determine if betting on home or away team
    const pickedHome = pick.toLowerCase().includes(homeTeam.toLowerCase());
    
    let adjustedDiff;
    if (pickedHome) {
      adjustedDiff = scoreDiff - line; // Home team with spread (e.g., -3.5)
    } else {
      adjustedDiff = -scoreDiff - line; // Away team with spread
    }

    if (adjustedDiff === 0) {
      return { result: 'push', actualValue: adjustedDiff, marginOfVictory: 0 };
    }

    return {
      result: adjustedDiff > 0 ? 'won' : 'lost',
      actualValue: adjustedDiff,
      marginOfVictory: Math.abs(adjustedDiff)
    };
  }

  /**
   * Check total (over/under) bet outcome
   */
  checkTotalOutcome(leg, betDetails, totalScore) {
    const line = leg.point ? parseFloat(leg.point) : 0;
    const pick = leg.pick || '';
    
    const isOver = pick.toLowerCase().includes('over');
    const diff = totalScore - line;

    if (diff === 0) {
      return { result: 'push', actualValue: diff, marginOfVictory: 0 };
    }

    const won = isOver ? diff > 0 : diff < 0;
    
    return {
      result: won ? 'won' : 'lost',
      actualValue: diff,
      marginOfVictory: Math.abs(diff)
    };
  }

  /**
   * Calculate overall parlay outcome
   */
  calculateParlayOutcome(wonLegs, lostLegs, pushLegs) {
    // If any leg lost, parlay loses
    if (lostLegs > 0) {
      return {
        outcome: 'lost',
        hitPercentage: (wonLegs / (wonLegs + lostLegs + pushLegs)) * 100
      };
    }

    // If all legs won (pushes don't count as losses)
    if (wonLegs > 0 && lostLegs === 0) {
      return {
        outcome: 'won',
        hitPercentage: 100
      };
    }

    // All pushes
    if (pushLegs > 0 && wonLegs === 0 && lostLegs === 0) {
      return {
        outcome: 'push',
        hitPercentage: 0
      };
    }

    return {
      outcome: 'pending',
      hitPercentage: 0
    };
  }

  /**
   * Update individual leg outcome in database
   */
  async updateLegOutcome(update) {
    try {
      const { error } = await this.supabase
        .from('ai_suggestions')
        .update({
          actual_outcome: update.result,
          resolved_at: new Date().toISOString()
        })
        .eq('id', update.legId);

      if (error) throw error;
      
      logger.info(`Updated leg ${update.legId}: ${update.result}`);
      
    } catch (error) {
      logger.error(`Error updating leg ${update.legId}:`, error);
      throw error;
    }
  }

  /**
   * Update parlay outcome in database
   */
  async updateParlayOutcome(parlayId, outcome, parlay) {
    try {
      // Calculate profit/loss if parlay won
      let profitLoss = 0;
      if (outcome.outcome === 'won') {
        // Assume $100 bet for calculation
        const betAmount = 100;
        const payout = parlay.potential_payout || 0;
        profitLoss = payout - betAmount;
      } else if (outcome.outcome === 'lost') {
        profitLoss = -100; // Lost the bet amount
      }

      const { error } = await this.supabase
        .from('parlays')
        .update({
          status: 'completed',
          final_outcome: outcome.outcome,
          hit_percentage: outcome.hitPercentage,
          profit_loss: profitLoss,
          updated_at: new Date().toISOString()
        })
        .eq('id', parlayId);

      if (error) throw error;
      
      logger.info(`Updated parlay ${parlayId}: ${outcome.outcome} (P&L: $${profitLoss})`);
      
    } catch (error) {
      logger.error(`Error updating parlay ${parlayId}:`, error);
      throw error;
    }
  }

  /**
   * Manual override for parlay outcome (for UI)
   */
  async manualOverride(parlayId, outcome, profitLoss = null) {
    try {
      const updates = {
        status: 'completed',
        final_outcome: outcome,
        updated_at: new Date().toISOString()
      };

      if (profitLoss !== null) {
        updates.profit_loss = profitLoss;
      }

      const { error } = await this.supabase
        .from('parlays')
        .update(updates)
        .eq('id', parlayId);

      if (error) throw error;
      
      logger.info(`Manual override for parlay ${parlayId}: ${outcome}`);
      return { success: true };
      
    } catch (error) {
      logger.error(`Error with manual override for parlay ${parlayId}:`, error);
      throw error;
    }
  }
}

module.exports = ParlayOutcomeChecker;