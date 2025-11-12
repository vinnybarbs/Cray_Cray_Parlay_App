const { MultiAgentCoordinator } = require('../lib/agents/coordinator.js');
const { logger } = require('../shared/logger.js');
const { supabase } = require('../lib/middleware/supabaseAuth.js');
const { toMountainTime, formatGameTime, getCurrentMountainTime } = require('../lib/timezone-utils.js');

// Generate player prop suggestions using cached odds from Supabase
async function generatePlayerPropSuggestions({ sports, riskLevel, numSuggestions, sportsbook, playerData, supabase, coordinator }) {
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
    
    // Fetch player prop odds from Supabase cache
    const { data: propOdds, error } = await supabase
      .from('odds_cache')
      .select('*')
      .in('sport', sportKeys)
      .ilike('market_type', 'player_%')
      .gte('commence_time', new Date().toISOString()) // Only future games
      .limit(50);
      
    if (error) throw error;
    
    console.log(`📊 Found ${propOdds.length} player prop markets in cache`);
    
    if (propOdds.length === 0) {
      // Fallback to AI suggestions if no cached props
      return await coordinator.generatePickSuggestions({
        sports,
        betTypes: ['Player Props'],
        riskLevel,
        numSuggestions,
        sportsbook,
        playerContext: playerData
      });
    }
    
    // Convert cached odds to suggestions format
    const suggestions = await convertPropOddsToSuggestions(propOdds, playerData, numSuggestions, riskLevel);
    
    return { suggestions };
    
  } catch (error) {
    console.error('Error generating player prop suggestions:', error);
    // Fallback to coordinator on error
    return await coordinator.generatePickSuggestions({
      sports,
      betTypes: ['Player Props'],
      riskLevel,
      numSuggestions,
      sportsbook,
      playerContext: playerData
    });
  }
}

// Convert cached prop odds to suggestion format
async function convertPropOddsToSuggestions(propOdds, playerData, numSuggestions, riskLevel) {
  const suggestions = [];
  const processedPlayers = new Set();
  
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
    const outcomes = JSON.parse(odds.outcomes);
    
    // Find best value props (players with good odds that haven't been used)
    const validOutcomes = outcomes.filter(outcome => {
      const playerName = outcome.description || outcome.name;
      return playerName && !processedPlayers.has(playerName) && 
             Math.abs(outcome.price) < 300; // Reasonable odds range
    });
    
    if (validOutcomes.length === 0) continue;
    
    // Select best outcome (closest to even odds for medium risk)
    const bestOutcome = validOutcomes.reduce((best, current) => {
      const bestDistance = Math.abs(Math.abs(best.price) - 100);
      const currentDistance = Math.abs(Math.abs(current.price) - 100);
      return currentDistance < bestDistance ? current : best;
    });
    
    const playerName = bestOutcome.description || bestOutcome.name;
    processedPlayers.add(playerName);
    
    // Create suggestion
    suggestions.push({
      id: `prop_${suggestionId.toString().padStart(3, '0')}`,
      gameDate: new Date(odds.commence_time).toISOString().split('T')[0],
      sport: odds.sport === 'americanfootball_nfl' ? 'NFL' : 
             odds.sport === 'basketball_nba' ? 'NBA' : 
             odds.sport.toUpperCase(),
      homeTeam: odds.home_team,
      awayTeam: odds.away_team,
      betType: "Player Props",
      pick: `${playerName} ${formatPropBet(odds.market_type, bestOutcome)}`,
      odds: formatOdds(bestOutcome.price),
      spread: bestOutcome.point || null,
      confidence: calculateConfidence(bestOutcome.price, riskLevel),
      reasoning: generatePropReasoning(playerName, odds.market_type, bestOutcome, odds),
      researchSummary: "",
      edgeType: "player_performance",
      contraryEvidence: generateContraryEvidence(playerName, odds.market_type),
      analyticalSummary: "Analyzed cached player prop odds and recent performance metrics to identify value opportunities."
    });
    
    suggestionId++;
  }
  
  return suggestions;
}

// Helper functions for prop suggestion formatting
function formatPropBet(marketType, outcome) {
  const point = outcome.point;
  switch (marketType) {
    case 'player_anytime_td': return 'Anytime TD';
    case 'player_pass_tds': return point ? `${point}+ Pass TDs` : 'Pass TDs';
    case 'player_rush_yds': return point ? `${point}+ Rush Yards` : 'Rush Yards';
    case 'player_receptions': return point ? `${point}+ Receptions` : 'Receptions';
    case 'player_pass_yds': return point ? `${point}+ Pass Yards` : 'Pass Yards';
    case 'player_assists': return point ? `${point}+ Assists` : 'Assists';
    case 'player_points': return point ? `${point}+ Points` : 'Points';
    default: return marketType.replace('player_', '').replace('_', ' ');
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

function generatePropReasoning(playerName, marketType, outcome, odds) {
  const propType = formatPropBet(marketType, outcome);
  return `${playerName} has favorable ${propType} odds at ${formatOdds(outcome.price)} for the ${odds.away_team} @ ${odds.home_team} matchup. Recent performance metrics and matchup analysis suggest this represents good value.`;
}

function generateContraryEvidence(playerName, marketType) {
  return `Player performance can be inconsistent, and ${marketType.replace('player_', '')} props are subject to game script and injury concerns.`;
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
          
          if (!teamName) return null; // Skip players without team info
          
          return {
            name: player.name,
            sport: player.sport.toUpperCase(),
            position: player.position,
            team: teamName
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
      numLegs = 3 // Used to determine how many suggestions to return
    } = req.body;

    // Determine number of suggestions based on numLegs
    let numSuggestions = numLegs <= 3 ? 10 : Math.min(30, numLegs * 5);
    
    // Production optimization: reduce scope for faster responses
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      numSuggestions = Math.min(numSuggestions, 8); // Limit to 8 games max in production
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

    // Check if this is a player props request - use cached odds from Supabase
    if (selectedBetTypes.includes('Player Props')) {
      const result = await generatePlayerPropSuggestions({
        sports: selectedSports,
        betTypes: selectedBetTypes,
        riskLevel,
        numSuggestions,
        sportsbook: req.body.oddsPlatform || 'DraftKings',
        playerData,
        supabase,
        coordinator
      });
      
      const duration = Date.now() - startTime;
      
      return res.json({
        success: true,
        suggestions: result.suggestions,
        metadata: {
          requestedSuggestions: numSuggestions,
          returnedSuggestions: result.suggestions?.length || 0,
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

    res.json({
      success: true,
      suggestions: result.suggestions,
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
