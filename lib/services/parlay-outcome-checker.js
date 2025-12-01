/**
 * Parlay Outcome Checker Service
 * Automatically checks pending parlays against game results and updates outcomes
 */

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../../shared/logger');
const ApiSportsClient = require('./apisports-client');

class ParlayOutcomeChecker {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.apiSports = new ApiSportsClient();
    
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
      // Fetch parlay_legs for this parlay (not ai_suggestions)
      const { data: picks, error: picksError } = await this.supabase
        .from('parlay_legs')
        .select('*')
        .eq('parlay_id', parlay.id)
        .order('leg_number', { ascending: true });

      if (picksError) {
        logger.error(`Error fetching legs for parlay ${parlay.id}:`, picksError);
        throw picksError;
      }

      logger.info(`Checking parlay ${parlay.id} with ${picks?.length || 0} legs`);

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

        logger.info(`Checking leg: ${leg.sport} - ${leg.away_team} @ ${leg.home_team} (${leg.game_date})`);

        // Check if the game has completed
        const gameResult = await this.getGameResult(leg);
        
        if (!gameResult) {
          logger.info(`  No result found for ${leg.sport} game`);
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

      // Use API-Sports (you pay for it!)
      if (process.env.APISPORTS_API_KEY) {
        return await this.getGameResultFromAPISports(leg);
      }

      // Fallback to ESPN only if no API key
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
      // Only support NFL for now (expand later)
      if (leg.sport !== 'NFL') return null;

      const gameDate = new Date(leg.game_date).toISOString().split('T')[0];
      
      logger.info(`  Fetching NFL games from API-Sports for ${gameDate}...`);
      
      // Use ApiSportsClient
      const result = await this.apiSports.getGamesByDate(gameDate, 1); // league 1 = NFL
      
      if (!result.response || result.response.length === 0) {
        logger.info(`  No games found for ${gameDate}`);
        return null;
      }
      
      // Find the matching game
      const game = result.response.find(g => 
        this.teamsMatch(g.teams.home.name, leg.home_team) &&
        this.teamsMatch(g.teams.away.name, leg.away_team)
      );

      if (!game) {
        logger.info(`  Game not found: ${leg.away_team} @ ${leg.home_team}`);
        return null;
      }

      // Check if game is finished
      if (game.game.status.short !== 'FT' && game.game.status.short !== 'AOT') {
        logger.info(`  Game not finished yet: ${game.game.status.long}`);
        return null;
      }

      logger.info(`  ✓ Found completed game: ${game.scores.away.total}-${game.scores.home.total}`);

      return {
        homeScore: game.scores.home.total || 0,
        awayScore: game.scores.away.total || 0,
        gameId: game.game.id,
        status: 'completed',
        source: 'api-sports'
      };

    } catch (error) {
      logger.error('Error fetching from API-Sports:', error);
      return null;
    }
  }

  /**
   * Get player stats from API-Sports
   */
  async getPlayerStatsFromAPISports(gameId, playerName) {
    try {
      logger.info(`  Fetching player stats from API-Sports for game ${gameId}...`);
      
      // Get player stats for the game
      const result = await this.apiSports.getGamePlayerStats(gameId);
      
      if (!result.response || result.response.length === 0) {
        logger.info(`  No player stats found for game ${gameId}`);
        return null;
      }

      // API-Sports format: response = [{team, groups: [{name, players: [{player, statistics}]}]}]
      // Player can appear in multiple groups (Passing, Rushing, Receiving)
      let foundPlayer = null;
      const allStats = {
        passing: {},
        rushing: {},
        receiving: {}
      };

      for (const teamData of result.response) {
        for (const group of teamData.groups) {
          const groupType = group.name.toLowerCase();
          
          for (const playerData of group.players) {
            if (this.playerNamesMatch(playerData.player.name, playerName)) {
              foundPlayer = playerData.player.name;
              
              // Parse statistics array into object for this group
              const groupStats = {};
              playerData.statistics.forEach(stat => {
                const key = stat.name.toLowerCase().replace(/\s+/g, '_');
                groupStats[key] = stat.value;
              });
              
              // Store in appropriate category
              if (groupType.includes('pass')) {
                allStats.passing = groupStats;
              } else if (groupType.includes('rush')) {
                allStats.rushing = groupStats;
              } else if (groupType.includes('receiv')) {
                allStats.receiving = groupStats;
              }
            }
          }
        }
      }

      if (!foundPlayer) {
        logger.info(`  Player not found: ${playerName}`);
        return null;
      }

      logger.info(`  ✓ Found ${foundPlayer}`);

      // Parse values from stat strings
      const parseYards = (val) => {
        if (!val) return 0;
        const num = parseInt(val.toString());
        return isNaN(num) ? 0 : num;
      };

      return {
        // Passing
        passyds: parseYards(allStats.passing.yards),
        passtd: parseYards(allStats.passing.passing_touch_downs),
        passint: parseYards(allStats.passing.interceptions),
        
        // Rushing
        rushyds: parseYards(allStats.rushing.yards),
        rushtd: parseYards(allStats.rushing.rushing_touch_downs),
        
        // Receiving
        rec: parseYards(allStats.receiving.receptions),
        recyds: parseYards(allStats.receiving.yards),
        rectd: parseYards(allStats.receiving.receiving_touch_downs)
      };

    } catch (error) {
      logger.error('Error fetching API-Sports player stats:', error);
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
   * Get game result from ESPN API (free fallback)
   */
  async getGameResultFromESPN(leg) {
    try {
      // ESPN API endpoints by sport
      const espnEndpoints = {
        'NFL': 'http://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
        'NCAAF': 'http://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
        'NCAA': 'http://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard', // Alias
        'NBA': 'http://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
        'NCAAB': 'http://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
        'MLB': 'http://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
        'NHL': 'http://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
        'Soccer': 'http://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard', // English Premier League
        'EPL': 'http://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard'
      };

      const endpoint = espnEndpoints[leg.sport];
      if (!endpoint) {
        logger.warn(`No ESPN endpoint for sport: ${leg.sport}`);
        return null;
      }

      const gameDate = new Date(leg.game_date);
      const dateStr = gameDate.toISOString().split('T')[0].replace(/-/g, '');
      
      const response = await fetch(`${endpoint}?dates=${dateStr}`);
      if (!response.ok) return null;

      const data = await response.json();
      
      // Find matching game - allow home/away to be reversed
      const game = data.events?.find(event => {
        const competition = event.competitions[0];
        const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
        const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
        
        // Check if teams match in correct order
        const correctOrder = this.teamsMatch(homeTeam.team.displayName, leg.home_team) &&
                            this.teamsMatch(awayTeam.team.displayName, leg.away_team);
        
        // Check if teams match but are reversed (home/away flipped)
        const reversedOrder = this.teamsMatch(homeTeam.team.displayName, leg.away_team) &&
                             this.teamsMatch(awayTeam.team.displayName, leg.home_team);
        
        return correctOrder || reversedOrder;
      });

      if (!game) return null;

      const competition = game.competitions[0];
      const status = competition.status;
      
      // Check if game is completed
      if (status.type.completed !== true) {
        return null;
      }

      const espnHomeTeam = competition.competitors.find(c => c.homeAway === 'home');
      const espnAwayTeam = competition.competitors.find(c => c.homeAway === 'away');

      // Check if teams are reversed - if so, swap scores to match our data format
      const teamsReversed = this.teamsMatch(espnHomeTeam.team.displayName, leg.away_team);
      
      return {
        homeScore: teamsReversed ? (parseInt(espnAwayTeam.score) || 0) : (parseInt(espnHomeTeam.score) || 0),
        awayScore: teamsReversed ? (parseInt(espnHomeTeam.score) || 0) : (parseInt(espnAwayTeam.score) || 0),
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
  async determineLegOutcome(leg, gameResult) {
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
        case 'Player Props':
        case 'TD Props':
        case 'Player Pass TDs':
        case 'Player Rush Yards':
        case 'Player Receptions':
        case 'Player Pass Yards':
        case 'Player Rec Yards':
        case 'Player Receiving Yards':
          return await this.checkPlayerPropOutcome(leg, gameResult);
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

      // Try API-Sports first (you pay for it!)
      let playerStats = null;
      if (gameResult.gameId && process.env.APISPORTS_API_KEY) {
        playerStats = await this.getPlayerStatsFromAPISports(gameResult.gameId, playerName);
      }
      
      // Fallback to ESPN if API-Sports fails
      if (!playerStats) {
        logger.info(`  Trying ESPN fallback...`);
        playerStats = await this.getPlayerStatsFromESPN(leg, playerName);
      }
      
      if (!playerStats) {
        logger.info(`  No stats found for ${playerName}`);
        return null; // Can't grade yet
      }

      // Determine stat type and check outcome
      const pick = leg.pick.toLowerCase();
      const line = leg.point ? parseFloat(leg.point) : 0;
      const isOver = pick.includes('over');
      const isUnder = pick.includes('under');
      const isAnytime = pick.includes('anytime td');

      let actualValue = 0;
      let result = null;

      // Pass Yards
      if (pick.includes('pass') && pick.includes('yard')) {
        actualValue = playerStats.passyds || 0;
        logger.info(`  Pass yards: ${actualValue} vs ${line}`);
      }
      // Pass TDs
      else if (pick.includes('pass') && pick.includes('td')) {
        actualValue = playerStats.passtd || 0;
        logger.info(`  Pass TDs: ${actualValue} vs ${line}`);
      }
      // Rush Yards
      else if (pick.includes('rush') && pick.includes('yard')) {
        actualValue = playerStats.rushyds || 0;
        logger.info(`  Rush yards: ${actualValue} vs ${line}`);
      }
      // Rush TDs
      else if (pick.includes('rush') && pick.includes('td')) {
        actualValue = playerStats.rushtd || 0;
        logger.info(`  Rush TDs: ${actualValue}`);
      }
      // Receptions
      else if (pick.includes('reception')) {
        actualValue = playerStats.rec || 0;
        logger.info(`  Receptions: ${actualValue} vs ${line}`);
      }
      // Receiving Yards
      else if (pick.includes('rec') && pick.includes('yard')) {
        actualValue = playerStats.recyds || 0;
        logger.info(`  Rec yards: ${actualValue} vs ${line}`);
      }
      // Receiving TDs
      else if (pick.includes('rec') && pick.includes('td')) {
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
      if (!isAnytime) {
        if (actualValue === line) {
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
    // "Emeka Egbuka Under 4.5 Receptions"
    // "Matthew Stafford Over 2.5 Pass TDs"
    // "Breece Hall Anytime TD"
    
    // Remove Over/Under/Anytime and numbers
    let name = pick
      .replace(/\b(Over|Under|Anytime)\b/gi, '')
      .replace(/\b\d+(\.\d+)?\b/g, '')
      .replace(/\b(Pass|Rush|Rec|Receiving|TD|TDs|Yards|Yds|Receptions)\b/gi, '')
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