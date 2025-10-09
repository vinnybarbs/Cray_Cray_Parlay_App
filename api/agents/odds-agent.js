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

const MARKET_MAPPING = {
  'Moneyline/Spread': ['h2h', 'spreads'],
  'Totals (O/U)': ['totals'],
  'Player Props': ['player_pass_yds', 'player_rush_yds', 'player_receptions', 'player_reception_yds', 'player_points', 'player_assists', 'player_rebounds'],
  'TD Props': ['player_pass_tds', 'player_tds_over', 'player_anytime_td', 'player_rush_tds', 'player_reception_tds'],
  'Team Props': ['team_totals'],
};

class TargetedOddsAgent {
  constructor(fetcher, apiKey) {
    this.fetcher = fetcher;
    this.apiKey = apiKey;
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
  const primaryOdds = await this.fetchFromBook(primaryBook, selectedSports, selectedBetTypes, now, rangeEnd, { fastMode: !!request.fastMode, capCount });
      
      if (this.hasSufficientData(primaryOdds, numLegs)) {
        console.log(`✅ Primary book ${oddsPlatform} has sufficient data`);
        return {
          odds: primaryOdds,
          source: oddsPlatform,
          fallbackUsed: false,
          dataQuality: this.calculateDataQuality(primaryOdds),
          cached: this.cache.size > 0 ? `${this.cache.size} entries` : 'none'
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
    console.log(`🕐 Current time: ${now.toISOString()} (${now.toLocaleString()})`);
    
    // Simplified date range logic
    let rangeEnd;
    if (dateRange === 1) {
      // For 1 day: next 30 hours to handle timezone issues
      rangeEnd = new Date(now.getTime() + 30 * 60 * 60 * 1000);
      console.log(`📅 1 day mode: until ${rangeEnd.toISOString()}`);
    } else {
      // For multi-day: exact calculation
      rangeEnd = new Date(now.getTime() + dateRange * 24 * 60 * 60 * 1000);
      console.log(`📅 ${dateRange} day mode: until ${rangeEnd.toISOString()}`);
    }
    
    return { now, rangeEnd };
  }

  async fetchFromBook(bookmaker, sports, betTypes, now, rangeEnd, { fastMode = false, capCount = 12 } = {}) {
    const allOddsResults = [];
    
    // Handle "ALL" bet types by expanding to all available markets
    let requestedMarkets;
    if (betTypes.includes('ALL') || betTypes.includes('All') || betTypes.includes('all')) {
      requestedMarkets = fastMode ? ['h2h','spreads','totals'] : Object.values(MARKET_MAPPING).flat();
      console.log(`🔥 ALL bet types selected - markets: ${requestedMarkets.join(', ')} (fastMode=${fastMode})`);
    } else {
      requestedMarkets = betTypes.flatMap(bt => MARKET_MAPPING[bt] || []);
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

      // Fetch regular and props in parallel (props skipped in fast mode)
      const tasks = [];
      let regularPromise = null;
      if (regularMarkets.length > 0) {
        regularPromise = this.fetchRegularMarkets(slug, bookmaker, regularMarkets, now, rangeEnd);
        tasks.push(regularPromise);
      }
      let propsPromise = null;
      if (!fastMode && propMarkets.length > 0) {
        propsPromise = this.fetchPropMarkets(slug, bookmaker, propMarkets, now, rangeEnd);
        tasks.push(propsPromise);
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
  getCacheKey(slug, bookmaker, markets) {
    return `${slug}-${bookmaker}-${Array.isArray(markets) ? markets.sort().join(',') : markets}`;
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
    const cacheKey = this.getCacheKey(slug, bookmaker, markets);
    const url = `https://api.the-odds-api.com/v4/sports/${slug}/odds/?regions=us&markets=${encodeURIComponent(marketsStr)}&oddsFormat=american&bookmakers=${bookmaker}&apiKey=${this.apiKey}`;
    
    try {
      console.log(`  📡 Regular markets: ${markets.join(', ')}`);
      
      // Use cached/deduplicated fetch
      const data = await this.fetchWithCache(url, cacheKey);
      
      if (Array.isArray(data) && data.length > 0) {
        console.log(`  📊 Raw API returned ${data.length} games`);
        
        // Debug: Log first game structure
        if (data[0]) {
          const firstGame = data[0];
          console.log(`  🎯 First game: ${firstGame.away_team} @ ${firstGame.home_team}`);
          console.log(`  📅 Game time: ${firstGame.commence_time}`);
          if (firstGame.bookmakers && firstGame.bookmakers[0]) {
            const bm = firstGame.bookmakers[0];
            console.log(`  💰 Markets: ${bm.markets ? bm.markets.map(m => m.key).join(', ') : 'none'}`);
          }
        }
        
        const upcoming = data.filter(game => {
          const gameTime = new Date(game.commence_time);
          const isInRange = gameTime > now && gameTime < rangeEnd;
          console.log(`    ${game.away_team} @ ${game.home_team}: ${gameTime.toLocaleString()} - In range: ${isInRange}`);
          return isInRange;
        });
        
        console.log(`  ✓ Found ${upcoming.length} games in time range`);
        return upcoming;
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
    const propResults = [];
    const marketBatches = this.chunkArray(markets, 3);
    console.log(`  🎯 Fetching ${markets.length} prop markets in ${marketBatches.length} batches`);

    // Run batches with limited concurrency to reduce total time while being polite to API
    const concurrency = 2;
    let index = 0;
    const worker = async () => {
      while (index < marketBatches.length) {
        const myIndex = index++;
        const batch = marketBatches[myIndex];
        try {
          const batchStr = batch.join(',');
          const cacheKey = this.getCacheKey(slug, bookmaker, batch);
          const url = `https://api.the-odds-api.com/v4/sports/${slug}/odds/?regions=us&markets=${encodeURIComponent(batchStr)}&oddsFormat=american&bookmakers=${bookmaker}&apiKey=${this.apiKey}`;
          console.log(`    📡 Prop batch: ${batch.join(', ')}`);
          const data = await this.fetchWithCache(url, cacheKey);
          if (Array.isArray(data) && data.length > 0) {
            const upcoming = data.filter(game => {
              const gameTime = new Date(game.commence_time);
              return gameTime > now && gameTime < rangeEnd;
            });
            propResults.push(...upcoming);
            console.log(`    ✓ Found ${upcoming.length} prop games in batch`);
          }
        } catch (error) {
          console.log(`    ❌ Prop batch failed: ${error.message}`);
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, marketBatches.length) }, () => worker());
    await Promise.all(workers);

    // Deduplicate results by game ID
    const uniqueResults = Array.from(new Map(propResults.map(game => [game.id, game])).values());
    console.log(`  ✓ Total prop results: ${uniqueResults.length} unique games`);
    return uniqueResults;
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