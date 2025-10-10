// Enhanced Research Agent - Real-time comprehensive research
class EnhancedResearchAgent {
  constructor(fetcher, serperApiKey) {
    this.fetcher = fetcher;
    this.serperApiKey = serperApiKey;
    this.maxConcurrentRequests = 5;
    this.cache = new Map();
    this.cacheTtlMs = 10 * 60 * 1000; // 10 minutes
    this.playerResearchCount = 0; // Track player research to avoid rate limits
  }

  async deepResearch(games, { fastMode = false } = {}) {
    if (!this.serperApiKey) {
      console.log('⚠️ No SERPER_API_KEY - skipping research enhancement');
      return games.map(g => ({ ...g, research: null }));
    }

    console.log(`🔍 Real-time research for ${games.length} games (fastMode=${fastMode})`);
    
    // Research all games with sufficient data
    const researchTargets = this.prioritizeResearchTargets(games).slice(0, fastMode ? 8 : 25);
    
    // Process in batches to avoid overwhelming the API
    const batchSize = fastMode ? Math.min(3, this.maxConcurrentRequests) : this.maxConcurrentRequests;
    const enrichedGames = [];
    
    for (let i = 0; i < researchTargets.length; i += batchSize) {
      const batch = researchTargets.slice(i, i + batchSize);
      console.log(`📋 Processing research batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(researchTargets.length/batchSize)}`);
      
  const batchPromises = batch.map(game => this.comprehensiveGameAnalysis(game, { fastMode }));
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          enrichedGames.push(result.value);
        } else {
          console.log(`❌ Research failed for game ${batch[index].away_team} @ ${batch[index].home_team}: ${result.reason}`);
          enrichedGames.push({ ...batch[index], research: null });
        }
      });
    }

    // Add games that weren't researched
    const researchedIds = new Set(enrichedGames.map(g => g.id));
    games.forEach(game => {
      if (!researchedIds.has(game.id)) {
        enrichedGames.push({ ...game, research: null });
      }
    });

    console.log(`✓ Research complete (${enrichedGames.filter(g => g.research).length} games enriched)`);
    return enrichedGames;
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

  async comprehensiveGameAnalysis(game, { fastMode = false } = {}) {
    const gameDate = new Date(game.commence_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    try {
      console.log(`  🔍 Researching: ${game.away_team} @ ${game.home_team}`);
      
      // Extract player names from prop markets if available
      const playerNames = this.extractPlayerNames(game);
      
      let combinedResearch = '';
      
      // 1. Game-level research (team matchup, weather, injuries)
      const gameQuery = `${game.away_team} vs ${game.home_team} ${gameDate} injury report recent performance analysis prediction weather`;
      const gameCache = gameQuery.toLowerCase();
      const now = Date.now();
      const cached = this.cache.get(gameCache);
      
      if (cached && (now - cached.t) < this.cacheTtlMs) {
        const { summary } = this.synthesizeResearch(cached.data, game);
        combinedResearch = summary;
      } else {
        const gameResearch = await this.performSerperSearch(gameQuery, { fastMode });
        this.cache.set(gameCache, { t: now, data: gameResearch });
        const { summary } = this.synthesizeResearch(gameResearch, game);
        combinedResearch = summary;
      }
      
      // 2. Player-specific research for top players (limit to 2 key players to avoid rate limits)
      // Only do player research for first few games to manage API quota
      const shouldDoPlayerResearch = !fastMode && playerNames.length > 0 && this.playerResearchCount < 5;
      if (shouldDoPlayerResearch) {
        this.playerResearchCount = (this.playerResearchCount || 0) + 1;
        const topPlayers = playerNames.slice(0, 2); // Research top 2 players to save API calls
        const playerResearch = await this.researchPlayers(topPlayers);
        if (playerResearch) {
          combinedResearch += ` | PLAYER STATS: ${playerResearch}`;
        }
      }
      
      return {
        ...game,
        research: combinedResearch,
        researchSources: []
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

  async researchPlayers(playerNames) {
    if (playerNames.length === 0) return '';
    
    try {
      // Research each player individually to get their team and recent stats
      const currentYear = new Date().getFullYear();
      const playerQueries = playerNames.map(name => 
        `${name} NFL stats recent games ${currentYear} team touchdowns`
      );
      
      const playerResults = await Promise.all(
        playerQueries.map(async (query) => {
          const cacheKey = query.toLowerCase();
          const now = Date.now();
          const cached = this.cache.get(cacheKey);
          
          if (cached && (now - cached.t) < this.cacheTtlMs) {
            return cached.data;
          }
          
          const result = await this.performSerperSearch(query, { fastMode: true });
          this.cache.set(cacheKey, { t: now, data: result });
          return result;
        })
      );
      
      // Synthesize player research into concise format
      const playerSummaries = playerResults.map((result, idx) => {
        if (!result || !result.organic || result.organic.length === 0) {
          return null;
        }
        
        const topResult = result.organic[0];
        const snippet = topResult.snippet || '';
        // Extract first 100 chars which usually contains team and key stats
        const summary = snippet.substring(0, 150);
        return `${playerNames[idx]}: ${summary}`;
      }).filter(Boolean);
      
      return playerSummaries.join(' | ');
      
    } catch (error) {
      console.log(`  ⚠️ Player research failed: ${error.message}`);
      return '';
    }
  }

  async performSerperSearch(query, { fastMode = false } = {}) {
    const url = 'https://google.serper.dev/search';
    
    try {
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
          num: fastMode ? 3 : 5
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
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

  // Method to get research summary for AI prompts
  formatResearchForAI(games) {
    const lines = [];
    const aggregatedSources = [];
    games.filter(g => g.research).slice(0, 20).forEach((game) => {
      const gameDate = new Date(game.commence_time).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
      const teams = `${game.away_team || '?'} @ ${game.home_team || '?'}`;
      lines.push(`${gameDate} - ${teams}\n   📰 RESEARCH: ${game.research}`);
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
}

module.exports = { EnhancedResearchAgent };