/**
 * AI Suggestion Outcome Checker
 * Checks ALL AI suggestions (not just user-selected ones) to track model accuracy
 * Separate from parlay outcome checking - this tracks AI performance
 */

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../../shared/logger');
const ATSTracker = require('./ats-tracker');
const { teamsMatch: sharedTeamsMatch } = require('../utils/team-matcher');
const OddsApiScores = require('./odds-api-scores');
const ParlayOutcomeChecker = require('./parlay-outcome-checker');
const espnResults = require('./espn-results');

// Soccer h2h is a THREE-WAY market settled on regulation: a draw means an
// ML pick on either team LOST (books don't push 3-way markets), and a
// knockout game decided in extra time or penalties also settles the
// regulation market as a draw. Two-way sports keep push-on-tie.
const SOCCER_SPORTS = new Set(['EPL', 'MLS', 'Soccer', 'World Cup', 'Champions League', 'Copa America', 'Euros']);

class AISuggestionOutcomeChecker {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.atsTracker = new ATSTracker(this.supabase);
    this.oddsApiScores = new OddsApiScores(this.supabase);
    // Reuse parlay-side prop logic (extractPlayerName, ESPN box-score fetch,
    // stat-line comparison) instead of duplicating ~150 lines.
    this.parlayChecker = new ParlayOutcomeChecker();
  }

  /**
   * Check all pending AI suggestions and update outcomes
   * This tracks MODEL ACCURACY - not user parlay outcomes
   */
  async checkAllPendingSuggestions({ daysBack = 7 } = {}) {
    try {
      logger.info(`🤖 Starting AI suggestion outcome check (daysBack=${daysBack})...`);

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysBack);

      const { data: pendingSuggestions, error } = await this.supabase
        .from('ai_suggestions')
        .select('*')
        .eq('actual_outcome', 'pending')
        .gte('game_date', cutoff.toISOString().split('T')[0])
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
        // UFC cards scratch and replace fights late. A UFC pick with no
        // score match three days after start time is a scratched or
        // replaced bout. Void it (stake returned, excluded from the
        // record) instead of leaving it pending forever.
        const isUfc = suggestion.sport === 'UFC' || suggestion.sport === 'MMA';
        const startMs = suggestion.game_date ? new Date(suggestion.game_date).getTime() : null;
        if (isUfc && startMs && Date.now() - startMs > 3 * 24 * 60 * 60 * 1000) {
          const { error: voidErr } = await this.supabase
            .from('ai_suggestions')
            .update({ actual_outcome: 'void', resolved_at: new Date().toISOString() })
            .eq('id', suggestion.id);
          if (!voidErr) {
            logger.info(`✅ AI suggestion ${suggestion.id}: void (unmatched UFC bout 3+ days old, likely scratched)`);
            return { updated: true, outcome: 'void' };
          }
        }
        logger.info(`  No result found yet`);
        return { updated: false, reason: 'Game not completed' };
      }

      logger.info(`  Found result: ${gameResult.awayScore}-${gameResult.homeScore}`);

      // Record ATS data for this game (fire and forget)
      try {
        await this.atsTracker.recordATS({
          home_team_name: suggestion.home_team,
          away_team_name: suggestion.away_team,
          home_score: gameResult.homeScore,
          away_score: gameResult.awayScore,
          sport: suggestion.sport,
          date: suggestion.game_date ? new Date(suggestion.game_date).toISOString().split('T')[0] : null
        });
      } catch (e) { /* don't block settlement */ }

      // Determine if AI suggestion was correct
      const outcome = await this.determineSuggestionOutcome(suggestion, gameResult);

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
  async determineSuggestionOutcome(suggestion, gameResult) {
    const betType = suggestion.bet_type;
    const scoreDiff = gameResult.homeScore - gameResult.awayScore;

    // Tennis + UFC are graded as 1-0 win/loss only. Spreads and totals in
    // these sports require per-set/per-round data we don't yet capture, so
    // those bet types stay pending rather than being graded incorrectly
    // against the synthetic 1-0 score.
    if ((suggestion.sport === 'Tennis' || suggestion.sport === 'UFC' || suggestion.sport === 'MMA')
        && betType !== 'Moneyline') {
      return null;
    }

    switch (betType) {
      case 'Moneyline':
        return this.checkMoneylineOutcome(suggestion, scoreDiff, gameResult);

      case 'Spread':
        return this.checkSpreadOutcome(suggestion, scoreDiff);

      case 'Total':
      case 'Totals (O/U)':
        return this.checkTotalOutcome(suggestion, gameResult);

      case 'Player Props':
      case 'TD Props':
      case 'Player Pass TDs':
      case 'Player Rush Yards':
      case 'Player Receptions': {
        // Real prop settlement: extract player name from the pick string,
        // fetch ESPN box score for the game, compare line vs actual stat.
        // Returns null when stats can't be found yet (suggestion stays pending).
        // Used to auto-push, which silently dropped 77 picks out of W-L sample.
        const propResult = await this.parlayChecker.checkPlayerPropOutcome(suggestion, gameResult);
        return propResult || null;
      }

      default:
        logger.warn(`Unknown bet type: ${betType}`);
        return null;
    }
  }

  /**
   * Check moneyline outcome
   */
  checkMoneylineOutcome(suggestion, scoreDiff, gameResult = null) {
    const pick = suggestion.pick || '';
    const homeTeam = suggestion.home_team || '';

    // Draw is a first-class 1X2 side and its pick text carries no team
    // name ("Draw +260"), so it must be handled BEFORE team matching.
    // Without this branch a Draw pick falls through pickedHome=false and
    // settles as if it were an away-team pick. A draw wins when regulation
    // ends level, which includes knockout games decided in extra time or
    // penalties. Draws never push.
    if (/^draw\b/i.test(pick.trim())) {
      const regulationLevel = scoreDiff === 0 || !!gameResult?.wentToExtraTime;
      return { result: regulationLevel ? 'won' : 'lost' };
    }

    const pickedHome = pick.toLowerCase().includes(homeTeam.toLowerCase());

    const isSoccer = SOCCER_SPORTS.has(suggestion.sport);
    if (isSoccer && gameResult?.wentToExtraTime) {
      // Decided after regulation, so the 3-way market settled as a draw.
      return { result: 'lost' };
    }
    if (scoreDiff === 0) {
      return { result: isSoccer ? 'lost' : 'push' };
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

      // Soccer grades a THREE-WAY regulation market, and only game_results
      // (ESPN-backed) knows whether a game went to extra time, so check it
      // first for soccer. Everything else asks Odds API /scores first (same
      // vocabulary as ai_suggestions, exact name match).
      if (SOCCER_SPORTS.has(suggestion.sport)) {
        const dbFirst = await this.getGameResultFromDB(suggestion);
        if (dbFirst) return dbFirst;
      }

      const oddsResult = await this.oddsApiScores.findGameResult({
        sport: suggestion.sport,
        home_team: suggestion.home_team,
        away_team: suggestion.away_team,
        game_date: suggestion.game_date,
      });
      if (oddsResult) return oddsResult;

      // Then game_results table (ESPN-backed backfill, fuzzy matched)
      const dbResult = await this.getGameResultFromDB(suggestion);
      if (dbResult) return dbResult;

      // Last resort: live ESPN fetch (limited sport coverage)
      return await this.getGameResultFromESPN(suggestion);

    } catch (error) {
      logger.error('Error getting game result:', error);
      return null;
    }
  }

  /**
   * Get game result from game_results table (populated by backfill cron)
   */
  async getGameResultFromDB(suggestion) {
    try {
      const gameDate = new Date(suggestion.game_date);
      const gameDateStr = gameDate.toISOString().split('T')[0];
      const dayBefore = new Date(gameDate.getTime() - 86400000).toISOString().split('T')[0];
      const dayAfter = new Date(gameDate.getTime() + 86400000).toISOString().split('T')[0];

      const { data: games, error } = await this.supabase
        .from('game_results')
        .select('home_team_name, away_team_name, home_score, away_score, status, metadata')
        .eq('sport', suggestion.sport)
        .in('date', [dayBefore, gameDateStr, dayAfter])
        .eq('status', 'final');

      if (error || !games?.length) return null;

      const match = games.find(g =>
        this.teamsMatch(g.home_team_name, suggestion.home_team) &&
        this.teamsMatch(g.away_team_name, suggestion.away_team)
      ) || games.find(g =>
        this.teamsMatch(g.home_team_name, suggestion.away_team) &&
        this.teamsMatch(g.away_team_name, suggestion.home_team)
      );

      if (!match) return null;

      // Check if home/away are reversed vs suggestion
      const reversed = this.teamsMatch(match.home_team_name, suggestion.away_team);
      const espnStatus = match.metadata?.espn_status;
      return {
        homeScore: reversed ? match.away_score : match.home_score,
        awayScore: reversed ? match.home_score : match.away_score,
        wentToExtraTime: espnStatus === 'STATUS_AFTER_EXTRA_TIME' || espnStatus === 'STATUS_END_PENALTY_SHOOTOUT',
        status: 'completed',
        source: 'game_results_db'
      };
    } catch (error) {
      logger.error('Error fetching from game_results:', error);
      return null;
    }
  }

  /**
   * Get game result from ESPN. Delegated to the shared espnResults module so
   * Tennis (groupings parser) and UFC (core API drill-down) share the same
   * code path as standard team sports. The legacy inline implementation only
   * handled the team-sport shape and silently skipped Tennis + UFC.
   */
  async getGameResultFromESPN(suggestion) {
    try {
      return await espnResults.resolveResult(suggestion);
    } catch (error) {
      logger.error('Error fetching from ESPN:', error);
      return null;
    }
  }

  /**
   * Check if team names match. Delegates to shared utility
   */
  teamsMatch(name1, name2) {
    return sharedTeamsMatch(name1, name2);
  }

  /**
   * Calculate and log model accuracy (DEDUPLICATED)
   * Same pick shown to multiple users = counts once
   */
  async logModelAccuracy() {
    try {
      // Get ALL resolved suggestions
      const { data, error } = await this.supabase
        .from('ai_suggestions')
        .select('game_date, home_team, away_team, bet_type, pick, point, actual_outcome, sport, confidence')
        .in('actual_outcome', ['won', 'lost']);

      if (error) throw error;
      if (!data || data.length === 0) {
        logger.info('📊 No resolved suggestions yet for accuracy calculation');
        return;
      }

      // DEDUPLICATE: Same pick = same game + bet type + pick + line
      const uniquePicks = new Map();
      data.forEach(s => {
        const key = `${s.game_date}|${s.home_team}|${s.away_team}|${s.bet_type}|${s.pick}|${s.point}`;
        if (!uniquePicks.has(key)) {
          uniquePicks.set(key, s);
        }
      });

      const deduped = Array.from(uniquePicks.values());
      const total = deduped.length;
      const wins = deduped.filter(s => s.actual_outcome === 'won').length;
      const losses = deduped.filter(s => s.actual_outcome === 'lost').length;
      const accuracy = ((wins / (wins + losses)) * 100).toFixed(1);

      logger.info(`📊 MODEL ACCURACY (DEDUPLICATED): ${accuracy}% (${wins}W-${losses}L out of ${total} unique picks)`);
      logger.info(`   Original count: ${data.length} suggestions → Unique: ${total} picks`);

      // Break down by bet type
      const byType = {};
      deduped.forEach(s => {
        if (!byType[s.bet_type]) {
          byType[s.bet_type] = { wins: 0, losses: 0 };
        }
        if (s.actual_outcome === 'won') byType[s.bet_type].wins++;
        if (s.actual_outcome === 'lost') byType[s.bet_type].losses++;
      });

      logger.info('📊 Accuracy by bet type (deduplicated):');
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
