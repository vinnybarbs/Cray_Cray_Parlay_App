// Targeted Odds Agent - Respects user's sportsbook choice with smart fallbacks
const SPORT_SLUGS = {
  NFL: 'americanfootball_nfl',
  NBA: 'basketball_nba',
  MLB: 'baseball_mlb',
  NHL: 'icehockey_nhl',
  Soccer: 'soccer_epl',
  NCAAF: 'americanfootball_ncaaf',
  'PGA/Golf': 'golf_pga',
  Tennis: 'tennis_atp',
  UFC: 'mma_ufc',
};

const BOOKMAKER_MAPPING = {
  DraftKings: 'draftkings',
  FanDuel: 'fanduel',
  MGM: 'mgm',
  Caesars: 'caesars',
  Bet365: 'bet365',
};

// Valid market keys per The Odds API documentation
// https://the-odds-api.com/sports-odds-data/betting-markets.html
const MARKET_MAPPING = {
  // User-selectable bet types
  'Moneyline/Spread': ['h2h', 'spreads'],
  'Totals (O/U)': ['totals'],
  'Player Props': [
    // NFL/Football player props
    'player_pass_yds', 'player_pass_tds', 'player_pass_completions', 'player_pass_attempts',
    'player_rush_yds', 'player_rush_tds', 'player_rush_attempts',
    'player_receptions', 'player_reception_yds', 'player_reception_tds',
    // Basketball player props
    'player_points', 'player_rebounds', 'player_assists', 'player_threes',
    // Hockey player props  
    'player_shots_on_goal', 'player_goals',
    // Baseball player props
    'batter_hits', 'batter_home_runs', 'pitcher_strikeouts'
  ],
  'TD Props': [
    // Valid touchdown markets per API docs
    'player_pass_tds',        // Pass TDs (Over/Under)
    'player_rush_tds',        // Rush TDs (Over/Under) 
    'player_reception_tds',   // Reception TDs (Over/Under)
    'player_anytime_td',      // Anytime TD Scorer (Yes/No)
    'player_1st_td',          // 1st TD Scorer (Yes/No)
    'player_last_td'          // Last TD Scorer (Yes/No)
  ],
  'Team Props': ['team_totals'],
  // Internal keys for smart auto-expansion (not user-selectable)
  '_player_props': [
    'player_pass_yds', 'player_rush_yds', 'player_receptions', 'player_reception_yds',
    'player_pass_tds', 'player_anytime_td'
  ],
  '_team_props': ['team_totals'],
};

class TargetedOddsAgent {
  constructor(fetcher, apiKey, supabase = null) {
    this.fetcher = fetcher;
    this.apiKey = apiKey;
    this.supabase = supabase;
    this.fallbackBooks = {
      'draftkings': ['fanduel', 'mgm', 'caesars'],
      'fanduel': ['draftkings', 'mgm', 'caesars'],
      'mgm': ['draftkings', 'fanduel', 'caesars'],
      'caesars': ['draftkings', 'fanduel', 'mgm'],
      'bet365': ['draftkings', 'fanduel', 'mgm']
    };
    
    // Add response caching
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
    
    // Track in-flight requests to avoid duplicates
    this.pendingRequests = new Map();
  }

  /**
   * Fetch odds from Supabase cache (if available)
   * Falls back to live API if cache is empty or stale
   */
  async fetchFromCache(sports, bookmaker, markets, rangeEnd = null) {
    if (!this.supabase) {
      console.log('📦 No Supabase client - skipping cache');
      return null;
    }

    try {
      const sportSlugs = sports.map(s => SPORT_SLUGS[s]).filter(Boolean);
      
      // Query cache for recent odds (within last 24 hours)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      // Only get games that haven't started yet (commence_time in the future)
      const now = new Date().toISOString();
      
      console.log(`📊 Cache query: sports=${sportSlugs.join(',')}, bookmaker=${bookmaker}, markets=${markets.length} types`);
      console.log(`🕐 Filtering games: commence_time > ${now}${rangeEnd ? ` AND < ${rangeEnd.toISOString()}` : ''}`);
      
      let query = this.supabase
        .from('odds_cache')
        .select('*')
        .in('sport', sportSlugs)
        .eq('bookmaker', bookmaker)
        .in('market_type', markets)
        .gte('last_updated', oneDayAgo)
        .gt('commence_time', now);  // 🎯 CRITICAL: Only future games
      
      // Apply date range filter if provided
      if (rangeEnd) {
        query = query.lt('commence_time', rangeEnd.toISOString());
      }
      
      const { data, error } = await query.order('last_updated', { ascending: false });

      if (error) {
        console.log(`⚠️ Cache query error: ${error.message}`);
        return null;
      }

      let rows = data || [];

      if (!rows.length) {
        console.log('📦 No fresh cached odds found in last 24h. Retrying without last_updated freshness filter...');

        // Retry without last_updated constraint so older-but-future games in the cache
        // are still usable instead of treating the cache as completely empty.
        let fallbackQuery = this.supabase
          .from('odds_cache')
          .select('*')
          .in('sport', sportSlugs)
          .eq('bookmaker', bookmaker)
          .in('market_type', markets)
          .gt('commence_time', now);

        if (rangeEnd) {
          fallbackQuery = fallbackQuery.lt('commence_time', rangeEnd.toISOString());
        }

        const { data: fallbackData, error: fallbackError } = await fallbackQuery.order('last_updated', { ascending: false });

        if (fallbackError) {
          console.log(`⚠️ Fallback cache query (no freshness filter) error: ${fallbackError.message}`);
          return [];
        }

        rows = fallbackData || [];

        if (!rows.length) {
          console.log('📦 Cache truly empty for requested sports/bookmaker/markets after fallback.');
          return [];
        }

        console.log(`🔁 Using ${rows.length} cached odds rows without freshness filter (may be older snapshot data).`);
      }

      // Transform cache data back to Odds API format
      const gameMap = new Map();
      
      for (const row of rows) {
        const gameKey = row.external_game_id;
        
        if (!gameMap.has(gameKey)) {
          gameMap.set(gameKey, {
            id: row.external_game_id,
            sport_key: row.sport,
            sport_title: row.sport.toUpperCase(),
            commence_time: row.commence_time,
            home_team: row.home_team,
            away_team: row.away_team,
            bookmakers: []
          });
        }

        const game = gameMap.get(gameKey);
        let bookmakerEntry = game.bookmakers.find(b => b.key === row.bookmaker);
        
        if (!bookmakerEntry) {
          bookmakerEntry = {
            key: row.bookmaker,
            title: row.bookmaker,
            last_update: row.last_update,
            markets: []
          };
          game.bookmakers.push(bookmakerEntry);
        }

        bookmakerEntry.markets.push({
          key: row.market_type,
          last_update: row.last_update,
          outcomes: row.outcomes
        });
      }

  const cachedGames = Array.from(gameMap.values());
  console.log(`✅ Cache hit: ${cachedGames.length} games from cache`);
      
  return cachedGames;
    } catch (error) {
      console.log(`❌ Cache fetch error: ${error.message}`);
      return null;
    }
  }

  async fetchOddsForSelectedBook(request) {
    const { oddsPlatform, selectedSports, selectedBetTypes, numLegs, dateRange } = request;
    const primaryBook = BOOKMAKER_MAPPING[oddsPlatform];
    
    console.log(`🎯 Fetching odds from user's selected book: ${oddsPlatform}`);
    
    // Clean expired cache entries
    this.cleanExpiredCache();
    
    // Calculate date range
    const { now, rangeEnd } = this.calculateDateRange(dateRange);
    
    try {
      // Try primary book first
      const capCount = Math.max(10, (parseInt(request.numLegs) || 6) * 2);
      let currentBetTypes = [...selectedBetTypes];
      let primaryOdds = await this.fetchFromBook(primaryBook, selectedSports, currentBetTypes, now, rangeEnd, { fastMode: !!request.fastMode, capCount });
      
      // 🚨 CRITICAL: If we got 0 games, the bet type markets may not be available yet
      if (primaryOdds.length === 0 && !currentBetTypes.includes('ALL')) {
        const hasPlayerProps = currentBetTypes.some(bt => 
          ['Player Props', 'TD Props'].includes(bt) || bt.startsWith('_player')
        );
        
        if (hasPlayerProps) {
          console.log(`🚨 Got 0 games with player props! Props may not be available yet for this date range.`);
          console.log(`💡 Falling back to core markets (Moneyline/Spread, Totals)...`);
        } else {
          console.log(`🚨 Got 0 games! Falling back to core markets...`);
        }
        
        currentBetTypes = ['Moneyline/Spread', 'Totals (O/U)'];
        primaryOdds = await this.fetchFromBook(primaryBook, selectedSports, currentBetTypes, now, rangeEnd, { fastMode: !!request.fastMode, capCount });
        console.log(`📊 After fallback: ${primaryOdds.length} games available`);
        request.marketExpanded = true;
        request.selectedBetTypes = currentBetTypes;
        request.fallbackReason = hasPlayerProps ? 'player-props-unavailable' : 'no-games-found';
      }
      
      // 🧠 SMART MARKET EXPANSION: Check if we have enough bet options
      const requiredBets = numLegs * 2; // Need 2x legs for safe selection
      const availableBets = primaryOdds.length;
      
      console.log(`📊 Initial fetch: ${availableBets} bets available, need ${requiredBets} for ${numLegs} legs`);
      
      if (availableBets < requiredBets && !currentBetTypes.includes('ALL')) {
        console.log(`⚡ Insufficient bets! Auto-expanding markets...`);
        
        // Expand to include player props if not already included (use internal key)
        if (!currentBetTypes.includes('_player_props') && !currentBetTypes.includes('All') && !currentBetTypes.includes('all')) {
          currentBetTypes.push('_player_props');
          console.log(`➕ Added _player_props to bet types`);
          
          // Re-fetch with expanded markets
          primaryOdds = await this.fetchFromBook(primaryBook, selectedSports, currentBetTypes, now, rangeEnd, { fastMode: !!request.fastMode, capCount });
          console.log(`📊 After adding _player_props: ${primaryOdds.length} bets available`);
        }
        
        // If still insufficient, add team props (use internal key)
        if (primaryOdds.length < requiredBets && !currentBetTypes.includes('_team_props')) {
          currentBetTypes.push('_team_props');
          console.log(`➕ Added _team_props to bet types`);
          
          // Re-fetch with further expanded markets
          primaryOdds = await this.fetchFromBook(primaryBook, selectedSports, currentBetTypes, now, rangeEnd, { fastMode: !!request.fastMode, capCount });
          console.log(`📊 After adding team_props: ${primaryOdds.length} bets available`);
        }
        
        // Update request with expanded bet types for downstream agents
        request.selectedBetTypes = currentBetTypes;
        request.marketExpanded = true;
      }
      
      if (this.hasSufficientData(primaryOdds, numLegs)) {
        console.log(`✅ Primary book ${oddsPlatform} has sufficient data`);
        return {
          odds: primaryOdds,
          source: oddsPlatform,
          fallbackUsed: false,
          dataQuality: this.calculateDataQuality(primaryOdds),
          cached: this.cache.size > 0 ? `${this.cache.size} entries` : 'none',
          marketExpanded: request.marketExpanded || false
        };
      } else {
        console.log(`⚠️ Primary book ${oddsPlatform} insufficient data, trying fallbacks`);
        return await this.tryFallbacks(primaryBook, primaryOdds, request, now, rangeEnd);
      }
      
    } catch (error) {
      console.log(`❌ Primary book ${oddsPlatform} failed: ${error.message}`);
      return await this.tryFallbacks(primaryBook, [], request, now, rangeEnd);
    }
  }

  calculateDateRange(dateRange) {
    const now = new Date();
    const nowMT = now.toLocaleString('en-US', { timeZone: 'America/Denver', hour12: true });
    console.log(`🕐 Current time: ${now.toISOString()} (${nowMT} MT)`);
    
    // Simplified date range logic
    let rangeEnd;
    if (dateRange === 1) {
      // For 1 day: next 30 hours to handle timezone issues
      rangeEnd = new Date(now.getTime() + 30 * 60 * 60 * 1000);
      const rangeEndMT = rangeEnd.toLocaleString('en-US', { timeZone: 'America/Denver', hour12: true });
      console.log(`📅 1 day mode: until ${rangeEnd.toISOString()} (${rangeEndMT} MT)`);
    } else {
      // For multi-day: exact calculation
      rangeEnd = new Date(now.getTime() + dateRange * 24 * 60 * 60 * 1000);
      const rangeEndMT = rangeEnd.toLocaleString('en-US', { timeZone: 'America/Denver', hour12: true });
      console.log(`📅 ${dateRange} day mode: until ${rangeEnd.toISOString()} (${rangeEndMT} MT)`);
    }
    
    return { now, rangeEnd };
  }

  async fetchFromBook(bookmaker, sports, betTypes, now, rangeEnd, { fastMode = false, capCount = 12 } = {}) {
    const allOddsResults = [];
    
    // ALWAYS try cache first if Supabase is available
    const allowLiveFetch = process.env.ODDS_ALLOW_LIVE_FETCH === 'true' || !!(arguments[5] && arguments[5].allowLiveFetch);
    if (this.supabase) {
      try {
        // Map bet types to markets
        const requestedMarkets = betTypes.flatMap(bt => MARKET_MAPPING[bt] || []);
        console.log(`🔍 Checking cache for markets: ${requestedMarkets.join(', ')}`);
        
        const cachedOdds = await this.fetchFromCache(sports, bookmaker, requestedMarkets, rangeEnd);
        if (cachedOdds && cachedOdds.length > 0) {
          console.log(`✅ Using ${cachedOdds.length} games from cache (filtered by date range)`);
          return cachedOdds;
        } else {
          console.log(`⚠️ No cached odds found - cache may be empty or stale`);
          // If Supabase is configured, do NOT fall back to live fetching unless explicitly allowed.
          if (!allowLiveFetch) {
            console.log('🔒 Cache-only mode active: not attempting live Odds API fetch');
            return [];
          }
        }
      } catch (cacheError) {
        console.log(`⚠️ Cache read failed: ${cacheError.message}`);
        if (!allowLiveFetch) {
          console.log('🔒 Cache-only mode active: aborting live fetch due to cache read failure');
          return [];
        }
      }
    }
    
  // If no cache (or cache allowed to be bypassed), and live fetch is permitted, proceed to live fetching
  const sportNames = sports.map(s => s.toUpperCase()).join(', ');
  console.log(`⚠️ No cached games for ${sportNames} in Supabase (or cache stale) — proceeding to live fetch from Odds API (if permitted)`);
  // Log what bet types we received from the user
  console.log(`🎯 User selected bet types:`, betTypes);
    
    // Handle "ALL" bet types by expanding to all available markets
    let requestedMarkets;
    if (betTypes.includes('ALL') || betTypes.includes('All') || betTypes.includes('all')) {
      requestedMarkets = fastMode ? ['h2h','spreads','totals'] : Object.values(MARKET_MAPPING).flat();
      console.log(`🔥 ALL bet types selected - markets: ${requestedMarkets.join(', ')} (fastMode=${fastMode})`);
    } else {
      requestedMarkets = betTypes.flatMap(bt => {
        const markets = MARKET_MAPPING[bt];
        if (!markets) {
          console.warn(`⚠️  Unknown bet type "${bt}" - no market mapping found`);
          return [];
        }
        return markets;
      });
      console.log(`📋 Mapped to API markets:`, requestedMarkets);
      if (fastMode) {
        // In fast mode, trim to core markets
        requestedMarkets = requestedMarkets.filter(m => ['h2h','spreads','totals'].includes(m));
      }
    }
    
    for (const sport of sports) {
  const slug = SPORT_SLUGS[sport];
      if (!slug) continue;

      console.log(`\n📊 Fetching ${sport} from ${bookmaker}...`);

      const regularMarkets = requestedMarkets.filter(m => 
        !m.startsWith('player_') && !m.startsWith('team_')
      );
      const propMarkets = requestedMarkets.filter(m => 
        m.startsWith('player_') || m.startsWith('team_')
      );

      console.log(`  📋 Split: ${regularMarkets.length} regular markets, ${propMarkets.length} prop markets`);

      // Fetch regular and props in parallel (props skipped in fast mode)
      const tasks = [];
      let regularPromise = null;
      if (regularMarkets.length > 0) {
        console.log(`  ⚡ Fetching regular markets: ${regularMarkets.slice(0, 3).join(', ')}${regularMarkets.length > 3 ? '...' : ''}`);
        regularPromise = this.fetchRegularMarkets(slug, bookmaker, regularMarkets, now, rangeEnd);
        tasks.push(regularPromise);
      }
      let propsPromise = null;
      if (!fastMode && propMarkets.length > 0) {
        console.log(`  ⚡ Fetching player props (per-event): ${propMarkets.slice(0, 3).join(', ')}${propMarkets.length > 3 ? '...' : ''}`);
        propsPromise = this.fetchPropMarkets(slug, bookmaker, propMarkets, now, rangeEnd);
        tasks.push(propsPromise);
      } else if (fastMode && propMarkets.length > 0) {
        console.log(`  ⏩ Skipping ${propMarkets.length} prop markets (fast mode)`);
      }
      if (tasks.length > 0) {
        await Promise.allSettled(tasks);
        if (regularPromise) {
          try {
            const regularOdds = await regularPromise;
            const capped = fastMode ? regularOdds.slice(0, capCount) : regularOdds;
            allOddsResults.push(...capped);
          } catch {/* ignore; logged inside fetch */}
        }
        if (propsPromise) {
          try {
            const propOdds = await propsPromise;
            allOddsResults.push(...propOdds);
          } catch {/* ignore; logged inside fetch */}
        }
      }
    }

    return allOddsResults;
  }

  // Cache management methods
  getCacheKey(slug, bookmaker, markets, commenceTimeFrom, commenceTimeTo) {
    const marketKey = Array.isArray(markets) ? markets.sort().join(',') : markets;
    const dateKey = commenceTimeFrom && commenceTimeTo 
      ? `-${commenceTimeFrom}-${commenceTimeTo}` 
      : '';
    return `${slug}-${bookmaker}-${marketKey}${dateKey}`;
  }

  isValidCacheEntry(entry) {
    return entry && (Date.now() - entry.timestamp) < this.cacheExpiry;
  }

  // Enhanced fetch with caching and deduplication
  async fetchWithCache(url, cacheKey) {
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (this.isValidCacheEntry(cached)) {
      console.log(`  💾 Cache hit for ${cacheKey}`);
      return cached.data;
    }

    // Check if request is already in flight
    if (this.pendingRequests.has(cacheKey)) {
      console.log(`  ⏳ Request already pending for ${cacheKey}`);
      return await this.pendingRequests.get(cacheKey);
    }

    // Make the request
    const requestPromise = this.makeRequest(url);
    this.pendingRequests.set(cacheKey, requestPromise);

    try {
      const data = await requestPromise;
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: data,
        timestamp: Date.now()
      });
      
      // Clean up pending request
      this.pendingRequests.delete(cacheKey);
      
      return data;
    } catch (error) {
      // Clean up pending request on error
      this.pendingRequests.delete(cacheKey);
      throw error;
    }
  }

  async makeRequest(url) {
    const response = await this.fetcher(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }
    
    return await response.json();
  }

  async fetchRegularMarkets(slug, bookmaker, markets, now, rangeEnd) {
    const marketsStr = markets.join(',');
    // Use API's date filtering parameters to only get games in our time range
    // Remove milliseconds from ISO string (API requires YYYY-MM-DDTHH:MM:SSZ format)
    const commenceTimeFrom = now.toISOString().split('.')[0] + 'Z';
    const commenceTimeTo = rangeEnd.toISOString().split('.')[0] + 'Z';
    const cacheKey = this.getCacheKey(slug, bookmaker, markets, commenceTimeFrom, commenceTimeTo);
    const url = `https://api.the-odds-api.com/v4/sports/${slug}/odds/?regions=us&markets=${encodeURIComponent(marketsStr)}&oddsFormat=american&bookmakers=${bookmaker}&commenceTimeFrom=${commenceTimeFrom}&commenceTimeTo=${commenceTimeTo}&apiKey=${this.apiKey}`;
    
    try {
      console.log(`  📡 Regular markets: ${markets.join(', ')}`);
      console.log(`  📅 Date filter: ${commenceTimeFrom} to ${commenceTimeTo}`);
      
      // Use cached/deduplicated fetch
      const data = await this.fetchWithCache(url, cacheKey);
      
      if (Array.isArray(data) && data.length > 0) {
        console.log(`  ✓ API returned ${data.length} games in date range`);
        
        // Debug: Log first few games with Mountain Time
        data.slice(0, 3).forEach(game => {
          const gameDateMT = new Date(game.commence_time).toLocaleString('en-US', { 
            timeZone: 'America/Denver',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });
          console.log(`    ${game.away_team} @ ${game.home_team}: ${gameDateMT} MT`);
        });
        
        return data;
      } else {
        console.log(`  ⚠️ API returned no games or invalid data`);
      }
    } catch (error) {
      console.log(`  ❌ Regular markets failed: ${error.message}`);
    }
    
    return [];
  }

  // Utility function to batch arrays
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  async fetchPropMarkets(slug, bookmaker, markets, now, rangeEnd) {
    console.log(`  🎯 Fetching player props for ${markets.length} markets using per-event endpoint`);
    
    // Step 1: Get all events (games) first using basic markets to get event IDs
    console.log(`  📡 Step 1: Fetching events to get event IDs...`);
    // Remove milliseconds from ISO string (API requires YYYY-MM-DDTHH:MM:SSZ format)
    const commenceTimeFrom = now.toISOString().split('.')[0] + 'Z';
    const commenceTimeTo = rangeEnd.toISOString().split('.')[0] + 'Z';
    const eventsCacheKey = this.getCacheKey(slug, bookmaker, ['h2h'], commenceTimeFrom, commenceTimeTo);
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/${slug}/odds/?regions=us&markets=h2h&oddsFormat=american&bookmakers=${bookmaker}&commenceTimeFrom=${commenceTimeFrom}&commenceTimeTo=${commenceTimeTo}&apiKey=${this.apiKey}`;
    
    let events = [];
    try {
      events = await this.fetchWithCache(eventsUrl, eventsCacheKey);
      if (!Array.isArray(events) || events.length === 0) {
        console.log(`  ⚠️ No events found for props`);
        return [];
      }
      console.log(`  ✓ Found ${events.length} events`);
    } catch (error) {
      console.log(`  ❌ Failed to fetch events: ${error.message}`);
      return [];
    }
    
    // Step 2: Fetch props for each event using /events/{eventId}/odds endpoint
    console.log(`  📡 Step 2: Fetching props for ${events.length} events...`);
    const propResults = [];
    const marketStr = markets.join(',');
    
    // Batch the event fetching with concurrency control
    const concurrency = 3; // Fetch 3 events at a time
    let eventIndex = 0;
    
    const worker = async () => {
      while (eventIndex < events.length) {
        const myIndex = eventIndex++;
        const event = events[myIndex];
        
        try {
          const eventId = event.id;
          const propCacheKey = `event-${eventId}-${bookmaker}-${marketStr}`;
          const propUrl = `https://api.the-odds-api.com/v4/sports/${slug}/events/${eventId}/odds/?regions=us&markets=${encodeURIComponent(marketStr)}&oddsFormat=american&bookmakers=${bookmaker}&apiKey=${this.apiKey}`;
          
          const eventData = await this.fetchWithCache(propUrl, propCacheKey);
          
          if (eventData && eventData.bookmakers && eventData.bookmakers.length > 0) {
            // 🚨 CRITICAL: Filter player props to only include players from teams in this game
            const homeTeam = event.home_team.toLowerCase();
            const awayTeam = event.away_team.toLowerCase();
            
            eventData.bookmakers = eventData.bookmakers.map(bookmaker => {
              if (!bookmaker.markets) return bookmaker;
              
              bookmaker.markets = bookmaker.markets.map(market => {
                // Skip non-player markets
                if (!market.key.startsWith('player_')) return market;
                
                // Filter outcomes to only include players whose description contains team name
                const originalCount = market.outcomes?.length || 0;
                market.outcomes = (market.outcomes || []).filter(outcome => {
                  const desc = (outcome.description || '').toLowerCase();
                  // Check if player description contains home or away team
                  // The Odds API format: "Brock Purdy (SF)" or just "Brock Purdy"
                  const matchesHomeTeam = desc.includes(homeTeam) || desc.includes(`(${homeTeam.substring(0, 3)})`) || desc.includes(event.home_team.substring(0, 3).toLowerCase());
                  const matchesAwayTeam = desc.includes(awayTeam) || desc.includes(`(${awayTeam.substring(0, 3)})`) || desc.includes(event.away_team.substring(0, 3).toLowerCase());
                  
                  if (!matchesHomeTeam && !matchesAwayTeam) {
                    console.log(`      ⚠️ Filtered out invalid player: ${outcome.description} (not ${event.away_team} or ${event.home_team})`);
                    return false;
                  }
                  return true;
                });
                
                const filteredCount = market.outcomes.length;
                if (filteredCount < originalCount) {
                  console.log(`      🔍 ${market.key}: ${originalCount} → ${filteredCount} outcomes (removed ${originalCount - filteredCount} invalid players)`);
                }
                
                return market;
              }).filter(market => market.outcomes && market.outcomes.length > 0); // Remove empty markets
              
              return bookmaker;
            });
            
            // Merge prop markets into the base event data
            const enrichedEvent = {
              ...event,
              bookmakers: eventData.bookmakers
            };
            propResults.push(enrichedEvent);
            console.log(`    ✓ Event ${myIndex + 1}/${events.length}: ${event.away_team} @ ${event.home_team} - ${eventData.bookmakers[0].markets?.length || 0} prop markets`);
          } else {
            console.log(`    ⚠️ Event ${myIndex + 1}/${events.length}: No props for ${event.away_team} @ ${event.home_team}`);
          }
        } catch (error) {
          console.log(`    ❌ Event ${myIndex + 1}/${events.length} failed: ${error.message}`);
        }
      }
    };
    
    // Run workers in parallel
    const workers = Array.from({ length: Math.min(concurrency, events.length) }, () => worker());
    await Promise.all(workers);
    
    console.log(`  ✓ Total prop results: ${propResults.length} events with player props`);
    return propResults;
  }

  async tryFallbacks(primaryBook, existingOdds, request, now, rangeEnd) {
    const fallbacks = this.fallbackBooks[primaryBook] || ['draftkings', 'fanduel'];
    
    for (const fallbackBook of fallbacks) {
      try {
        console.log(`🔄 Trying fallback: ${fallbackBook}`);
        const fallbackOdds = await this.fetchFromBook(fallbackBook, request.selectedSports, request.selectedBetTypes, now, rangeEnd);
        
        // Combine with existing data
        const combinedOdds = this.combineOddsData(existingOdds, fallbackOdds);
        
        if (this.hasSufficientData(combinedOdds, request.numLegs)) {
          console.log(`✅ Sufficient data achieved with fallback: ${fallbackBook}`);
          return {
            odds: combinedOdds,
            source: `${request.oddsPlatform} + ${fallbackBook}`,
            fallbackUsed: true,
            fallbackReason: 'Insufficient games in primary book',
            dataQuality: this.calculateDataQuality(combinedOdds)
          };
        }
      } catch (error) {
        console.log(`❌ Fallback ${fallbackBook} failed: ${error.message}`);
        continue;
      }
    }
    
    // If all fallbacks fail, return what we have
    return {
      odds: existingOdds,
      source: request.oddsPlatform,
      fallbackUsed: false,
      warning: 'Limited data available',
      dataQuality: this.calculateDataQuality(existingOdds)
    };
  }

  hasSufficientData(odds, requiredLegs) {
    const totalGames = odds.length;
    const gamesWithMarkets = odds.filter(game => 
      game.bookmakers && game.bookmakers[0] && 
      game.bookmakers[0].markets && 
      game.bookmakers[0].markets.length >= 1
    ).length;
    
    // Need at least requiredLegs games for the parlay
    const sufficient = totalGames >= requiredLegs && gamesWithMarkets >= requiredLegs;
    console.log(`📊 Data sufficiency: ${totalGames} total games, ${gamesWithMarkets} with markets, need ${requiredLegs} - ${sufficient ? 'SUFFICIENT' : 'INSUFFICIENT'}`);
    
    return sufficient;
  }

  combineOddsData(primary, fallback) {
    // Merge odds data efficiently, preferring primary book data
    const combined = [...primary];
    const primaryGameIds = new Set(primary.map(g => g.id));
    
    // Add fallback games that aren't in primary (more efficient filtering)
    const uniqueFallbackGames = fallback.filter(game => !primaryGameIds.has(game.id));
    combined.push(...uniqueFallbackGames);
    
    console.log(`📊 Combined data: ${primary.length} primary + ${uniqueFallbackGames.length} fallback = ${combined.length} total`);
    return combined;
  }

  calculateDataQuality(odds) {
    if (!odds || odds.length === 0) return 0;
    
    const gamesWithFullMarkets = odds.filter(game => 
      game.bookmakers && 
      game.bookmakers[0] && 
      game.bookmakers[0].markets && 
      game.bookmakers[0].markets.length >= 2
    ).length;
    
    return Math.round((gamesWithFullMarkets / odds.length) * 100);
  }

  // Cache cleanup method
  cleanExpiredCache() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if ((now - entry.timestamp) >= this.cacheExpiry) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned ${cleaned} expired cache entries`);
    }
  }
}

module.exports = { TargetedOddsAgent, SPORT_SLUGS, BOOKMAKER_MAPPING, MARKET_MAPPING };