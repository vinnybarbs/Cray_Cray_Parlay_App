// Enhanced Research Agent - Real-time comprehensive research
class EnhancedResearchAgent {
  constructor(fetcher, serperApiKey, supabase = null) {
    this.fetcher = fetcher;
    this.serperApiKey = serperApiKey;
    this.supabase = supabase;
    this.maxConcurrentRequests = 20; // Increased from 5 - we have 300 qps!
    this.cache = new Map();
    this.cacheTtlMs = 30 * 60 * 1000; // 30 minutes (was 10) - balance freshness vs API usage
    this.playerResearchCount = 0;
    this.requestsThisSecond = 0;
    this.lastRequestTime = Date.now();
    
    // Initialize NFL stats service with Supabase for DB caching
    try {
      this.nflStats = require('../services/nfl-stats');
      // Update the singleton's supabase client
      if (this.nflStats && supabase) {
        this.nflStats.supabase = supabase;
      }
      console.log('✅ NFL Stats service initialized with DB caching');
    } catch (error) {
      console.log('⚠️ NFL Stats service not available:', error.message);
      this.nflStats = null;
    }
  }

  async deepResearch(games, { fastMode = false, numLegs = 3, riskLevel = 'Medium', selectedSports = [] } = {}) {
    if (!this.serperApiKey) {
      console.log('⚠️ No SERPER_API_KEY - skipping research enhancement');
      return games.map(g => ({ ...g, research: null }));
    }

    const userSelectedNFL = selectedSports.some(s => s.toUpperCase() === 'NFL');
    console.log(`🔍 SMART TIERED RESEARCH: ${games.length} games, ${numLegs} legs needed, ${riskLevel} risk`);
    console.log(`📋 User selected sports: ${selectedSports.join(', ')} ${userSelectedNFL ? '(NFL Stats API enabled)' : '(Using Serper)'}`);
    
    // TIER 1: Prioritize games most likely to be selected
    const prioritizedGames = this.prioritizeResearchTargets(games);
    
    // TIER 2: Determine research depth based on needs
    // For low risk: Need deep research on top games (8-9 confidence)
    // For medium/high risk: Can be more selective
    const researchDepth = riskLevel === 'Low' ? 'deep' : 'moderate';
    const gamesToResearch = Math.min(prioritizedGames.length, numLegs * 3); // Research 3x the legs needed
    
    console.log(`📊 Researching top ${gamesToResearch} games with ${researchDepth} depth`);
    
    // TIER 3: Batch research in groups (aggressive with 300 qps!)
    const enrichedGames = [];
    const batchSize = 10; // Research 10 games at a time (was 5)
    
    for (let i = 0; i < gamesToResearch; i += batchSize) {
      const batch = prioritizedGames.slice(i, i + batchSize);
      console.log(`  📡 Researching batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(gamesToResearch/batchSize)}: ${batch.length} games`);
      
      const batchResults = await Promise.all(
        batch.map(game => this.comprehensiveGameAnalysis(game, { fastMode, researchDepth, userSelectedNFL }))
      );
      
      enrichedGames.push(...batchResults);
    }
    
    // Add remaining games without research
    const unresearchedGames = games.filter(g => 
      !enrichedGames.find(eg => eg.id === g.id)
    ).map(g => ({ ...g, research: null }));
    
    console.log(`✓ Research complete: ${enrichedGames.length} games with research, ${unresearchedGames.length} without`);
    return [...enrichedGames, ...unresearchedGames];
  }

  extractAllPlayersFromGames(games) {
    const allPlayers = new Set();
    
    games.forEach(game => {
      if (!game.bookmakers || !game.bookmakers[0] || !game.bookmakers[0].markets) {
        return;
      }
      
      game.bookmakers[0].markets.forEach(market => {
        if (market.key && market.key.startsWith('player_')) {
          market.outcomes?.forEach(outcome => {
            if (outcome.description && outcome.description !== 'Over' && outcome.description !== 'Under') {
              allPlayers.add(outcome.description);
            }
          });
        }
      });
    });
    
    return Array.from(allPlayers);
  }

  async performBulkPlayerSearch(players, games) {
    try {
      const currentYear = new Date().getFullYear();
      const gameDate = new Date(games[0]?.commence_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' });
      
      // Create ONE comprehensive query with all key players
      const topPlayers = players.slice(0, 15); // Limit to top 15 to keep query manageable
      const teamNames = [...new Set(games.flatMap(g => [g.away_team, g.home_team]))];
      
      const query = `NFL ${currentYear} ${gameDate} player stats team rosters: ${topPlayers.slice(0, 10).join(', ')} touchdowns recent games injury report ${teamNames.slice(0, 5).join(' ')}`;
      
      console.log(`🔍 BULK SEARCH: "${query.substring(0, 100)}..."`);
      
      const cacheKey = query.toLowerCase();
      const now = Date.now();
      const cached = this.cache.get(cacheKey);
      
      if (cached && (now - cached.t) < this.cacheTtlMs) {
        console.log(`✓ Using cached bulk research`);
        return cached.data;
      }
      
      const searchResults = await this.performSerperSearch(query, { fastMode: false });
      this.cache.set(cacheKey, { t: now, data: searchResults });
      
      return searchResults;
      
    } catch (error) {
      console.log(`❌ Bulk research failed: ${error.message}`);
      return null;
    }
  }

  getRelevantResearchForGame(game, gamePlayers, bulkResearch) {
    if (!bulkResearch || !bulkResearch.organic) {
      return `Game: ${game.away_team} @ ${game.home_team} - Limited research data available`;
    }
    
    // Extract snippets that mention this game's teams or players
    const relevantSnippets = [];
    const teams = [game.away_team, game.home_team];
    
    bulkResearch.organic.forEach(result => {
      const text = `${result.title} ${result.snippet}`.toLowerCase();
      const isRelevant = teams.some(team => text.includes(team.toLowerCase())) || 
                         gamePlayers.some(player => text.includes(player.toLowerCase()));
      
      if (isRelevant) {
        relevantSnippets.push(`${result.snippet}`);
      }
    });
    
    if (relevantSnippets.length === 0) {
      return `Game: ${game.away_team} @ ${game.home_team} - Players: ${gamePlayers.join(', ')}`;
    }
    
    // Combine relevant snippets
    const combined = relevantSnippets.join(' | ').substring(0, 1200);
    return `${game.away_team} @ ${game.home_team}: ${combined}`;
  }

  prioritizeResearchTargets(games) {
    // Research games that:
    // 1. Have multiple betting markets available
    // 2. Are competitive (close odds)
    // 3. Are happening soon
    
    return games
      .filter(game => this.shouldResearch(game))
      .sort((a, b) => this.calculateResearchPriority(b) - this.calculateResearchPriority(a))
      .slice(0, 25); // Limit to top 25 games to manage API usage
  }

  shouldResearch(game) {
    // Only research games with sufficient betting markets
    return game.bookmakers && 
           game.bookmakers[0] && 
           game.bookmakers[0].markets && 
           game.bookmakers[0].markets.length > 0;
  }

  calculateResearchPriority(game) {
    let priority = 0;
    
    // Higher priority for games starting soon
    const timeUntilGame = new Date(game.commence_time) - Date.now();
    const hoursUntilGame = timeUntilGame / (1000 * 60 * 60);
    
    if (hoursUntilGame < 6) priority += 50;
    else if (hoursUntilGame < 24) priority += 30;
    else if (hoursUntilGame < 48) priority += 10;
    
    // Higher priority for games with more markets
    if (game.bookmakers && game.bookmakers[0] && game.bookmakers[0].markets) {
      priority += game.bookmakers[0].markets.length * 5;
    }
    
    return priority;
  }

  async comprehensiveGameAnalysis(game, { fastMode = false, researchDepth = 'moderate', userSelectedNFL = false } = {}) {
    const gameDate = new Date(game.commence_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Denver' });
    const currentYear = new Date().getFullYear();
    const sport = game.sport_title || game.sport_key || '';
    // Only use NFL stats if user explicitly selected NFL
    const isNFL = userSelectedNFL && (sport.toLowerCase().includes('nfl') || sport.toLowerCase().includes('americanfootball_nfl'));
    
    try {
      console.log(`  🔍 Researching: ${game.away_team} @ ${game.home_team} (${researchDepth} depth)`);
      
      // Extract player names from prop markets if available
      const playerNames = this.extractPlayerNames(game);
      const hasPlayerProps = playerNames.length > 0;
      
      let combinedResearch = '';
      const sources = [];
      
      // 1. GAME-LEVEL RESEARCH
      // For NFL: Use API-Sports stats API (real data)
      // For other sports: Use Serper search (fallback)
      let gameResearch;
      
      if (isNFL && this.nflStats) {
        console.log(`    📊 Using NFL Stats API for real data`);
        try {
          const statsAnalysis = await this.nflStats.getGameAnalysis(game.away_team, game.home_team);
          if (statsAnalysis) {
            const statsFormatted = this.nflStats.formatStatsForAI(statsAnalysis);
            combinedResearch = statsFormatted;
            sources.push({ title: 'API-Sports NFL Stats', link: 'https://api-sports.io' });
            console.log(`    ✅ NFL stats retrieved successfully`);
          } else {
            console.log(`    ⚠️ NFL stats unavailable, falling back to Serper`);
            gameResearch = await this.performSerperFallback(game, currentYear, gameDate);
            const { summary: gameSummary, sources: gameSources } = this.synthesizeResearch(gameResearch, game);
            combinedResearch = gameSummary;
            sources.push(...gameSources);
          }
        } catch (error) {
          console.log(`    ⚠️ NFL stats error: ${error.message}, falling back to Serper`);
          gameResearch = await this.performSerperFallback(game, currentYear, gameDate);
          const { summary: gameSummary, sources: gameSources } = this.synthesizeResearch(gameResearch, game);
          combinedResearch = gameSummary;
          sources.push(...gameSources);
        }
      } else {
        // Non-NFL or no stats service: use Serper
        gameResearch = await this.performSerperFallback(game, currentYear, gameDate);
        const { summary: gameSummary, sources: gameSources } = this.synthesizeResearch(gameResearch, game);
        combinedResearch = gameSummary;
        sources.push(...gameSources);
      }
      
      // 2. PLAYER-SPECIFIC RESEARCH (if player props available and deep research requested)
      if (hasPlayerProps && researchDepth === 'deep' && playerNames.length > 0) {
        console.log(`    🏈 Researching ${playerNames.length} players for detailed analysis`);
        
        // For deep research, get top 3-5 players
        const topPlayers = playerNames.slice(0, researchDepth === 'deep' ? 5 : 3);
        const playerResearch = await this.researchPlayersDetailed(topPlayers, game);
        
        if (playerResearch) {
          combinedResearch += ` | PLAYER INSIGHTS: ${playerResearch}`;
        }
      }
      
      return {
        ...game,
        research: combinedResearch,
        researchSources: sources.slice(0, 5), // Keep top 5 sources
        hasRealStats: isNFL && this.nflStats && combinedResearch.includes('TEAM STATS')
      };
      
    } catch (error) {
      console.log(`  ❌ Research failed for ${game.away_team} @ ${game.home_team}: ${error.message}`);
      return { ...game, research: null };
    }
  }

  extractPlayerNames(game) {
    const players = new Set();
    
    if (!game.bookmakers || !game.bookmakers[0] || !game.bookmakers[0].markets) {
      return [];
    }
    
    // Extract player names from prop market outcomes
    game.bookmakers[0].markets.forEach(market => {
      if (market.key && market.key.startsWith('player_')) {
        market.outcomes?.forEach(outcome => {
          if (outcome.description && outcome.description !== 'Over' && outcome.description !== 'Under') {
            players.add(outcome.description);
          }
        });
      }
    });
    
    return Array.from(players);
  }

  async researchPlayersDetailed(playerNames, game) {
    if (playerNames.length === 0) return '';
    
    try {
      const currentYear = new Date().getFullYear();
      const gameDate = new Date(game.commence_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' });
      
      // Create ONE query with all top players for this specific game
      const playersStr = playerNames.slice(0, 5).join(', ');
      const query = `${game.away_team} ${game.home_team} ${gameDate} ${currentYear} players ${playersStr} stats recent performance touchdowns`;
      
      console.log(`      🔍 Player query: "${query.substring(0, 80)}..."`);
      
      const cacheKey = query.toLowerCase();
      const now = Date.now();
      const cached = this.cache.get(cacheKey);
      
      let result;
      if (cached && (now - cached.t) < this.cacheTtlMs) {
        console.log(`      ✓ Using cached player research`);
        result = cached.data;
      } else {
        result = await this.performSerperSearch(query, { fastMode: false });
        this.cache.set(cacheKey, { t: now, data: result });
      }
      
      if (!result || !result.organic || result.organic.length === 0) {
        return '';
      }
      
      // Extract relevant snippets mentioning the players
      const relevantSnippets = result.organic
        .slice(0, 5)
        .map(r => r.snippet)
        .filter(snippet => {
          const lower = snippet.toLowerCase();
          return playerNames.some(name => lower.includes(name.toLowerCase()));
        })
        .join(' | ');
      
      return relevantSnippets.substring(0, 800); // Limit to 800 chars
      
    } catch (error) {
      console.log(`  ⚠️ Player research failed: ${error.message}`);
      return '';
    }
  }
  
  // Keep old method for backward compatibility
  async researchPlayers(playerNames) {
    return this.researchPlayersDetailed(playerNames, {});
  }

  async performSerperSearch(query, { fastMode = false } = {}) {
    const url = 'https://google.serper.dev/search';
    
    try {
      // Track rate limiting (300 qps limit)
      const now = Date.now();
      if (now - this.lastRequestTime > 1000) {
        // Reset counter every second
        this.requestsThisSecond = 0;
        this.lastRequestTime = now;
      }
      
      this.requestsThisSecond++;
      
      // Log if approaching limit (just for monitoring)
      if (this.requestsThisSecond > 250) {
        console.log(`⚠️ High request rate: ${this.requestsThisSecond} requests this second`);
      }
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), fastMode ? 4000 : 8000);
      const response = await this.fetcher(url, {
        method: 'POST',
        headers: {
          'X-API-KEY': this.serperApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: query,
          num: fastMode ? 3 : 10 // Increased from 5 to 10 for better results
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        // Check if it's a rate limit error
        if (response.status === 429) {
          console.log(`⚠️ Rate limit hit (${this.requestsThisSecond} requests this second)`);
        }
        throw new Error(`Serper API responded with ${response.status}`);
      }

      const data = await response.json();
      return data;
      
    } catch (error) {
      console.log(`❌ Serper search failed: ${error.message}`);
      throw error;
    }
  }

  synthesizeResearch(searchResults, game) {
    if (!searchResults || !searchResults.organic) {
      return { summary: 'No research data available', sources: [] };
    }

    // Extract key insights and capture top sources (increased from 800 to 1200 chars)
    const top = (searchResults.organic || []).slice(0, 5);
    const insights = top
      .map(result => `${result.title}: ${result.snippet}`)
      .join(' | ')
      .substring(0, 1200); // Increased for more detail since player research hits rate limits
    const sources = top.map((r, idx) => ({ idx: idx + 1, title: r.title, link: r.link, snippet: r.snippet }));

    // Add structured analysis
    const analysis = this.extractKeyInsights(insights, game);
    
    const summary = `${insights}${analysis ? ` | Analysis: ${analysis}` : ''}`;
    return { summary, sources };
  }

  extractKeyInsights(text, game) {
    const lowercaseText = text.toLowerCase();
    const insights = [];
    
    // Look for injury mentions
    if (lowercaseText.includes('injury') || lowercaseText.includes('injured') || lowercaseText.includes('questionable')) {
      insights.push('Injury concerns detected');
    }
    
    // Look for weather impacts
    if (lowercaseText.includes('weather') || lowercaseText.includes('rain') || lowercaseText.includes('wind')) {
      insights.push('Weather factor identified');
    }
    
    // Look for trends
    if (lowercaseText.includes('streak') || lowercaseText.includes('consecutive') || lowercaseText.includes('trend')) {
      insights.push('Performance trend noted');
    }
    
    // Look for line movement
    if (lowercaseText.includes('line') || lowercaseText.includes('spread') || lowercaseText.includes('odds')) {
      insights.push('Betting line movement detected');
    }
    
    return insights.length > 0 ? insights.join(', ') : null;
  }

  /**
   * Perform Serper search fallback (for non-NFL or when stats unavailable)
   */
  async performSerperFallback(game, currentYear, gameDate) {
    if (!this.serperApiKey) {
      return null;
    }
    
    const gameQuery = `${game.away_team} vs ${game.home_team} ${currentYear} ${gameDate} injury report recent performance trends prediction`;
    const gameCache = gameQuery.toLowerCase();
    const now = Date.now();
    const cached = this.cache.get(gameCache);
    
    if (cached && (now - cached.t) < this.cacheTtlMs) {
      console.log(`    ✓ Using cached Serper research`);
      return cached.data;
    }
    
    const result = await this.performSerperSearch(gameQuery, { fastMode: false });
    this.cache.set(gameCache, { t: now, data: result });
    return result;
  }

  // Method to get research summary for AI prompts
  formatResearchForAI(games) {
    const lines = [];
    const aggregatedSources = [];
    const realStatsCount = games.filter(g => g.hasRealStats).length;
    
    if (realStatsCount > 0) {
      lines.push(`\n**🎯 DATA SOURCE: ${realStatsCount} games with REAL NFL STATS from API-Sports**\n`);
    }
    
    games.filter(g => g.research).slice(0, 20).forEach((game) => {
      const gameDate = new Date(game.commence_time).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'America/Denver' });
      const teams = `${game.away_team || '?'} @ ${game.home_team || '?'}`;
      const dataType = game.hasRealStats ? '📊 STATS' : '📰 RESEARCH';
      lines.push(`${gameDate} - ${teams}\n   ${dataType}: ${game.research}`);
      (game.researchSources || []).forEach(src => {
        aggregatedSources.push({
          key: `${teams} (${gameDate})`,
          idx: aggregatedSources.length + 1,
          title: src.title,
          link: src.link
        });
      });
    });
    const uniqueSources = [];
    const seen = new Set();
    aggregatedSources.forEach(s => {
      const k = s.link;
      if (!seen.has(k) && uniqueSources.length < 20) {
        seen.add(k);
        uniqueSources.push(s);
      }
    });
    if (uniqueSources.length) {
      lines.push('\nSOURCES:');
      uniqueSources.forEach((s, i) => {
        lines.push(`[${i + 1}] ${s.title} - ${s.link}`);
      });
    }
    return lines.join('\n\n');
  }
  
  /**
   * Get stats service status
   */
  getStatsStatus() {
    if (!this.nflStats) {
      return { available: false, reason: 'Service not initialized' };
    }
    
    try {
      const stats = this.nflStats.getStats();
      return {
        available: true,
        ...stats
      };
    } catch (error) {
      return { available: false, reason: error.message };
    }
  }
}

module.exports = { EnhancedResearchAgent };