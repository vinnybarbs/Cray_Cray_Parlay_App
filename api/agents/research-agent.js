// Enhanced Research Agent - Real-time comprehensive research
class EnhancedResearchAgent {
  constructor(fetcher, serperApiKey) {
    this.fetcher = fetcher;
    this.serperApiKey = serperApiKey;
    this.maxConcurrentRequests = 5;
  }

  async deepResearch(games) {
    if (!this.serperApiKey) {
      console.log('⚠️ No SERPER_API_KEY - skipping research enhancement');
      return games.map(g => ({ ...g, research: null }));
    }

    console.log(`🔍 Real-time research for ${games.length} games (no cache)`);
    
    // Research all games with sufficient data
    const researchTargets = this.prioritizeResearchTargets(games);
    
    // Process in batches to avoid overwhelming the API
    const batchSize = this.maxConcurrentRequests;
    const enrichedGames = [];
    
    for (let i = 0; i < researchTargets.length; i += batchSize) {
      const batch = researchTargets.slice(i, i + batchSize);
      console.log(`📋 Processing research batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(researchTargets.length/batchSize)}`);
      
      const batchPromises = batch.map(game => this.comprehensiveGameAnalysis(game));
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

  async comprehensiveGameAnalysis(game) {
    const gameDate = new Date(game.commence_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const query = `${game.away_team} vs ${game.home_team} ${gameDate} injury report recent performance analysis prediction weather`;
    
    try {
      console.log(`  🔍 Researching: ${game.away_team} @ ${game.home_team}`);
      
      const research = await this.performSerperSearch(query);
      
      return {
        ...game,
        research: this.synthesizeResearch(research, game)
      };
      
    } catch (error) {
      console.log(`  ❌ Research failed for ${game.away_team} @ ${game.home_team}: ${error.message}`);
      return { ...game, research: null };
    }
  }

  async performSerperSearch(query) {
    const url = 'https://google.serper.dev/search';
    
    try {
      const response = await this.fetcher(url, {
        method: 'POST',
        headers: {
          'X-API-KEY': this.serperApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: query,
          num: 5 // Get top 5 results for comprehensive analysis
        }),
      });

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
      return 'No research data available';
    }

    // Extract key insights from search results
    const insights = searchResults.organic
      .map(result => `${result.title}: ${result.snippet}`)
      .join(' | ')
      .substring(0, 800); // Limit length for token efficiency

    // Add structured analysis
    const analysis = this.extractKeyInsights(insights, game);
    
    return `${insights}${analysis ? ` | Analysis: ${analysis}` : ''}`;
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
    return games
      .filter(game => game.research)
      .map(game => {
        const gameDate = new Date(game.commence_time).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
        const teams = `${game.away_team || '?'} @ ${game.home_team || '?'}`;
        
        return `${gameDate} - ${teams}\n   📰 RESEARCH: ${game.research}`;
      })
      .slice(0, 20) // Limit for prompt size
      .join('\n\n');
  }
}

module.exports = { EnhancedResearchAgent };