/**
 * Parlay Outcome Checker Service
 * Automatically checks pending parlays against game results and updates outcomes
 */

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../../shared/logger');
const { teamsMatch: sharedTeamsMatch } = require('../utils/team-matcher');
const OddsApiScores = require('./odds-api-scores');
const espnResults = require('./espn-results');

class ParlayOutcomeChecker {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.oddsApiScores = new OddsApiScores(this.supabase);
    
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
      // Fetch parlay_legs for this parlay
      let { data: picks, error: picksError } = await this.supabase
        .from('parlay_legs')
        .select('*')
        .eq('parlay_id', parlay.id)
        .order('leg_number', { ascending: true });

      if (picksError) {
        logger.error(`Error fetching legs for parlay ${parlay.id}:`, picksError);
        throw picksError;
      }

      // FALLBACK: If no parlay_legs exist, backfill from metadata.locked_picks
      if ((!picks || picks.length === 0) && parlay.metadata?.locked_picks?.length > 0) {
        logger.info(`Backfilling parlay_legs from metadata for parlay ${parlay.id}`);
        const legsToInsert = parlay.metadata.locked_picks.map((lp, idx) => ({
          parlay_id: parlay.id,
          leg_number: lp.leg_number || idx + 1,
          game_date: lp.gameDate ? lp.gameDate.split('T')[0] : new Date().toISOString().split('T')[0],
          sport: lp.sport || 'NFL',
          home_team: lp.homeTeam,
          away_team: lp.awayTeam,
          bet_type: lp.betType,
          bet_details: { pick: lp.pick, point: lp.point, spread: lp.spread, locked_odds: lp.odds },
          odds: String(lp.odds || '0'),
          pick_description: `${lp.betType}: ${lp.pick}`,
          pick: lp.pick,
          outcome: 'pending'
        }));

        const { data: inserted, error: insertErr } = await this.supabase
          .from('parlay_legs')
          .insert(legsToInsert)
          .select();

        if (insertErr) {
          logger.error(`Error backfilling legs for ${parlay.id}:`, insertErr.message);
        } else {
          picks = inserted || [];
          logger.info(`Backfilled ${picks.length} legs for parlay ${parlay.id}`);
        }
      }

      if (!picks || picks.length === 0) {
        logger.info(`Parlay ${parlay.id} has no legs and no metadata — skipping`);
        return { updated: false, reason: 'No legs found' };
      }

      logger.info(`Checking parlay ${parlay.id} with ${picks.length} legs`);

      let allLegsResolved = true;
      let wonLegs = 0;
      let lostLegs = 0;
      let pushLegs = 0;
      
      const legUpdates = [];

      for (const leg of picks) {
        // Skip legs that are already resolved
        if (leg.outcome && leg.outcome !== 'pending') {
          if (leg.outcome === 'won') wonLegs++;
          else if (leg.outcome === 'lost') lostLegs++;
          else if (leg.outcome === 'push') pushLegs++;
          continue;
        }

        logger.info(`Checking leg: ${leg.sport} - ${leg.away_team} @ ${leg.home_team} (${leg.game_date}) bet_type=${leg.bet_type}`);

        // Check if the game has completed
        const gameResult = await this.getGameResult(leg);

        if (!gameResult) {
          logger.info(`  No result found for ${leg.sport} game — DB returned null, ESPN returned null`);
          allLegsResolved = false;
          continue; // Game not completed yet
        }

        logger.info(`  Found result: ${gameResult.awayScore}-${gameResult.homeScore} (${gameResult.source})`);

        // Determine leg outcome based on bet type
        const legOutcome = await this.determineLegOutcome(leg, gameResult);
        
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

      // Odds API /scores first — leg names came from Odds API, so exact match
      // works without team-matcher fuzz (handles MLS/EPL accents, UFC, Tennis).
      const oddsResult = await this.oddsApiScores.findGameResult({
        sport: leg.sport,
        home_team: leg.home_team,
        away_team: leg.away_team,
        game_date: leg.game_date,
      });
      if (oddsResult) return oddsResult;

      // Then game_results DB (ESPN-backed backfill, fuzzy matched)
      const dbResult = await this.getGameResultFromDB(leg);
      if (dbResult) return dbResult;

      // Last resort: live ESPN fetch
      return await this.getGameResultFromESPN(leg);

    } catch (error) {
      logger.error('Error getting game result:', error);
      return null;
    }
  }

  /**
   * Get game result from game_results table (populated by backfill cron)
   */
  async getGameResultFromDB(leg) {
    try {
      const gameDateStr = leg.game_date; // parlay_legs.game_date is already a date string
      const gameDate = new Date(gameDateStr);
      const dayBefore = new Date(gameDate.getTime() - 86400000).toISOString().split('T')[0];
      const dayAfter = new Date(gameDate.getTime() + 86400000).toISOString().split('T')[0];

      const { data: games, error } = await this.supabase
        .from('game_results')
        .select('home_team_name, away_team_name, home_score, away_score, status')
        .eq('sport', leg.sport)
        .in('date', [dayBefore, gameDateStr, dayAfter])
        .eq('status', 'final');

      if (error || !games?.length) return null;

      const match = games.find(g =>
        this.teamsMatch(g.home_team_name, leg.home_team) &&
        this.teamsMatch(g.away_team_name, leg.away_team)
      ) || games.find(g =>
        this.teamsMatch(g.home_team_name, leg.away_team) &&
        this.teamsMatch(g.away_team_name, leg.home_team)
      );

      if (!match) return null;

      const reversed = this.teamsMatch(match.home_team_name, leg.away_team);
      logger.info(`  ✓ Found result in DB: ${match.home_team_name} ${match.home_score}-${match.away_score} ${match.away_team_name}`);
      return {
        homeScore: reversed ? match.away_score : match.home_score,
        awayScore: reversed ? match.home_score : match.away_score,
        status: 'completed',
        source: 'game_results_db'
      };
    } catch (error) {
      logger.error('Error fetching from game_results:', error);
      return null;
    }
  }

  /**
   * Get player stats from ESPN API (FALLBACK)
   */
  async getPlayerStatsFromESPN(leg, playerName) {
    try {
      const sportMap = {
        'NFL': 'football/nfl',
        'NBA': 'basketball/nba',
        'NCAAB': 'basketball/mens-college-basketball',
        'MLB': 'baseball/mlb',
        'NHL': 'hockey/nhl'
      };

      const sportPath = sportMap[leg.sport];
      if (!sportPath) return null;

      const gameDate = new Date(leg.game_date);
      const dateStr = gameDate.toISOString().split('T')[0].replace(/-/g, '');

      const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${dateStr}`;
      const response = await fetch(url);

      if (!response.ok) return null;

      const data = await response.json();
      
      // Find the matching game
      const game = data.events?.find(event => {
        const homeTeam = event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home');
        const awayTeam = event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away');
        
        return (
          this.teamsMatch(homeTeam?.team?.displayName, leg.home_team) &&
          this.teamsMatch(awayTeam?.team?.displayName, leg.away_team)
        );
      });

      if (!game || game.status?.type?.state !== 'post') {
        return null; // Game not finished
      }

      // Get box score with player stats
      const gameId = game.id;
      const boxScoreUrl = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${gameId}`;
      const boxResponse = await fetch(boxScoreUrl);
      
      if (!boxResponse.ok) return null;
      
      const boxData = await boxResponse.json();
      
      // Search for player in both teams
      const allPlayers = [];
      boxData.boxscore?.players?.forEach(team => {
        team.statistics?.forEach(statGroup => {
          statGroup.athletes?.forEach(athlete => {
            allPlayers.push({
              name: athlete.athlete.displayName,
              stats: this.parseESPNPlayerStats(athlete.stats, statGroup.labels)
            });
          });
        });
      });

      // Find matching player (fuzzy match)
      const player = allPlayers.find(p => 
        this.playerNamesMatch(p.name, playerName)
      );

      return player?.stats || null;

    } catch (error) {
      logger.error('Error fetching ESPN player stats:', error);
      return null;
    }
  }

  /**
   * Parse ESPN player stats array into usable object
   */
  parseESPNPlayerStats(stats, labels) {
    const statsObj = {};
    labels.forEach((label, index) => {
      const value = stats[index];
      const numValue = parseFloat(value) || 0;
      
      // Map common stat abbreviations
      const key = label.toLowerCase().replace(/\//g, '_');
      statsObj[key] = numValue;
    });
    
    return statsObj;
  }

  /**
   * Check if player names match (fuzzy)
   */
  playerNamesMatch(name1, name2) {
    if (!name1 || !name2) return false;
    
    // Normalize names
    const normalize = (name) => {
      return name.toLowerCase()
        .replace(/[^a-z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };
    
    const n1 = normalize(name1);
    const n2 = normalize(name2);
    
    // Exact match
    if (n1 === n2) return true;
    
    // Last name match (for "Patrick Mahomes" vs "Mahomes")
    const lastName1 = n1.split(' ').pop();
    const lastName2 = n2.split(' ').pop();
    if (lastName1 === lastName2) return true;
    
    return false;
  }

  /**
   * Get game result from ESPN. Delegated to the shared espnResults module so
   * Tennis (groupings parser) and UFC (core API drill-down) work alongside
   * the standard team sports. Pre-refactor this was a 70-line inline impl
   * that handled team sports only.
   */
  async getGameResultFromESPN(leg) {
    try {
      return await espnResults.resolveResult(leg);
    } catch (error) {
      logger.error('Error fetching from ESPN:', error);
      return null;
    }
  }

  /**
   * Check if team names match accounting for variations
   */
  teamsMatch(name1, name2) {
    return sharedTeamsMatch(name1, name2);
  }

  /**
   * Determine leg outcome based on bet type and game result
   */
  async determineLegOutcome(leg, gameResult) {
    try {
      // Handle both old format (leg.point) and new format (leg.bet_details.point)
      const point = leg.point || leg.bet_details?.point;
      
      // Construct bet_details from leg fields
      const betDetails = {
        description: leg.pick,
        line: point ? parseFloat(point) : 0,
        pick: leg.pick
      };

      const homeScore = gameResult.homeScore;
      const awayScore = gameResult.awayScore;
      const scoreDiff = homeScore - awayScore; // Positive = home wins

      const betTypeLower = (leg.bet_type || '').toLowerCase();

      // Tennis + UFC are graded as 1-0 win/loss only. Spreads/totals need
      // per-set or per-round data we don't capture yet, so they stay pending
      // rather than being graded incorrectly against the synthetic 1-0 score.
      if ((leg.sport === 'Tennis' || leg.sport === 'UFC' || leg.sport === 'MMA')
          && betTypeLower !== 'moneyline' && !betTypeLower.includes('player')) {
        return null;
      }

      // Player props
      if (betTypeLower.includes('player') || betTypeLower.includes('td') || betTypeLower.includes('prop')) {
        return await this.checkPlayerPropOutcome(leg, gameResult);
      }

      switch (betTypeLower) {
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
    const point = leg.point || leg.bet_details?.point;
    const line = point ? parseFloat(point) : 0;
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
    const point = leg.point || leg.bet_details?.point;
    const line = point ? parseFloat(point) : 0;
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
   * Check player prop outcome using API-Sports
   */
  async checkPlayerPropOutcome(leg, gameResult) {
    try {
      // Extract player name from pick
      const playerName = this.extractPlayerName(leg.pick);
      if (!playerName) {
        logger.warn(`Could not extract player name from: ${leg.pick}`);
        return null;
      }

      logger.info(`  Checking player prop for: ${playerName}`);

      let playerStats = await this.getPlayerStatsFromESPN(leg, playerName);
      
      if (!playerStats) {
        logger.info(`  No stats found for ${playerName}`);
        return null; // Can't grade yet
      }

      // Determine stat type and check outcome
      const pickLower = (leg.pick || '').toLowerCase();
      let point = leg.point || leg.bet_details?.point;
      let line = point != null ? parseFloat(point) : NaN;

      // If no explicit point stored, try to parse from pick text, e.g.:
      // "Emeka Egbuka Under 4.5 Receptions"
      if (!Number.isFinite(line) && leg.pick) {
        const match = leg.pick.match(/(Over|Under)\s+([0-9]+(?:\.[0-9]+)?)/i);
        if (match) {
          line = parseFloat(match[2]);
        }
      }

      const isOver = pickLower.includes('over');
      const isUnder = pickLower.includes('under');
      const isAnytime = pickLower.includes('anytime td');
      const hasHalfPoint = Number.isFinite(line) && !Number.isInteger(line);

      let actualValue = 0;
      let result = null;

      // Basketball stats (NBA, NCAAB)
      if (pickLower.includes('point')) {
        actualValue = playerStats.pts || playerStats.points || 0;
        logger.info(`  Points: ${actualValue} vs ${line}`);
      }
      else if (pickLower.includes('rebound')) {
        actualValue = playerStats.reb || playerStats.rebounds || 0;
        logger.info(`  Rebounds: ${actualValue} vs ${line}`);
      }
      else if (pickLower.includes('assist')) {
        actualValue = playerStats.ast || playerStats.assists || 0;
        logger.info(`  Assists: ${actualValue} vs ${line}`);
      }
      else if (pickLower.includes('three') || pickLower.includes('3pt') || pickLower.includes('3-pt')) {
        actualValue = playerStats.threes || playerStats['3pt'] || 0;
        logger.info(`  Threes: ${actualValue} vs ${line}`);
      }
      else if (pickLower.includes('steal')) {
        actualValue = playerStats.stl || playerStats.steals || 0;
        logger.info(`  Steals: ${actualValue} vs ${line}`);
      }
      else if (pickLower.includes('block')) {
        actualValue = playerStats.blk || playerStats.blocks || 0;
        logger.info(`  Blocks: ${actualValue} vs ${line}`);
      }
      // Football stats (NFL, NCAAF)
      // Pass Yards
      else if (pickLower.includes('pass') && pickLower.includes('yard')) {
        actualValue = playerStats.passyds || 0;
        logger.info(`  Pass yards: ${actualValue} vs ${line}`);
      }
      // Pass TDs
      else if (pickLower.includes('pass') && pickLower.includes('td')) {
        actualValue = playerStats.passtd || 0;
        logger.info(`  Pass TDs: ${actualValue} vs ${line}`);
      }
      // Rush Yards
      else if (pickLower.includes('rush') && pickLower.includes('yard')) {
        actualValue = playerStats.rushyds || 0;
        logger.info(`  Rush yards: ${actualValue} vs ${line}`);
      }
      // Rush TDs
      else if (pickLower.includes('rush') && pickLower.includes('td')) {
        actualValue = playerStats.rushtd || 0;
        logger.info(`  Rush TDs: ${actualValue}`);
      }
      // Receptions
      else if (pickLower.includes('reception')) {
        actualValue = playerStats.rec || 0;
        logger.info(`  Receptions: ${actualValue} vs ${line}`);
      }
      // Receiving Yards
      else if (pickLower.includes('rec') && pickLower.includes('yard')) {
        actualValue = playerStats.recyds || 0;
        logger.info(`  Rec yards: ${actualValue} vs ${line}`);
      }
      // Receiving TDs
      else if (pickLower.includes('rec') && pickLower.includes('td')) {
        actualValue = playerStats.rectd || 0;
        logger.info(`  Rec TDs: ${actualValue}`);
      }
      // Anytime TD
      else if (isAnytime) {
        const totalTds = (playerStats.passtd || 0) + (playerStats.rushtd || 0) + (playerStats.rectd || 0);
        actualValue = totalTds;
        result = totalTds > 0 ? 'won' : 'lost';
        logger.info(`  Anytime TD: ${totalTds > 0 ? 'YES ✅' : 'NO ❌'}`);
      }
      else {
        logger.warn(`  Unknown prop type: ${pick}`);
        return null;
      }

      // Check over/under if not anytime TD
      if (!isAnytime && Number.isFinite(line)) {
        // Only allow push when the line is an integer (e.g. 4, 46). For half-points like 4.5,
        // there is no push – it must be a win or loss.
        if (!hasHalfPoint && actualValue === line) {
          result = 'push';
        } else if (isOver) {
          result = actualValue > line ? 'won' : 'lost';
        } else if (isUnder) {
          result = actualValue < line ? 'won' : 'lost';
        }
      }

      if (result) {
        logger.info(`  Result: ${result.toUpperCase()}`);
        return { result, actualValue, marginOfVictory: Math.abs(actualValue - line) };
      }

      return null;

    } catch (error) {
      logger.error('Error checking player prop:', error);
      return null;
    }
  }

  /**
   * Extract player name from pick string
   */
  extractPlayerName(pick) {
    // Examples:
    //   "Emeka Egbuka Under 4.5 Receptions"
    //   "Matthew Stafford Over 2.5 Pass TDs"
    //   "Breece Hall Anytime TD"
    //   "Amen Thompson Over 7.5 rebounds"
    //   "James Harden Under 6.5 Assists"
    //   "Desmond Bane Over 2.5 threes"
    //
    // The fuzzy player matcher uses last-word equality, so leaving a stat
    // word ("rebounds", "Assists") attached makes every NBA prop fail to
    // resolve. This regex must cover every stat noun referenced anywhere
    // in checkPlayerPropOutcome's pick parsing.
    const STAT_WORDS = [
      // football
      'Pass', 'Rush', 'Rec', 'Receiving', 'TD', 'TDs', 'Yards', 'Yds', 'Receptions',
      // basketball
      'Point', 'Points', 'Rebound', 'Rebounds', 'Assist', 'Assists',
      'Three', 'Threes', '3pt', '3-pt',
      'Steal', 'Steals', 'Block', 'Blocks',
      // hockey
      'Save', 'Saves', 'Goal', 'Goals', 'Shot', 'Shots',
    ];
    const statRe = new RegExp(`\\b(${STAT_WORDS.join('|')})\\b`, 'gi');

    const name = pick
      .replace(/\b(Over|Under|Anytime)\b/gi, '')
      .replace(/\b\d+(\.\d+)?\b/g, '')
      .replace(statRe, '')
      .replace(/\s+/g, ' ')
      .trim();

    return name || null;
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
        .from('parlay_legs')
        .update({
          outcome: update.result,
          settled_at: new Date().toISOString()
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
          profit_loss: profitLoss
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
        final_outcome: outcome
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