const { MultiAgentCoordinator } = require('../lib/agents/coordinator.js');
const { logger } = require('../shared/logger.js');
const { supabase } = require('../lib/middleware/supabaseAuth.js');
const { toMountainTime, formatGameTime, getCurrentMountainTime } = require('../lib/timezone-utils.js');
const { SportsIntelligenceService } = require('../lib/services/sports-intelligence.js');

const intelligenceService = new SportsIntelligenceService();

/**
 * Store AI suggestions to database for model performance tracking
 * @param {Array} suggestions - Array of suggestion objects
 * @param {Object} options - Metadata (riskLevel, generateMode, userId)
 * @returns {Promise<string>} Session ID
 */
async function storeAISuggestions(suggestions, options = {}) {
  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  try {
    // Generate unique session ID for this batch
    const sessionId = `session_${Date.now()}_${options.userId || 'guest'}`;
    
    // Prepare suggestions for database
    const suggestionRecords = suggestions.map(suggestion => ({
      session_id: sessionId,
      sport: suggestion.sport || 'NFL',
      home_team: suggestion.homeTeam,
      away_team: suggestion.awayTeam,
      game_date: suggestion.gameDate || suggestion.commence_time,
      espn_event_id: suggestion.espnEventId || null,
      bet_type: suggestion.betType,
      pick: suggestion.pick,
      odds: suggestion.odds,
      point: suggestion.point || null,
      confidence: suggestion.confidence || null,
      reasoning: suggestion.reasoning || null,
      risk_level: options.riskLevel,
      generate_mode: options.generateMode,
      actual_outcome: 'pending',
      user_id: options.userId || null
    }));

    // Insert suggestions into database
    const { error } = await supabase
      .from('ai_suggestions')
      .insert(suggestionRecords);

    if (error) {
      console.error('❌ Error storing AI suggestions:', error.message);
      // Don't fail the request if storage fails
      return sessionId;
    }

    console.log(`✅ Stored ${suggestionRecords.length} AI suggestions with session ID: ${sessionId}`);
    return sessionId;

  } catch (error) {
    console.error('❌ Exception storing AI suggestions:', error.message);
    return null;
  }
}

// Generate player prop suggestions using cached odds from Supabase
async function generatePlayerPropSuggestions({ sports, riskLevel, numSuggestions, sportsbook, playerData, supabase, coordinator, selectedBetTypes }) {
  try {
    console.log('🏈 Generating player prop suggestions from Supabase cache...');
    
    // Map sport names to database keys
    const sportKeys = sports.map(sport => {
      const sportUpper = sport.toUpperCase();
      return sportUpper === 'NFL' ? 'americanfootball_nfl' : 
             sportUpper === 'NBA' ? 'basketball_nba' : 
             sportUpper === 'MLB' ? 'baseball_mlb' : 
             sportUpper === 'NHL' ? 'icehockey_nhl' : sport.toLowerCase();
    });
    
    // Fetch player prop odds from Supabase base table (single source of truth)
    // Only include FUTURE games and reasonably fresh odds
    const nowIso = new Date().toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: initialPropOdds, error } = await supabase
      .from('odds_cache')
      .select('*')
      .eq('sport', sportKeys[0]) // Use first sport with .eq() like test endpoint
      .ilike('market_type', 'player_%')
      .gt('commence_time', nowIso) // exclude past games
      .gte('last_updated', oneDayAgo) // avoid very stale data
      .order('commence_time', { ascending: true })
      .limit(50);
      
    if (error) throw error;
    
    let propOdds = initialPropOdds || [];

    // If nothing matched the 24h freshness filter but we know props exist in the cache,
    // retry without the last_updated constraint so manual refreshes remain usable.
    if (!propOdds.length) {
      console.log('⚠️ No fresh player prop odds found (last 24h). Retrying without last_updated filter...');

      const { data: fallbackOdds, error: fallbackError } = await supabase
        .from('odds_cache')
        .select('*')
        .eq('sport', sportKeys[0])
        .ilike('market_type', 'player_%')
        .gt('commence_time', nowIso)
        .order('commence_time', { ascending: true })
        .limit(50);

      if (fallbackError) throw fallbackError;

      propOdds = fallbackOdds || [];
      console.log(`🔁 Fallback prop odds query (no last_updated filter) found ${propOdds.length} markets`);
    }

    console.log(`📊 Using ${propOdds.length} player prop markets from cache`);
    
    // Debug: Test the exact same query as working test endpoint
    const { data: testQuery, error: testError } = await supabase
      .from('odds_cache')
      .select('market_type')
      .eq('sport', 'americanfootball_nfl')
      .ilike('market_type', 'player_%')
      .limit(5);
      
    console.log(`🔍 Direct test query found ${testQuery?.length || 0} records`);
    if (testQuery?.length > 0) {
      console.log('Test query market types:', testQuery.map(r => r.market_type));
    }
    
    // Debug: log sample data structure 
    if (propOdds.length > 0) {
      console.log('First prop odds record keys:', Object.keys(propOdds[0]));
    } else {
      console.log('⚠️ No prop odds returned from query - debugging needed');
      console.log('Query parameters used:', {
        sportKeys,
        firstSportKey: sportKeys[0],
        table: 'odds_cache'
      });
    }
    
    if (propOdds.length === 0) {
      // Return empty suggestions instead of fallback to avoid date parsing errors
      console.log('⚠️ No player prop odds found in cache, returning empty suggestions');
      return { 
        suggestions: [],
        message: "No player prop odds currently available in cache. Check back after the next odds refresh."
      };
    }

    // TD-only vs mixed player-props modes
    const tdMarkets = [
      'player_anytime_td',
      'player_pass_tds',
      'player_rush_tds',
      'player_reception_tds',
      'player_1st_td',
      'player_last_td'
    ];
    const tdSet = new Set(tdMarkets);

    // If user specifically requested only TD Props (without general Player Props),
    // narrow the markets to TD-related ones.
    const wantsTDOnly = Array.isArray(selectedBetTypes)
      && selectedBetTypes.includes('TD Props')
      && !selectedBetTypes.includes('Player Props');

    const wantsMixedPlayerProps = Array.isArray(selectedBetTypes)
      && selectedBetTypes.includes('Player Props');

    let filteredPropOdds = propOdds;
    if (wantsTDOnly) {
      filteredPropOdds = propOdds.filter(o => tdSet.has(o.market_type));
      console.log(`🎯 TD Props mode: filtered to ${filteredPropOdds.length} TD markets from ${propOdds.length} total player markets`);

      if (filteredPropOdds.length === 0) {
        console.log('⚠️ No TD prop odds found in cache, returning empty suggestions');
        return {
          suggestions: [],
          message: 'No TD prop odds currently available in cache. Check back after the next odds refresh.'
        };
      }
    } else if (wantsMixedPlayerProps) {
      // Player Props mode: intentionally mix yardage/reception props with TD props
      const yardageProps = propOdds.filter(o => !tdSet.has(o.market_type));
      const tdProps = propOdds.filter(o => tdSet.has(o.market_type));
      const mixed = [];
      const maxLen = Math.max(yardageProps.length, tdProps.length);
      for (let i = 0; i < maxLen; i++) {
        if (yardageProps[i]) mixed.push(yardageProps[i]);
        if (tdProps[i]) mixed.push(tdProps[i]);
      }
      filteredPropOdds = mixed;
      console.log(`🎯 Player Props mode: mixing ${yardageProps.length} yardage markets with ${tdProps.length} TD markets`);
    }

    // Pre-compute news/intel context per game to enrich reasoning
    const intelligenceMap = {};
    const seenGames = new Set();
    for (const odds of filteredPropOdds) {
      const gameKey = `${odds.home_team}_${odds.away_team}`;
      if (seenGames.has(gameKey)) continue;
      seenGames.add(gameKey);

      const sportCode = odds.sport === 'americanfootball_nfl' ? 'NFL'
        : odds.sport === 'basketball_nba' ? 'NBA'
        : (odds.sport || '').toUpperCase();

      try {
        const intel = await intelligenceService.getAgentContext(sportCode, odds.home_team, odds.away_team);
        intelligenceMap[gameKey] = intel;
      } catch (intelError) {
        console.log('⚠️ Failed to load intelligence for game', gameKey, intelError.message);
      }
    }

    // Convert cached odds to suggestions format (with stats + news context)
    let suggestions = await convertPropOddsToSuggestions(
      filteredPropOdds,
      playerData,
      numSuggestions,
      riskLevel,
      intelligenceMap,
      { disableRosterCheck: false }
    );

    // Safety net: if roster verification was too strict and we ended up with zero
    // suggestions, retry once without enforcing the roster check so the user still
    // sees actionable props.
    if (!suggestions || suggestions.length === 0) {
      console.log('⚠️ No suggestions after roster verification; retrying without roster check.');
      suggestions = await convertPropOddsToSuggestions(
        filteredPropOdds,
        playerData,
        numSuggestions,
        riskLevel,
        intelligenceMap,
        { disableRosterCheck: true }
      );
    }

    return { suggestions };
    
  } catch (error) {
    console.error('Error generating player prop suggestions:', error);
    // Return error message instead of fallback to avoid coordinator date issues
    return { 
      suggestions: [],
      error: `Failed to generate player prop suggestions: ${error.message}`
    };
  }
}

// Convert cached prop odds to suggestion format
async function convertPropOddsToSuggestions(propOdds, playerData, numSuggestions, riskLevel, intelligenceMap = {}, options = {}) {
  const suggestions = [];
  const processedPlayers = new Set();
  const playerIndex = new Map();
  const { disableRosterCheck = false } = options || {};

  if (Array.isArray(playerData)) {
    playerData.forEach(p => {
      if (p && p.name) {
        playerIndex.set(p.name.toLowerCase(), p);
      }
    });
  }
  
  // Group by game and market type for better selection
  const gameGroups = propOdds.reduce((groups, odds) => {
    const gameKey = `${odds.home_team}_${odds.away_team}_${odds.market_type}`;
    if (!groups[gameKey]) groups[gameKey] = [];
    groups[gameKey].push(odds);
    return groups;
  }, {});
  
  let suggestionId = 1;
  
  for (const [gameKey, gameOdds] of Object.entries(gameGroups)) {
    if (suggestions.length >= numSuggestions) break;
    
    const odds = gameOdds[0]; // Take first bookmaker for this game/market
    const outcomes = typeof odds.outcomes === 'string' ? JSON.parse(odds.outcomes) : odds.outcomes;
    
    if (!Array.isArray(outcomes) || outcomes.length === 0) continue;

    // Find best value props (players with good odds that haven't been used)
    let validOutcomes = outcomes.filter(outcome => {
      const playerName = outcome.description || outcome.name;
      if (!playerName || processedPlayers.has(playerName)) return false;
      if (Math.abs(outcome.price) >= 300) return false; // Reasonable odds range

      if (!disableRosterCheck) {
        // Roster verification: ensure player is actually on one of the matchup teams when we
        // have cached roster data for them.
        const playerInfo = playerIndex.get(playerName.toLowerCase());
        if (playerInfo && playerInfo.team) {
          const isOnMatchupTeam = isPlayerOnTeams(
            playerInfo.team,
            odds.home_team,
            odds.away_team
          );
          if (!isOnMatchupTeam) {
            return false;
          }
        }
      }

      return true;
    });

    // If strict filtering (including roster check) yielded nothing and we're in
    // the relaxed pass (disableRosterCheck=true), fall back to any reasonably
    // priced unseen players so we still surface actionable props from the cache.
    if (validOutcomes.length === 0 && disableRosterCheck) {
      validOutcomes = outcomes.filter(outcome => {
        const playerName = outcome.description || outcome.name;
        if (!playerName || processedPlayers.has(playerName)) return false;
        if (Math.abs(outcome.price) >= 600) return false; // allow longer shots in fallback
        return true;
      });
    }

    if (validOutcomes.length === 0) continue;
    
    // Select best outcome (closest to even odds for medium risk)
    const bestOutcome = validOutcomes.reduce((best, current) => {
      const bestDistance = Math.abs(Math.abs(best.price) - 100);
      const currentDistance = Math.abs(Math.abs(current.price) - 100);
      return currentDistance < bestDistance ? current : best;
    });
    
    const playerName = bestOutcome.description || bestOutcome.name;
    processedPlayers.add(playerName);
    const playerInfo = playerIndex.get(playerName.toLowerCase());
    const seasonStats = playerInfo?.seasonStats;
    
    // Create suggestion with raw UTC commence_time so frontend can format consistently
    const gameDate = odds.commence_time || new Date().toISOString();
      
    // Group TD-related props under 'TD', others under 'Player Props'
    const tdMarkets = [
      'player_anytime_td',
      'player_pass_tds',
      'player_rush_tds',
      'player_reception_tds',
      'player_1st_td',
      'player_last_td'
    ];
    const betType = tdMarkets.includes(odds.market_type) ? 'TD' : 'Player Props';

    const intelKey = `${odds.home_team}_${odds.away_team}`;
    const intelContext = intelligenceMap[intelKey];
    suggestions.push({
      id: `prop_${suggestionId.toString().padStart(3, '0')}`,
      gameDate,
      sport: odds.sport === 'americanfootball_nfl' ? 'NFL' : 
             odds.sport === 'basketball_nba' ? 'NBA' : 
             odds.sport.toUpperCase(),
      homeTeam: odds.home_team,
      awayTeam: odds.away_team,
      betType,
      pick: formatPlayerPropPick(playerName, odds.market_type, bestOutcome),
      odds: formatOdds(bestOutcome.price),
  // spread field removed for player props
      confidence: calculateConfidence(bestOutcome.price, riskLevel),
      reasoning: generatePropReasoning(playerName, odds.market_type, bestOutcome, odds, seasonStats, intelContext),
      researchSummary: intelContext && intelContext.context ? intelContext.context : "",
      edgeType: "player_performance",
      contraryEvidence: generateContraryEvidence(playerName, odds.market_type),
      analyticalSummary: "Analyzed cached player prop odds and recent performance metrics to identify value opportunities."
    });
    
    suggestionId++;
  }
  
  return suggestions;
}

// Helper functions for prop suggestion formatting

// Improved formatting for player prop pick to always show line and direction

function formatPlayerPropPick(playerName, marketType, outcome) {
  const point = outcome.point;
  const side = outcome.side || '';
  let direction = '';
  // Try to infer Over/Under from side or marketType
  if (side) {
    if (typeof side === 'string' && side.toLowerCase().includes('over')) direction = 'Over';
    else if (typeof side === 'string' && side.toLowerCase().includes('under')) direction = 'Under';
    else if (typeof side === 'string' && side.length > 0) direction = side;
  } else if (typeof marketType === 'string' && marketType.includes('over')) direction = 'Over';
  else if (typeof marketType === 'string' && marketType.includes('under')) direction = 'Under';

  if (!direction && outcome && typeof outcome.name === 'string') {
    const nameLower = outcome.name.toLowerCase();
    if (nameLower.includes('over')) direction = 'Over';
    else if (nameLower.includes('under')) direction = 'Under';
  }

  // Build readable market label
  let marketLabel = '';
  switch (marketType) {
    case 'player_anytime_td':
      marketLabel = 'Anytime TD';
      break;
    case 'player_pass_tds':
      marketLabel = 'Pass TDs';
      break;
    case 'player_rush_yds':
      marketLabel = 'Rush Yards';
      break;
    case 'player_receptions':
      marketLabel = 'Receptions';
      break;
    case 'player_pass_yds':
      marketLabel = 'Pass Yards';
      break;
    case 'player_assists':
      marketLabel = 'Assists';
      break;
    case 'player_points':
      marketLabel = 'Points';
      break;
    case 'player_interceptions':
      marketLabel = 'Interceptions';
      break;
    default:
      marketLabel = typeof marketType === 'string' ? marketType.replace('player_', '').replace('_', ' ') : '';
  }

  // Compose pick string, fallback to previous formatting if missing info
  if (point !== undefined && direction) {
    return `${playerName} ${direction} ${point} ${marketLabel}`;
  } else if (point !== undefined) {
    return `${playerName} ${point} ${marketLabel}`;
  } else if (direction && marketLabel) {
    return `${playerName} ${direction} ${marketLabel}`;
  } else if (marketLabel) {
    return `${playerName} ${marketLabel}`;
  } else {
    // Fallback to basic formatting
    return `${playerName} ${marketType}`;
  }
}

function formatOdds(price) {
  return price > 0 ? `+${price}` : price.toString();
}

function calculateConfidence(price, riskLevel) {
  const absPrice = Math.abs(price);
  if (absPrice < 120) return 8; // Close to even odds
  if (absPrice < 150) return 7;
  if (absPrice < 200) return 6;
  return 5;
}

function generatePropReasoning(playerName, marketType, outcome, odds, seasonStats, intelContext) {
  const propType = formatPlayerPropPick(playerName, marketType, outcome);
  const priceText = formatOdds(outcome.price);
  const matchupText = `${odds.away_team} @ ${odds.home_team}`;

  let statSnippet = '';

  try {
    if (seasonStats && typeof seasonStats === 'object') {
      if (seasonStats.nfl) {
        const s = seasonStats.nfl;
        const games = s.games_played || 0;

        if (games > 0) {
          if (marketType === 'player_pass_yds' && (s.passing_yards || s.passing_touchdowns)) {
            statSnippet = `${playerName} has ${s.passing_yards || 0} passing yards and ${s.passing_touchdowns || 0} TDs through ${games} games this season.`;
          } else if (marketType === 'player_rush_yds' && (s.rushing_yards || s.rushing_attempts)) {
            statSnippet = `${playerName} has ${s.rushing_yards || 0} rushing yards on ${s.rushing_attempts || 0} carries through ${games} games this season.`;
          } else if (marketType === 'player_receptions' && (s.receptions || s.receiving_yards)) {
            statSnippet = `${playerName} has ${s.receptions || 0} receptions for ${s.receiving_yards || 0} yards in ${games} games this season.`;
          } else if (marketType === 'player_anytime_td' && (s.receiving_touchdowns || s.rushing_touchdowns)) {
            const tds = (s.receiving_touchdowns || 0) + (s.rushing_touchdowns || 0);
            statSnippet = `${playerName} has scored ${tds} TDs across ${games} games this season.`;
          }
        }

      } else if (seasonStats.nba) {
        const s = seasonStats.nba;
        const games = s.games_played || 0;

        if (games > 0) {
          if (marketType === 'player_points' && (s.points_per_game || s.points)) {
            const ppg = s.points_per_game || (s.points && games ? (s.points / games) : 0);
            statSnippet = `${playerName} is averaging ${ppg.toFixed ? ppg.toFixed(1) : ppg} points over ${games} games this season.`;
          } else if (marketType === 'player_assists' && (s.assists_per_game || s.assists)) {
            const apg = s.assists_per_game || (s.assists && games ? (s.assists / games) : 0);
            statSnippet = `${playerName} is averaging ${apg.toFixed ? apg.toFixed(1) : apg} assists over ${games} games this season.`;
          } else if (marketType === 'player_rebounds' && (s.rebounds_per_game || s.rebounds)) {
            const rpg = s.rebounds_per_game || (s.rebounds && games ? (s.rebounds / games) : 0);
            statSnippet = `${playerName} is averaging ${rpg.toFixed ? rpg.toFixed(1) : rpg} rebounds over ${games} games this season.`;
          } else if (!statSnippet && (s.points || s.rebounds || s.assists)) {
            statSnippet = `${playerName} has ${s.points || 0} points, ${s.rebounds || 0} rebounds, and ${s.assists || 0} assists so far this season.`;
          }
        }
      }
    }
  } catch (e) {
    // If stats parsing fails, fall back to base text
  }

  // Pull a concise news/intel line, if available
  let intelSnippet = '';
  if (intelContext && intelContext.context) {
    const firstLine = intelContext.context.split('\n')[0];
    if (firstLine) {
      intelSnippet = firstLine;
    }
  }

  const parts = [];
  parts.push(`${propType} is priced at ${priceText} for the ${matchupText} matchup.`);
  if (statSnippet) parts.push(statSnippet);
  if (intelSnippet) parts.push(intelSnippet);
  parts.push('Taken together, this combination of recent production and matchup context suggests this prop offers solid value at the current number.');

  return parts.join(' ');
}

function generateContraryEvidence(playerName, marketType) {
  return `Player performance can be inconsistent, and ${marketType.replace('player_', '')} props are subject to game script and injury concerns.`;
}

// Helper: normalize team names for rough matching (handles city vs nickname differences)
function normalizeTeamName(name) {
  if (!name) return '';
  return name
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Helper: verify that a player's team matches either the home or away team for a game
function isPlayerOnTeams(playerTeamName, homeTeam, awayTeam) {
  const playerNorm = normalizeTeamName(playerTeamName);
  const homeNorm = normalizeTeamName(homeTeam);
  const awayNorm = normalizeTeamName(awayTeam);

  if (!playerNorm) return false;
  if (!homeNorm && !awayNorm) return true;

  const matchesHome = homeNorm && (playerNorm.includes(homeNorm) || homeNorm.includes(playerNorm));
  const matchesAway = awayNorm && (playerNorm.includes(awayNorm) || awayNorm.includes(playerNorm));

  return !!(matchesHome || matchesAway);
}

/**
 * Get essential player data for prop validation and anti-hallucination
 */
async function getPlayerDataForProps(sports) {
  try {
    // Ultra-simple query: just get player name, sport, position, and extract team from provider_ids
    const { data: players, error } = await supabase
      .from('players')
      .select('name, sport, position, provider_ids')
      .in('sport', sports.map(s => s.toLowerCase()))
      .not('provider_ids', 'is', null)
      .limit(500); // Limit for fast results

    if (error) throw error;

    // Extract team names from provider_ids JSON - fast and simple
    const playerData = players
      .map(player => {
        try {
          const providerIds = JSON.parse(player.provider_ids || '{}');
          const teamName = providerIds.team_name;
          const seasonStats = providerIds.season_stats || null;
          
          if (!teamName) return null; // Skip players without team info
          
          return {
            name: player.name,
            sport: player.sport.toUpperCase(),
            position: player.position,
            team: teamName,
            seasonStats
          };
        } catch (e) {
          return null; // Skip players with invalid JSON
        }
      })
      .filter(Boolean); // Remove null entries

    logger.info('Retrieved player data for prop validation', {
      totalPlayers: playerData.length,
      bySport: playerData.reduce((acc, p) => {
        acc[p.sport] = (acc[p.sport] || 0) + 1;
        return acc;
      }, {})
    });

    return playerData;

  } catch (error) {
    logger.error('Error fetching player data for props', error);
    return [];
  }
}

/**
 * Suggest individual picks (not a full parlay)
 * Returns 10-30 independent betting suggestions based on user preferences
 */
async function suggestPicksHandler(req, res) {
  const startTime = Date.now();
  
  try {
    const {
      selectedSports = ['NFL'],
      selectedBetTypes = ['Moneyline/Spread'],
      riskLevel = 'Medium',
      dateRange = 2, // Default to 2 days to capture upcoming NFL games
      suggestionCount
    } = req.body;

    // Determine number of suggestions with sane defaults/limits
    let numSuggestions = Number.isFinite(Number(suggestionCount))
      ? Number(suggestionCount)
      : 12;
    numSuggestions = Math.max(8, Math.min(30, Math.round(numSuggestions)));
    
    // Production optimization: reduce scope for faster responses
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      numSuggestions = Math.min(numSuggestions, 12);
    }

    logger.info('Generating pick suggestions', {
      selectedSports,
      selectedBetTypes,
      riskLevel,
      dateRange,
      numSuggestions,
      isProduction
    });

    // API keys
    const apiKeys = {
      odds: process.env.ODDS_API_KEY,
      serper: process.env.SERPER_API_KEY,
      openai: process.env.OPENAI_API_KEY
    };

    if (!apiKeys.odds || !apiKeys.openai) {
      logger.error('Missing required API keys');
      return res.status(500).json({ 
        error: 'Server configuration error',
        details: 'Missing required API keys'
      });
    }

    // Initialize coordinator with supabase for odds caching
    const fetcher = global.fetch || require('node-fetch');
    const coordinator = new MultiAgentCoordinator(
      fetcher,
      apiKeys,
      supabase // Pass supabase for odds caching
    );

    // Get player data for prop validation (prevent AI hallucinations)
    const playerData = await getPlayerDataForProps(selectedSports);
    console.log(`📊 Retrieved ${playerData.length} players for validation`);

    // Check if this is a player/TD props request - prefer cached props from Supabase,
    // but fall back to regular odds flow if we can't generate any prop suggestions.
    const wantsPropMode = selectedBetTypes.some(bt => bt === 'Player Props' || bt === 'TD Props');

    if (wantsPropMode) {
      const result = await generatePlayerPropSuggestions({
        sports: selectedSports,
        betTypes: selectedBetTypes,
        riskLevel,
        numSuggestions,
        sportsbook: req.body.oddsPlatform || 'DraftKings',
        playerData,
        supabase,
        coordinator,
        selectedBetTypes
      });
      
      const duration = Date.now() - startTime;

      if (result.suggestions && result.suggestions.length > 0) {
        // Store AI suggestions for tracking model performance
        const sessionId = await storeAISuggestions(result.suggestions, {
          riskLevel,
          generateMode: 'player_props',
          userId: req.user?.id
        });

        return res.json({
          success: true,
          suggestions: result.suggestions,
          sessionId, // Include session ID for tracking
          metadata: {
            requestedSuggestions: numSuggestions,
            returnedSuggestions: result.suggestions.length,
            sports: selectedSports,
            betTypes: selectedBetTypes,
            riskLevel,
            generatedAt: new Date().toISOString(),
            generatedAtMT: getCurrentMountainTime(),
            duration: `${duration}ms`,
            playerDataStats: {
              totalPlayers: playerData.length,
              playersBySport: playerData.reduce((acc, p) => {
                acc[p.sport] = (acc[p.sport] || 0) + 1;
                return acc;
              }, {}),
              dataSource: "Supabase Cache + ESPN API"
            }
          }
        });
      }

      logger.warn('No player prop suggestions generated; falling back to core odds flow', {
        selectedSports,
        selectedBetTypes,
        riskLevel,
        numSuggestions
      });
      // Fall through to regular coordinator-based suggestion generation below
    }

    // Generate regular suggestions for non-player props
    const result = await coordinator.generatePickSuggestions({
      sports: selectedSports,
      betTypes: selectedBetTypes,
      riskLevel,
      dateRange,
      numSuggestions,
      sportsbook: req.body.oddsPlatform || 'DraftKings',
      playerContext: playerData // Simple validation data to prevent hallucinations
    });

    const duration = Date.now() - startTime;
    
    logger.info('Pick suggestions generated', {
      count: result.suggestions?.length || 0,
      duration: `${duration}ms`
    });

    // Store AI suggestions for tracking model performance
    const sessionId = await storeAISuggestions(result.suggestions, {
      riskLevel,
      generateMode: 'regular',
      userId: req.user?.id
    });

    res.json({
      success: true,
      suggestions: result.suggestions,
      sessionId, // Include session ID for tracking
      timings: result.timings,
      phaseData: result.phaseData,
      metadata: {
        requestedSuggestions: numSuggestions,
        returnedSuggestions: result.suggestions?.length || 0,
        sports: selectedSports,
        betTypes: selectedBetTypes,
        riskLevel,
        generatedAt: new Date().toISOString(),
        generatedAtMT: getCurrentMountainTime(),
        duration: `${duration}ms`,
        
        // Add player context metadata
        playerDataStats: {
          totalPlayers: playerData.length,
          playersBySport: playerData.reduce((acc, p) => {
            acc[p.sport] = (acc[p.sport] || 0) + 1;
            return acc;
          }, {}),
          dataSource: 'ESPN API'
        }
      }
    });

  } catch (error) {
    logger.error('Error generating pick suggestions', {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      error: 'Failed to generate pick suggestions',
      details: error.message, // Always show error details for debugging
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

module.exports = { suggestPicksHandler };
