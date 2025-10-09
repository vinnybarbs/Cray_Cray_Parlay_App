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
  }

  async fetchOddsForSelectedBook(request) {
    const { oddsPlatform, selectedSports, selectedBetTypes, numLegs, dateRange } = request;
    const primaryBook = BOOKMAKER_MAPPING[oddsPlatform];
    
    console.log(`🎯 Fetching odds from user's selected book: ${oddsPlatform}`);
    
    // Calculate date range
    const { now, rangeEnd } = this.calculateDateRange(dateRange);
    
    try {
      // Try primary book first
      const primaryOdds = await this.fetchFromBook(primaryBook, selectedSports, selectedBetTypes, now, rangeEnd);
      
      if (this.hasSufficientData(primaryOdds, numLegs)) {
        console.log(`✅ Primary book ${oddsPlatform} has sufficient data`);
        return {
          odds: primaryOdds,
          source: oddsPlatform,
          fallbackUsed: false,
          dataQuality: this.calculateDataQuality(primaryOdds)
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
    
    let rangeEnd;
    if (dateRange === 1) {
      // For 1 day, be more inclusive (until 6 AM next day to handle timezone issues)
      rangeEnd = new Date(now);
      rangeEnd.setDate(rangeEnd.getDate() + 1);
      rangeEnd.setHours(5, 59, 59, 999);
      console.log(`📅 1 day mode (inclusive): until ${rangeEnd.toISOString()} (${rangeEnd.toLocaleString()})`);
    } else {
      rangeEnd = new Date(now.getTime() + dateRange * 24 * 60 * 60 * 1000);
      console.log(`📅 Multi-day mode: ${dateRange} days until ${rangeEnd.toISOString()} (${rangeEnd.toLocaleString()})`);
    }
    
    return { now, rangeEnd };
  }

  async fetchFromBook(bookmaker, sports, betTypes, now, rangeEnd) {
    const allOddsResults = [];
    const requestedMarkets = betTypes.flatMap(bt => MARKET_MAPPING[bt] || []);
    
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

      // Fetch regular markets
      if (regularMarkets.length > 0) {
        const regularOdds = await this.fetchRegularMarkets(slug, bookmaker, regularMarkets, now, rangeEnd);
        allOddsResults.push(...regularOdds);
      }

      // Fetch prop markets
      if (propMarkets.length > 0) {
        const propOdds = await this.fetchPropMarkets(slug, bookmaker, propMarkets, now, rangeEnd);
        allOddsResults.push(...propOdds);
      }
    }

    return allOddsResults;
  }

  async fetchRegularMarkets(slug, bookmaker, markets, now, rangeEnd) {
    const marketsStr = markets.join(',');
    const url = `https://api.the-odds-api.com/v4/sports/${slug}/odds/?regions=us&markets=${encodeURIComponent(marketsStr)}&oddsFormat=american&bookmakers=${bookmaker}&apiKey=${this.apiKey}`;
    
    try {
      console.log(`  📡 Regular markets: ${markets.join(', ')}`);
      const response = await this.fetcher(url);
      
      if (!response.ok) {
        throw new Error(`API responded with ${response.status}`);
      }
      
      const data = await response.json();
      
      if (Array.isArray(data) && data.length > 0) {
        const upcoming = data.filter(game => {
          const gameTime = new Date(game.commence_time);
          const isInRange = gameTime > now && gameTime < rangeEnd;
          console.log(`    ${game.away_team} @ ${game.home_team}: ${gameTime.toLocaleString()} - In range: ${isInRange}`);
          return isInRange;
        });
        
        console.log(`  ✓ Found ${upcoming.length} games in time range`);
        return upcoming;
      }
    } catch (error) {
      console.log(`  ❌ Regular markets failed: ${error.message}`);
    }
    
    return [];
  }

  async fetchPropMarkets(slug, bookmaker, markets, now, rangeEnd) {
    const propResults = [];
    
    // Fetch props for each market separately (props API structure)
    for (const market of markets) {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/${slug}/odds/?regions=us&markets=${market}&oddsFormat=american&bookmakers=${bookmaker}&apiKey=${this.apiKey}`;
        
        console.log(`  🎯 Prop market: ${market}`);
        const response = await this.fetcher(url);
        
        if (response.ok) {
          const data = await response.json();
          
          if (Array.isArray(data) && data.length > 0) {
            const upcoming = data.filter(game => {
              const gameTime = new Date(game.commence_time);
              return gameTime > now && gameTime < rangeEnd;
            });
            
            propResults.push(...upcoming);
            console.log(`    ✓ Found ${upcoming.length} prop games`);
          }
        }
      } catch (error) {
        console.log(`    ❌ Prop market ${market} failed: ${error.message}`);
      }
    }
    
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
    // Merge odds data, preferring primary book data
    const combined = [...primary];
    const primaryGameIds = new Set(primary.map(g => g.id));
    
    // Add fallback games that aren't in primary
    fallback.forEach(game => {
      if (!primaryGameIds.has(game.id)) {
        combined.push(game);
      }
    });
    
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
}

module.exports = { TargetedOddsAgent, SPORT_SLUGS, BOOKMAKER_MAPPING, MARKET_MAPPING };