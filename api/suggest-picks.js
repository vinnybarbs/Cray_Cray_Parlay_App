const { MultiAgentCoordinator } = require('../lib/agents/coordinator.js');
const { logger } = require('../shared/logger.js');
const { supabase } = require('../lib/middleware/supabaseAuth.js');
const { toMountainTime, formatGameTime, getCurrentMountainTime } = require('../lib/timezone-utils.js');
const { SportsIntelligenceService } = require('../lib/services/sports-intelligence.js');
const { SuggestionsCache } = require('../lib/services/suggestions-cache.js');

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
async function generatePlayerPropSuggestions({ sports, riskLevel, numSuggestions, sportsbook, playerData, supabase, coordinator, selectedBetTypes, dateRange = 2 }) {
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
    // Only include FUTURE games within the selected date range and reasonably fresh odds
    const nowIso = new Date().toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const endIso = new Date(Date.now() + (dateRange || 2) * 24 * 60 * 60 * 1000).toISOString();

    // Determine which market types to query based on selected bet types
    const wantsPlayerProps = selectedBetTypes.some(bt => bt === 'Player Props' || bt === 'TD Props');
    const wantsTeamProps = selectedBetTypes.some(bt => bt === 'Team Props');
    
    // Build market type filter - include player and/or team markets
    let marketQuery = supabase
      .from('odds_cache')
      .select('*')
      .eq('sport', sportKeys[0])
      .gt('commence_time', nowIso)
      .lt('commence_time', endIso)
      .gte('last_updated', oneDayAgo)
      .order('commence_time', { ascending: true })
      .limit(100); // Increased limit to accommodate both player and team props
    
    // Apply market type filter based on selections
    if (wantsPlayerProps && wantsTeamProps) {
      // Want both - use OR condition
      marketQuery = marketQuery.or('market_type.ilike.player_%,market_type.ilike.team_%');
    } else if (wantsPlayerProps) {
      marketQuery = marketQuery.ilike('market_type', 'player_%');
    } else if (wantsTeamProps) {
      marketQuery = marketQuery.ilike('market_type', 'team_%');
    }
    
    const { data: initialPropOdds, error } = await marketQuery;
      
    if (error) throw error;
    
    let propOdds = initialPropOdds || [];

    // If nothing matched the 24h freshness filter but we know props exist in the cache,
    // retry without the last_updated constraint so manual refreshes remain usable.
    if (!propOdds.length) {
      console.log('⚠️ No fresh player prop odds found (last 24h). Retrying without last_updated filter...');

      // Retry without last_updated filter
      let fallbackQuery = supabase
        .from('odds_cache')
        .select('*')
        .eq('sport', sportKeys[0])
        .gt('commence_time', nowIso)
        .lt('commence_time', endIso)
        .order('commence_time', { ascending: true })
        .limit(100);
      
      if (wantsPlayerProps && wantsTeamProps) {
        fallbackQuery = fallbackQuery.or('market_type.ilike.player_%,market_type.ilike.team_%');
      } else if (wantsPlayerProps) {
        fallbackQuery = fallbackQuery.ilike('market_type', 'player_%');
      } else if (wantsTeamProps) {
        fallbackQuery = fallbackQuery.ilike('market_type', 'team_%');
      }
      
      const { data: fallbackOdds, error: fallbackError } = await fallbackQuery;

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

    // Fetch team records from cached standings for context (W-L records)
    const teamRecordsMap = {};
    try {
      // Use season logic that matches NFL/NCAAF schedules (Aug-Jan span)
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth(); // 0-based
      const primarySport = (sports[0] || '').toUpperCase();
      let seasonFilter = year;

      if (primarySport === 'NFL' || primarySport === 'NCAAF') {
        // Football season runs Aug-Jan, so Jan-Jul belong to previous season
        seasonFilter = month >= 7 ? year : year - 1;
      }

      const { data: teamRecords, error: recordsError } = await supabase
        .from('team_stats_season')
        .select('team_id, metrics')
        .eq('season', seasonFilter);
      
      if (!recordsError && teamRecords) {
        // Also need team names
        const { data: teams } = await supabase
          .from('teams')
          .select('id, name, display_name');
        
        const teamNameMap = new Map(teams?.map(t => [t.id, t.display_name || t.name]) || []);
        
        teamRecords.forEach(record => {
          const teamName = teamNameMap.get(record.team_id);
          if (teamName && record.metrics) {
            const wins = record.metrics.wins || 0;
            const losses = record.metrics.losses || 0;
            teamRecordsMap[teamName] = { wins, losses, record: `${wins}-${losses}` };
          }
        });
        console.log(`📊 Loaded records for ${Object.keys(teamRecordsMap).length} teams (season=${seasonFilter}, sport=${primarySport})`);
      }
    } catch (err) {
      console.log('⚠️ Could not load team records:', err.message);
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

    // PHASE 2: Fetch recent player stats from ESPN box scores
    const playerStatsMap = {};
    try {
      // Extract unique player names from prop odds
      const uniquePlayers = new Set();
      filteredPropOdds.forEach(odds => {
        if (odds.outcomes) {
          odds.outcomes.forEach(outcome => {
            const playerName = outcome.description || outcome.name;
            if (playerName && playerName !== 'Over' && playerName !== 'Under') {
              uniquePlayers.add(playerName);
            }
          });
        }
      });

      const playerNames = Array.from(uniquePlayers);
      console.log(`📊 Phase 2: Fetching stats for ${playerNames.length} players with active props...`);

      if (playerNames.length > 0 && sports.length > 0) {
        const { ESPNPlayerStatsBoxScore } = require('../lib/services/espn-player-stats-boxscore');
        const statsService = new ESPNPlayerStatsBoxScore(supabase);
        
        // Fetch stats for all players with props
        const sportCode = sports[0].toUpperCase(); // Use first sport
        const stats = await statsService.getStatsForPlayers(playerNames, sportCode);
        
        // Store in map for easy lookup
        Object.assign(playerStatsMap, stats);
        console.log(`✅ Retrieved stats for ${Object.keys(stats).length} players`);
      }
    } catch (statsError) {
      console.error('⚠️ Error fetching player stats:', statsError.message);
      // Continue without stats - don't fail the whole request
    }

    // Convert cached odds to suggestions format (with stats + news context + team records)
    let suggestions = await convertPropOddsToSuggestions(
      filteredPropOdds,
      playerData,
      numSuggestions,
      riskLevel,
      intelligenceMap,
      playerStatsMap, // PASS STATS TO CONVERTER
      teamRecordsMap, // PASS TEAM RECORDS FOR CONTEXT
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
        playerStatsMap, // PASS STATS TO RETRY TOO
        teamRecordsMap, // PASS TEAM RECORDS TO RETRY TOO
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

async function getApiSportsPlayerAggregates(playerName, playerId = null, maxGames = 5) {
  try {
    let query = supabase
      .from('player_game_stats')
      .select('*')
      .order('game_date', { ascending: false })
      .limit(maxGames);

    if (playerId) {
      query = query.eq('player_id', playerId);
    } else if (playerName) {
      // Fallback name-based lookup if we don't have a player_id
      query = query.ilike('player_name', `%${playerName}%`);
    }

    const { data, error } = await query;

    if (error || !data || !data.length) {
      return null;
    }

    const games = data.length;
    const first = data[0] || {};

    const pickColumn = (candidates) => {
      if (!first || typeof first !== 'object') return null;
      for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(first, key)) return key;
      }
      return null;
    };

    const passYardsCol = pickColumn(['pass_yards', 'passing_yards']);
    const passTdsCol = pickColumn(['pass_tds', 'passing_touchdowns']);
    const rushYardsCol = pickColumn(['rush_yards', 'rushing_yards']);
    const recYardsCol = pickColumn(['rec_yards', 'receiving_yards']);
    const recTdsCol = pickColumn(['rec_tds', 'receiving_touchdowns']);
    const recsCol = pickColumn(['receptions']);

    const sum = (arr, key) => key
      ? arr.reduce((s, g) => s + (g[key] || 0), 0)
      : 0;

    const passYards = sum(data, passYardsCol);
    const passTds = sum(data, passTdsCol);
    const rushYards = sum(data, rushYardsCol);
    const recYards = sum(data, recYardsCol);
    const recs = sum(data, recsCol);
    const recTds = sum(data, recTdsCol);

    return {
      games,
      passing: {
        yardsPerGame: games ? passYards / games : 0,
        tdsPerGame: games ? passTds / games : 0
      },
      rushing: {
        yardsPerGame: games ? rushYards / games : 0
      },
      receiving: {
        yardsPerGame: games ? recYards / games : 0,
        receptionsPerGame: games ? recs / games : 0,
        tdsPerGame: games ? recTds / games : 0
      }
    };
  } catch (e) {
    return null;
  }
}

// Convert cached prop odds to suggestion format
async function convertPropOddsToSuggestions(propOdds, playerData, numSuggestions, riskLevel, intelligenceMap = {}, playerStatsMap = {}, teamRecordsMap = {}, options = {}) {
  const suggestions = [];
  // Track which (player, market_type) combos we've already used so that we
  // only take one direction per player/stat type per pool, but still allow
  // multiple different prop segments for the same player (e.g., yards AND TDs).
  const processedProps = new Set(); // key: `${playerName}|${marketType}`
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

    // Find best value props (players with good odds where we haven't already
    // taken a prop in this same market for that player)
    let validOutcomes = outcomes.filter(outcome => {
      const playerName = outcome.description || outcome.name;
      if (!playerName) return false;

      const marketType = odds.market_type || '';
      const propKey = `${playerName}|${marketType}`;
      if (processedProps.has(propKey)) return false;
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
        if (!playerName) return false;

        const marketType = odds.market_type || '';
        const propKey = `${playerName}|${marketType}`;
        if (processedProps.has(propKey)) return false;
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
    const propKey = `${playerName}|${odds.market_type || ''}`;
    processedProps.add(propKey);
    const playerInfo = playerIndex.get(playerName.toLowerCase());
    const seasonStats = playerInfo?.seasonStats;
    
    const recentStats = playerStatsMap[playerName] || null;

    let apiStats = null;
    if (odds.sport === 'americanfootball_nfl') {
      apiStats = await getApiSportsPlayerAggregates(playerName);
    }
    
    // Create suggestion with raw UTC commence_time so frontend can format consistently
    const gameDate = odds.commence_time || new Date().toISOString();
      
    // Determine bet type based on market type
    const tdMarkets = [
      'player_anytime_td',
      'player_pass_tds',
      'player_rush_tds',
      'player_reception_tds',
      'player_1st_td',
      'player_last_td'
    ];
    
    // Check if it's a team prop market
    const isTeamProp = odds.market_type && odds.market_type.startsWith('team_');
    const betType = isTeamProp ? 'Team Props' : (tdMarkets.includes(odds.market_type) ? 'TD' : 'Player Props');

    const intelKey = `${odds.home_team}_${odds.away_team}`;
    const intelContext = intelligenceMap[intelKey];
    
    // Format pick and reasoning differently for team vs player props
    const pick = isTeamProp 
      ? formatTeamPropPick(odds.market_type, bestOutcome, odds)
      : formatPlayerPropPick(playerName, odds.market_type, bestOutcome);
    
    const reasoning = isTeamProp
      ? generateTeamPropReasoning(odds.market_type, bestOutcome, odds, intelContext)
      : generatePropReasoning(playerName, odds.market_type, bestOutcome, odds, seasonStats, recentStats, intelContext, teamRecordsMap, apiStats);

    // If we could not generate stat-backed reasoning for a player prop,
    // skip this suggestion entirely rather than hedging on matchup context.
    if (!reasoning) {
      continue;
    }

    // Basic analytical edge classification for props so UI can show meaningful badges
    let edgeType = 'value';
    if (!isTeamProp) {
      if (tdMarkets.includes(odds.market_type)) {
        // TD props are often more situational / game-script dependent
        edgeType = 'situational';
      } else {
        // Yardage / receptions props are primarily about line value vs recent production
        edgeType = 'line_value';
      }
    }
    
    suggestions.push({
      id: `prop_${suggestionId.toString().padStart(3, '0')}`,
      gameDate,
      sport: odds.sport === 'americanfootball_nfl' ? 'NFL' : 
             odds.sport === 'basketball_nba' ? 'NBA' : 
             odds.sport.toUpperCase(),
      homeTeam: odds.home_team,
      awayTeam: odds.away_team,
      betType,
      pick,
      odds: formatOdds(bestOutcome.price),
  // spread field removed for player props
      confidence: calculateConfidence(bestOutcome.price, riskLevel),
      reasoning,
      // For props, reasoning already contains the stat-backed analysis; keep researchSummary
      // reserved for external news/research to avoid duplication.
      researchSummary: "",
      edgeType,
      contraryEvidence: isTeamProp ? "Team totals can be affected by pace, weather, and defensive adjustments." : generateContraryEvidence(playerName, odds.market_type),
      analyticalSummary: "", // Empty - reasoning field has all the content
      spread: odds.spread || null // Add game spread for UI display
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

function generatePropReasoning(playerName, marketType, outcome, odds, seasonStats, recentStats, intelContext, teamRecordsMap = {}, apiStats = null) {
  const propType = formatPlayerPropPick(playerName, marketType, outcome);
  const priceText = formatOdds(outcome.price);
  const matchupText = `${odds.away_team} @ ${odds.home_team}`;

  let statSnippet = '';

  // PHASE 1: Prioritize API-Sports DB stats from player_game_stats (per-game averages, last N games)
  try {
    if (!statSnippet && apiStats && odds.sport === 'americanfootball_nfl') {
      const games = apiStats.games || 0;

      if (games > 0) {
        // Normalize marketType to guard against undefined
        const mt = typeof marketType === 'string' ? marketType : '';

        // Passing yards props
        if (mt.includes('pass_yds') && apiStats.passing && typeof apiStats.passing.yardsPerGame === 'number' && apiStats.passing.yardsPerGame > 0) {
          const ypg = apiStats.passing.yardsPerGame;
          const tds = apiStats.passing.tdsPerGame;
          statSnippet = `${playerName}: ${ypg.toFixed ? ypg.toFixed(1) : ypg} pass yds/game`;
          if (typeof tds === 'number' && tds > 0) {
            const tpg = tds.toFixed ? tds.toFixed(2) : tds;
            statSnippet += `, ${tpg} pass TDs/game`;
          }
          statSnippet += ` (last ${games} games)`;

        // Rushing yards props
        } else if (mt.includes('rush_yds') && apiStats.rushing && typeof apiStats.rushing.yardsPerGame === 'number' && apiStats.rushing.yardsPerGame > 0) {
          const ypg = apiStats.rushing.yardsPerGame;
          statSnippet = `${playerName}: ${ypg.toFixed ? ypg.toFixed(1) : ypg} rush yds/game (last ${games} games)`;

        // Receptions count props
        } else if ((mt.includes('receptions') || mt === 'player_receptions') && apiStats.receiving && typeof apiStats.receiving.receptionsPerGame === 'number' && apiStats.receiving.receptionsPerGame > 0) {
          const rpg = apiStats.receiving.receptionsPerGame;
          statSnippet = `${playerName}: ${rpg.toFixed ? rpg.toFixed(1) : rpg} rec/game`;
          if (typeof apiStats.receiving.yardsPerGame === 'number' && apiStats.receiving.yardsPerGame > 0) {
            const ypg = apiStats.receiving.yardsPerGame;
            statSnippet += `, ${ypg.toFixed ? ypg.toFixed(1) : ypg} rec yds/game`;
          }
          statSnippet += ` (last ${games} games)`;

        // Receiving yards props
        } else if ((mt.includes('reception_yds') || mt.includes('rec_yds')) && apiStats.receiving && typeof apiStats.receiving.yardsPerGame === 'number' && apiStats.receiving.yardsPerGame > 0) {
          const ypg = apiStats.receiving.yardsPerGame;
          statSnippet = `${playerName}: ${ypg.toFixed ? ypg.toFixed(1) : ypg} rec yds/game`;
          if (typeof apiStats.receiving.receptionsPerGame === 'number' && apiStats.receiving.receptionsPerGame > 0) {
            const rpg = apiStats.receiving.receptionsPerGame;
            statSnippet += `, ${rpg.toFixed ? rpg.toFixed(1) : rpg} rec/game`;
          }
          statSnippet += ` (last ${games} games)`;

        // Anytime TD props - still useful context even if we don't parse an average vs line
        } else if (mt === 'player_anytime_td' && apiStats.receiving && typeof apiStats.receiving.tdsPerGame === 'number' && apiStats.receiving.tdsPerGame > 0) {
          const tpg = apiStats.receiving.tdsPerGame;
          statSnippet = `${playerName}: ${tpg.toFixed ? tpg.toFixed(2) : tpg} rec TDs/game (last ${games} games)`;
        }
      }
    }

    // PHASE 2: ESPN recent box score stats (fallback if no API-Sports snippet)
    if (!statSnippet && recentStats && typeof recentStats === 'object') {
      const { ESPNPlayerStatsBoxScore } = require('../lib/services/espn-player-stats-boxscore');
      const statsService = new ESPNPlayerStatsBoxScore(null);
      const sport = odds.sport === 'americanfootball_nfl' ? 'NFL' : 
                    odds.sport === 'basketball_nba' ? 'NBA' : 
                    odds.sport.toUpperCase();
      
      // Get formatted AI-ready stats
      const aiFormatted = statsService.formatStatsForAI(playerName, recentStats, sport);
      if (aiFormatted && !aiFormatted.includes('No significant stats')) {
        statSnippet = aiFormatted;
      }
    }
    // PHASE 3: Season-long stats fallback
    if (!statSnippet && seasonStats && typeof seasonStats === 'object') {
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

  // Pull REAL news from RSS (no AI-generated intel that hallucinates)
  let newsSnippet = '';
  if (intelContext && intelContext.news && Array.isArray(intelContext.news) && intelContext.news.length > 0) {
    // Use actual RSS news headline - this is real data, not AI hallucination
    const latestNews = intelContext.news[0];
    if (latestNews.title) {
      newsSnippet = latestNews.title;
    }
  }
  // SKIP AI-generated context that hallucinates rankings/stats

  // Build comprehensive analysis paragraph
  const line = outcome.point;
  const direction = outcome.name?.toLowerCase().includes('over') ? 'Over' : 'Under';
  
  // Parse player's average from recent stats - MATCH STAT TYPE TO PROP TYPE
  let playerAvg = null;
  let gamesAnalyzed = null;
  let statType = '';
  
  if (statSnippet) {
    // Determine which stat to extract based on market type
    let statPattern = null;
    
    if (marketType.includes('pass_yds')) {
      statPattern = /([\d.]+)\s+pass yds\/game/i;
      statType = 'pass yds';
    } else if (marketType.includes('pass_tds') || marketType.includes('pass_td')) {
      statPattern = /([\d.]+)\s+pass TDs?\/game/i;
      statType = 'pass TDs';
    } else if (marketType.includes('rush_yds')) {
      statPattern = /([\d.]+)\s+rush yds\/game/i;
      statType = 'rush yds';
    } else if (marketType.includes('rush_tds') || marketType.includes('rush_td')) {
      statPattern = /([\d.]+)\s+rush TDs?\/game/i;
      statType = 'rush TDs';
    } else if (marketType.includes('reception_yds') || marketType.includes('rec_yds')) {
      statPattern = /([\d.]+)\s+rec yds\/game/i;
      statType = 'rec yds';
    } else if (marketType.includes('receptions') || marketType === 'player_receptions') {
      statPattern = /([\d.]+)\s+rec\/game/i;
      statType = 'receptions';
    } else if (marketType.includes('reception_tds') || marketType.includes('rec_td')) {
      statPattern = /([\d.]+)\s+rec TDs?\/game/i;
      statType = 'rec TDs';
    }
    
    if (statPattern) {
      const avgMatch = statSnippet.match(statPattern);
      if (avgMatch) playerAvg = parseFloat(avgMatch[1]);
    }
    
    const gamesMatch = statSnippet.match(/last\s+(\d+)\s+games?/i);
    if (gamesMatch) gamesAnalyzed = parseInt(gamesMatch[1]);
  }
  
  // Build reasoning paragraph with VARIETY
  const parts = [];
  
  // Get team records for context
  const awayRecord = teamRecordsMap[odds.away_team]?.record;
  const homeRecord = teamRecordsMap[odds.home_team]?.record;
  const hasRecords = awayRecord && homeRecord;
  
  // VARY THE OPENING - 4 different styles for creativity
  const openingStyle = Math.floor(Math.random() * 4);
  switch(openingStyle) {
    case 0:
      parts.push(`${propType} is priced at ${priceText} for the ${matchupText} matchup${hasRecords ? ` (${awayRecord} @ ${homeRecord})` : ''}.`);
      break;
    case 1:
      parts.push(`Looking at ${propType} at ${priceText} in the ${matchupText} game${hasRecords ? ` — ${odds.away_team} (${awayRecord}) visiting ${odds.home_team} (${homeRecord})` : ''}.`);
      break;
    case 2:
      parts.push(`This ${matchupText} matchup${hasRecords ? ` between ${awayRecord} and ${homeRecord} teams` : ''} features ${propType} sitting at ${priceText}.`);
      break;
    case 3:
      parts.push(`${propType} catches our eye at ${priceText} for ${matchupText}${hasRecords ? ` with the ${odds.away_team} (${awayRecord}) traveling to face the ${odds.home_team} (${homeRecord})` : ''}.`);
      break;
  }
  
  // Statistical analysis with comparison to line
  if (playerAvg && line) {
    const diff = playerAvg - line;
    const diffPct = ((Math.abs(diff) / line) * 100).toFixed(1);
    
    const statLabel = statType || 'per game';
    
    if (direction === 'Over') {
      if (diff > 0) {
        parts.push(`${playerName} has been averaging ${playerAvg} ${statLabel} over ${gamesAnalyzed || 'recent'} games, sitting ${diff.toFixed(1)} above this ${line} line (${diffPct}% cushion). The trend strongly supports an Over play here.`);
      } else {
        parts.push(`${playerName} is averaging ${playerAvg} ${statLabel} recently, which is ${Math.abs(diff).toFixed(1)} below the ${line} line. However, this matchup presents upside potential given the game environment.`);
      }
    } else {
      if (diff < 0) {
        parts.push(`${playerName} has averaged just ${playerAvg} ${statLabel} over ${gamesAnalyzed || 'recent'} games, tracking ${Math.abs(diff).toFixed(1)} under this ${line} number. The recent production profile favors the Under.`);
      } else {
        parts.push(`While ${playerName} is averaging ${playerAvg} ${statLabel}, the ${line} line sits below that mark, suggesting the books may be accounting for matchup-specific factors that could suppress production.`);
      }
    }
  } else if (statSnippet) {
    // Have stats but couldn't parse average - just include them
    parts.push(`Looking at ${playerName}'s recent performance: ${statSnippet.replace(`${playerName}: `, '')}`);
  }
  
  // Real news context (RSS headlines only - no AI hallucinations)
  if (newsSnippet && newsSnippet.trim().length > 0) {
    parts.push(`Recent news: ${newsSnippet}`);
  }
  
  // Value verdict with VARIETY - 3 different phrasings per scenario
  if (playerAvg && line) {
    const diff = direction === 'Over' ? playerAvg - line : line - playerAvg;
    const verdictStyle = Math.floor(Math.random() * 3);
    
    if (diff > line * 0.1) {
      // Strong value - 3 ways to say it
      const strongPhrases = [
        `This represents strong value with recent performance significantly favoring the ${direction}.`,
        `The numbers paint a compelling picture for the ${direction}, with production trends well above this mark.`,
        `Clear value proposition here as ${playerName}'s recent form suggests the ${direction} hits comfortably.`
      ];
      parts.push(strongPhrases[verdictStyle]);
    } else if (diff > 0) {
      // Modest value - 3 ways to say it
      const modestPhrases = [
        `The numbers suggest modest value on the ${direction} given current production trends.`,
        `Recent form tilts slightly toward the ${direction}, presenting a reasonable value opportunity.`,
        `${playerName}'s trending performance offers decent support for taking the ${direction} here.`
      ];
      parts.push(modestPhrases[verdictStyle]);
    } else {
      // Against the stats - 3 ways to say it
      const contrarianPhrases = [
        `While the stats lean the other way, situational factors and matchup dynamics create an opportunity for the ${direction} to hit.`,
        `The numbers don't fully align, but game environment and matchup specifics could push this ${direction}.`,
        `Statistical headwinds present, yet matchup context and situational factors make the ${direction} intriguing.`
      ];
      parts.push(contrarianPhrases[verdictStyle]);
    }
  } else {
    // No reliable player-level stats available for this prop -> signal caller to skip it.
    return null;
  }
  
  return parts.join(' ');
}

function generateContraryEvidence(playerName, marketType) {
  return `Player performance can be inconsistent, and ${marketType.replace('player_', '')} props are subject to game script and injury concerns.`;
}

// Team prop formatting and reasoning
function formatTeamPropPick(marketType, outcome, odds) {
  const point = outcome.point;
  const teamName = outcome.name || outcome.description;
  
  // Determine direction (Over/Under)
  let direction = '';
  if (outcome.name && outcome.name.toLowerCase().includes('over')) direction = 'Over';
  else if (outcome.name && outcome.name.toLowerCase().includes('under')) direction = 'Under';
  
  // Format based on market type
  if (marketType === 'team_totals' || marketType === 'team_total') {
    return `${teamName} ${direction} ${point} Points`;
  }
  
  // Fallback
  return `${teamName} ${direction} ${point} ${marketType.replace('team_', '').replace('_', ' ')}`;
}

function generateTeamPropReasoning(marketType, outcome, odds, intelContext) {
  const propType = formatTeamPropPick(marketType, outcome, odds);
  const priceText = formatOdds(outcome.price);
  const matchupText = `${odds.away_team} @ ${odds.home_team}`;
  
  // Pull intel context if available
  let intelSnippet = '';
  if (intelContext && intelContext.context) {
    const firstLine = intelContext.context.split('\n')[0];
    if (firstLine) {
      intelSnippet = firstLine;
    }
  }
  
  // Build reasoning
  if (intelSnippet) {
    return `${propType} is priced at ${priceText} for the ${matchupText} matchup. ${intelSnippet}`;
  } else {
    return `${propType} is priced at ${priceText} for the ${matchupText} matchup.`;
  }
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

async function buildMatchupSnapshots(suggestions) {
  try {
    const nflSuggestions = (suggestions || []).filter(s => (s.sport || '').toUpperCase() === 'NFL');
    if (!nflSuggestions.length) return {};

    const teamSet = new Set();
    nflSuggestions.forEach(s => {
      if (s.homeTeam) teamSet.add(s.homeTeam);
      if (s.awayTeam) teamSet.add(s.awayTeam);
    });

    const teamNames = Array.from(teamSet);
    if (!teamNames.length) return {};

    const { data, error } = await supabase
      .from('current_standings')
      .select('team_name, wins, losses, ties, win_percentage, point_differential, streak')
      .in('team_name', teamNames);

    if (error || !data) {
      if (error) logger.error('Error fetching matchup standings', error);
      return {};
    }

    const standingsMap = new Map();
    data.forEach(row => {
      standingsMap.set(row.team_name, row);
    });

    const snapshots = {};

    const toRow = (row) => {
      const wins = row.wins ?? 0;
      const losses = row.losses ?? 0;
      const ties = row.ties ?? 0;
      const record = ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
      const pct = typeof row.win_percentage === 'number' ? row.win_percentage : null;
      const diff = typeof row.point_differential === 'number' ? row.point_differential : null;
      return {
        team: row.team_name,
        record,
        pct,
        diff,
        streak: row.streak || null
      };
    };

    nflSuggestions.forEach(s => {
      const homeRow = standingsMap.get(s.homeTeam);
      const awayRow = standingsMap.get(s.awayTeam);
      if (!homeRow || !awayRow) return;
      const key = `${s.awayTeam} @ ${s.homeTeam}`;
      if (snapshots[key]) return;
      snapshots[key] = {
        home: toRow(homeRow),
        away: toRow(awayRow)
      };
    });

    return snapshots;
  } catch (error) {
    logger.error('Error building matchup snapshots', error);
    return {};
  }
}

// Prevent logically conflicting traditional picks for the same game while
// still allowing picks from many different games.
//
// Rules enforced per suggestions response:
function dedupeConflictingGameSuggestions(suggestions) {
  const result = [];
  const gameState = new Map(); // key: sport|home|away -> { teamSides, totals }

  for (const s of suggestions || []) {
    if (!s || !s.homeTeam || !s.awayTeam || !s.betType) {
      result.push(s);
      continue;
    }

    const sport = (s.sport || '').toUpperCase();
    const gameKey = `${sport}|${s.homeTeam}|${s.awayTeam}`;
    if (!gameState.has(gameKey)) {
      gameState.set(gameKey, {
        teamSides: {},   // teamName -> { moneyline: bool, spread: bool }
        totals: { over: false, under: false }
      });
    }
    const state = gameState.get(gameKey);

    const betType = s.betType;

    // Moneyline / Spread: enforce "no opposing side" rule
    if (betType === 'Moneyline' || betType === 'Spread') {
      const teamName = (s.pick || '').toString();
      if (!teamName) {
        result.push(s);
        continue;
      }

      const ts = state.teamSides;
      const existingTeams = Object.keys(ts);
      let conflict = false;

      // If we already have a pick on the OPPOSING team (ML or Spread), skip
      for (const otherTeam of existingTeams) {
        if (otherTeam !== teamName && (ts[otherTeam].moneyline || ts[otherTeam].spread)) {
          conflict = true;
          break;
        }
      }
      if (conflict) {
        continue;
      }

      // Also avoid stacking ML+Spread on the same team for independent picks
      if (!ts[teamName]) {
        ts[teamName] = { moneyline: false, spread: false };
      }
      if (ts[teamName].moneyline || ts[teamName].spread) {
        // Same-team ML/Spread already present -> treat as conflict and skip
        continue;
      }

      // Record this side and keep the pick
      if (betType === 'Moneyline') ts[teamName].moneyline = true;
      if (betType === 'Spread') ts[teamName].spread = true;
      result.push(s);
      continue;
    }

    // Totals: prevent Over + Under on same game
    if (betType === 'Total') {
      const pickName = (s.pick || '').toString().toLowerCase();
      const isOver = pickName.includes('over');
      const isUnder = pickName.includes('under');

      if (!isOver && !isUnder) {
        result.push(s);
        continue;
      }

      if (isOver && state.totals.over) {
        continue; // duplicate Over
      }
      if (isUnder && state.totals.under) {
        continue; // duplicate Under
      }
      if ((isOver && state.totals.under) || (isUnder && state.totals.over)) {
        // Opposing total already present
        continue;
      }

      if (isOver) state.totals.over = true;
      if (isUnder) state.totals.under = true;
      result.push(s);
      continue;
    }

    // Everything else (props, team props, etc.) passes through unchanged
    result.push(s);
  }

  return result;
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
      suggestionCount,
      generationMode
    } = req.body;

    // Normalize frontend generationMode label into an internal generateMode string
    const generateMode = generationMode || 'AI Edge Advantages';

    // Determine number of suggestions based on target leg count
    // CACHE MODE: Generate 20 suggestions always for better caching
    let numSuggestions = suggestionCount || 20; // Always generate 20 for cache
    
    // Cap at reasonable max
    numSuggestions = Math.max(15, Math.min(30, Math.round(numSuggestions)));
    
    // Production: Allow full range for better user experience
    const isProduction = process.env.NODE_ENV === 'production';

    logger.info('Generating pick suggestions', {
      selectedSports,
      selectedBetTypes,
      riskLevel,
      dateRange,
      numSuggestions,
      generateMode,
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

    // CACHE DISABLED for game day - odds change too fast
    // TODO: Re-enable for non-game-day scenarios (tomorrow's games, etc)
    // const cache = new SuggestionsCache(supabase);
    
    console.log('📭 Generating fresh suggestions (cache disabled for game day)...');

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

    // Check which bet types are requested
    const wantsPropTypes = selectedBetTypes.filter(bt => bt === 'Player Props' || bt === 'TD Props' || bt === 'Team Props');
    const wantsTraditionalTypes = selectedBetTypes.filter(bt => 
      bt === 'Moneyline' || 
      bt === 'Spread' || 
      bt === 'Total' || 
      bt === 'Totals (O/U)' || // Handle frontend format
      bt === 'Moneyline/Spread'
    );
    
    console.log(`📋 Bet type detection:`);
    console.log(`   Props requested: ${wantsPropTypes.length > 0 ? wantsPropTypes.join(', ') : 'None'}`);
    console.log(`   Traditional requested: ${wantsTraditionalTypes.length > 0 ? wantsTraditionalTypes.join(', ') : 'None'}`);
    
    let allSuggestions = [];

    // Generate props if requested
    if (wantsPropTypes.length > 0) {
      const result = await generatePlayerPropSuggestions({
        sports: selectedSports,
        betTypes: selectedBetTypes,
        riskLevel,
        numSuggestions,
        sportsbook: req.body.oddsPlatform || 'DraftKings',
        playerData,
        supabase,
        coordinator,
        selectedBetTypes,
        dateRange
      });
      
      if (result.suggestions && result.suggestions.length > 0) {
        allSuggestions = allSuggestions.concat(result.suggestions);
        console.log(`✅ Generated ${result.suggestions.length} prop suggestions`);
      } else {
        console.log('⚠️ No prop suggestions generated');
      }
    }

    // Generate traditional bets (Moneyline/Spread/Total) if requested
    if (wantsTraditionalTypes.length > 0) {
      console.log(`🎲 Generating traditional bet suggestions for: ${wantsTraditionalTypes.join(', ')}`);

      try {
        const traditionalResult = await coordinator.generatePickSuggestions({
          sports: selectedSports,
          betTypes: wantsTraditionalTypes, // Only traditional types
          riskLevel,
          dateRange,
          numSuggestions: Math.ceil(numSuggestions / 2), // Split suggestions between props and traditional
          sportsbook: req.body.oddsPlatform || 'DraftKings',
          playerContext: playerData
        });

        if (traditionalResult.suggestions && traditionalResult.suggestions.length > 0) {
          allSuggestions = allSuggestions.concat(traditionalResult.suggestions);
          console.log(`✅ Generated ${traditionalResult.suggestions.length} traditional bet suggestions`);
        } else {
          console.log(`⚠️ Coordinator returned 0 traditional suggestions`);
        }
      } catch (error) {
        console.error(`❌ Error generating traditional suggestions:`, error.message);
        console.error(error.stack);
        // Continue with props only - don't fail entire request
      }
    }

    // If no suggestions generated at all, return error
    if (allSuggestions.length === 0) {
      logger.warn('No suggestions generated', { selectedSports, selectedBetTypes });
      return res.status(404).json({
        success: false,
        error: 'No betting opportunities found for selected criteria'
      });
    }

    const matchupSnapshots = await buildMatchupSnapshots(allSuggestions);
    const enrichedSuggestions = allSuggestions.map(pick => {
      const key = `${pick.awayTeam} @ ${pick.homeTeam}`;
      const snapshot = matchupSnapshots[key];
      return snapshot ? { ...pick, matchupSnapshot: snapshot } : pick;
    });

    const duration = Date.now() - startTime;

    // First, drop directly conflicting traditional picks for the same game so
    // users never see both sides (e.g., both moneylines or both Over and
    // Under on the same total) in a single suggestions set.
    let workingSuggestions = dedupeConflictingGameSuggestions(enrichedSuggestions);

    // Apply generateMode-specific post-processing before final selection
    // Heavy Favorites: prefer strong favorites (more negative odds). If none match,
    // fall back to the full suggestion set so the user still sees picks.
    if (generateMode === 'Heavy Favorites') {
      const heavyOnly = workingSuggestions.filter(s => {
        if (!s || s.odds == null) return false;
        const price = parseInt(String(s.odds), 10);
        return !Number.isNaN(price) && price <= -150;
      });

      if (heavyOnly.length > 0) {
        console.log(`🎯 Heavy Favorites mode: filtered to ${heavyOnly.length} strong favorite picks`);
        workingSuggestions = heavyOnly;
      } else {
        console.log('⚠️ Heavy Favorites mode: no strong favorites found, using all suggestions instead');
      }
    }

    let finalSuggestions;

    if (generateMode === 'Top Picks of the Day') {
      // Rank by a simple score using confidence and edge type, then return a
      // small set of highest-conviction plays.
      const scored = workingSuggestions.map(s => ({
        pick: s,
        score: (s.confidence || 5) + (s.edgeType === 'line_value' ? 1 : 0)
      }));

      scored.sort((a, b) => b.score - a.score);

      const desired = suggestionCount || 5;
      const maxCount = Math.min(desired, scored.length || 0);
      const topCount = Math.max(3, Math.min(10, maxCount));

      finalSuggestions = scored.slice(0, topCount).map(entry => entry.pick);
      console.log(`🏆 Top Picks mode: selected ${finalSuggestions.length} highest-conviction plays`);
    } else {
      // AI Edge / Heavy Favorites: shuffle for variety and trim to requested count
      finalSuggestions = workingSuggestions
        .slice()
        .sort(() => Math.random() - 0.5)
        .slice(0, numSuggestions);
    }

    logger.info('Pick suggestions generated', {
      totalGenerated: allSuggestions.length,
      returnedAfterShuffle: finalSuggestions.length,
      duration: `${duration}ms`,
      generateMode
    });

    // CACHE DISABLED - Don't store (odds change too fast on game day)
    // await cache.store(...)
    
    // Store AI suggestions for tracking model performance
    const sessionId = await storeAISuggestions(finalSuggestions, {
      riskLevel,
      generateMode,
      userId: req.user?.id
    });

    res.json({
      success: true,
      suggestions: finalSuggestions,
      sessionId, // Include session ID for tracking
      metadata: {
        requestedSuggestions: numSuggestions,
        returnedSuggestions: finalSuggestions.length,
        totalGenerated: allSuggestions.length,
        propSuggestions: allSuggestions.filter(s => s.betType === 'Player Props' || s.betType === 'TD' || s.betType === 'Team Props').length,
        traditionalSuggestions: allSuggestions.filter(s => s.betType === 'Moneyline' || s.betType === 'Spread' || s.betType === 'Total').length,
        sports: selectedSports,
        betTypes: selectedBetTypes,
        riskLevel,
        generateMode,
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
