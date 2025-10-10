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

    console.log(`🔍 NEW APPROACH: Bulk research for ${games.length} games`);
    
    // Extract ALL players from ALL games upfront
    const allPlayers = this.extractAllPlayersFromGames(games);
    console.log(`📊 Found ${allPlayers.length} total players across all games`);
    
    // Do ONE comprehensive search for all players + teams
    let bulkResearch = null;
    if (allPlayers.length > 0) {
      bulkResearch = await this.performBulkPlayerSearch(allPlayers, games);
    }
    
    // Attach relevant research to each game
    const enrichedGames = games.map(game => {
      const gamePlayers = this.extractPlayerNames(game);
      const relevantResearch = this.getRelevantResearchForGame(game, gamePlayers, bulkResearch);
      return {
        ...game,
        research: relevantResearch
      };
    });

    console.log(`✓ Bulk research complete - all games enriched with player data`);
    return enrichedGames;
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
      const gameDate = new Date(games[0]?.commence_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      
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