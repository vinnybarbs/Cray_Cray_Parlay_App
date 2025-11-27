// RSS Research Service
// Queries news_articles table and extracts factual research for AI analysis

class RSSResearchService {
  constructor(supabase) {
    if (!supabase) {
      throw new Error('RSSResearchService requires Supabase client');
    }
    this.supabase = supabase;
    this.cache = new Map();
    this.cacheTtlMs = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Get research for a matchup (team vs team)
   * @param {string} homeTeam - Home team name
   * @param {string} awayTeam - Away team name
   * @param {string} sport - Sport key (NFL, NBA, etc.)
   * @returns {Promise<{facts: string[], sources: Array}>}
   */
  async getMatchupResearch(homeTeam, awayTeam, sport) {
    const cacheKey = `matchup:${sport}:${homeTeam}:${awayTeam}`;
    
    // Check cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTtlMs) {
        console.log(`  📦 Using cached RSS research for ${homeTeam} vs ${awayTeam}`);
        return cached.data;
      }
    }

    try {
      // Query articles mentioning either team (last 48 hours)
      const articles = await this.queryArticlesByTeams([homeTeam, awayTeam], 48);
      
      if (!articles || articles.length === 0) {
        console.log(`  📰 No recent articles found for ${homeTeam} vs ${awayTeam}`);
        return { facts: [], sources: [] };
      }

      console.log(`  📰 Found ${articles.length} relevant articles`);

      // Extract facts from article content
      const facts = [];
      const sources = [];

      for (const article of articles) {
        // Combine title + summary + content for better fact extraction from headlines
        const textToSearch = [
          article.title || '',
          article.summary || '',
          article.content || ''
        ].join(' ').trim();
        
        const extractedFacts = this.extractFactBullets(
          textToSearch,
          [homeTeam, awayTeam],
          []
        );

        if (extractedFacts.length > 0) {
          // Add source attribution to each fact
          const sourceAttribution = `${article.source_name}, ${this.getTimeAgo(article.published_at)}`;
          
          extractedFacts.forEach(fact => {
            facts.push(`${fact} (${sourceAttribution})`);
          });

          sources.push({
            title: article.title,
            source: article.source_name,
            link: article.link,
            published: article.published_at
          });
        }
      }

      // Deduplicate similar facts
      const uniqueFacts = this.deduplicateFacts(facts);

      const result = {
        facts: uniqueFacts.slice(0, 10), // Top 10 most relevant facts
        sources: sources.slice(0, 5) // Top 5 source articles
      };

      // Cache result
      this.cache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      console.error('  ❌ RSS research error:', error.message);
      return { facts: [], sources: [] };
    }
  }

  /**
   * Get research for a specific player
   * @param {string} playerName - Player name
   * @param {string} team - Team name
   * @param {string} sport - Sport key
   * @returns {Promise<{facts: string[], sources: Array}>}
   */
  async getPlayerResearch(playerName, team, sport) {
    const cacheKey = `player:${sport}:${playerName}`;
    
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTtlMs) {
        return cached.data;
      }
    }

    try {
      // Query articles mentioning player (last 72 hours for player news)
      const articles = await this.queryArticlesByPlayer(playerName, team, 72);
      
      if (!articles || articles.length === 0) {
        return { facts: [], sources: [] };
      }

      const facts = [];
      const sources = [];

      for (const article of articles) {
        // Combine title + summary + content for better fact extraction
        const textToSearch = [
          article.title || '',
          article.summary || '',
          article.content || ''
        ].join(' ').trim();
        
        const extractedFacts = this.extractFactBullets(
          textToSearch,
          [team],
          [playerName]
        );

        if (extractedFacts.length > 0) {
          const sourceAttribution = `${article.source_name}, ${this.getTimeAgo(article.published_at)}`;
          
          extractedFacts.forEach(fact => {
            facts.push(`${fact} (${sourceAttribution})`);
          });

          sources.push({
            title: article.title,
            source: article.source_name,
            link: article.link,
            published: article.published_at
          });
        }
      }

      const result = {
        facts: this.deduplicateFacts(facts).slice(0, 8),
        sources: sources.slice(0, 3)
      };

      this.cache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      console.error('  ❌ Player research error:', error.message);
      return { facts: [], sources: [] };
    }
  }

  /**
   * Query articles by team names
   */
  async queryArticlesByTeams(teams, hoursBack = 48) {
    try {
      // Build team variation queries (handle different team name formats)
      const teamQueries = teams.flatMap(team => {
        const variations = this.getTeamVariations(team);
        return variations.map(v => 
          `title.ilike.%${v}%,content.ilike.%${v}%`
        ).join(',');
      });

      const { data, error } = await this.supabase
        .from('news_articles')
        .select(`
          id,
          title,
          content,
          summary,
          link,
          published_at,
          source_id,
          news_sources(name)
        `)
        .or(teamQueries.join(','))
        .gte('published_at', new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString())
        .order('published_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Supabase query error:', error);
        return [];
      }

      // Flatten source names
      return data.map(article => ({
        ...article,
        source_name: article.news_sources?.name || 'Unknown'
      }));

    } catch (error) {
      console.error('Query error:', error);
      return [];
    }
  }

  /**
   * Query articles by player name
   */
  async queryArticlesByPlayer(playerName, team, hoursBack = 72) {
    try {
      const { data, error } = await this.supabase
        .from('news_articles')
        .select(`
          id,
          title,
          content,
          summary,
          link,
          published_at,
          source_id,
          news_sources(name)
        `)
        .or(`title.ilike.%${playerName}%,content.ilike.%${playerName}%`)
        .gte('published_at', new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString())
        .order('published_at', { ascending: false })
        .limit(15);

      if (error) {
        console.error('Supabase query error:', error);
        return [];
      }

      return data.map(article => ({
        ...article,
        source_name: article.news_sources?.name || 'Unknown'
      }));

    } catch (error) {
      console.error('Query error:', error);
      return [];
    }
  }

  /**
   * Extract factual bullets from article text
   * Uses pattern matching to find specific facts (injuries, stats, trends)
   */
  extractFactBullets(text, teams, players) {
    if (!text || text.length < 10) return [];

    const facts = [];

    // HEADLINE PATTERNS (work on short text like "Knicks' Shamet out at least four weeks")
    
    // Pattern 1a: Headline injury format: "Team's Player out/questionable"
    const headlineInjuryPattern = /([A-Z][a-z]+)'s?\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(out|questionable|doubtful|returns?|makes return|back)(?:\s+(?:at least|for)?\s*([\w\s]+))?/gi;
    let match;
    while ((match = headlineInjuryPattern.exec(text)) !== null) {
      const team = match[1];
      const player = match[2];
      const status = match[3];
      const detail = match[4] ? match[4].trim() : '';
      
      if (this.isRelevant(team, teams, players) || this.isRelevant(player, teams, players)) {
        facts.push(`${player} ${status}${detail ? ` (${detail})` : ''}`);
      }
    }
    
    // Pattern 1b: Injury updates (full article format)
    // "Player [status] ([injury])"
    const injuryPattern = /([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)\s+(?:is\s+)?(?:listed as|remains?|ruled)\s+(out|questionable|doubtful|probable|healthy|active)(?:\s+(?:with|for|due to)\s+(?:a\s+)?([a-z\s]+))?/gi;
    while ((match = injuryPattern.exec(text)) !== null) {
      const playerName = match[1];
      const status = match[2];
      const injury = match[3] ? match[3].trim() : '';
      
      // Check if player or team is relevant
      if (this.isRelevant(playerName, teams, players)) {
        facts.push(`${playerName} ${status}${injury ? ` (${injury})` : ''}`);
      }
    }

    // Pattern 2: Performance stats
    // "Player averaging/scored X points/PPG in/over last N games"
    const perfPattern = /([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)\s+(?:averaging|scored?|has|posted|recording)\s+([\d.]+)\s+(points?|PPG|rebounds?|RPG|assists?|APG|yards?|YPG|touchdowns?|TDs?)(?:\s+(?:in|over|across)\s+(?:the\s+)?last\s+(\d+)\s+games?)?/gi;
    while ((match = perfPattern.exec(text)) !== null) {
      const playerName = match[1];
      const statValue = match[2];
      const statType = match[3];
      const gameCount = match[4] || '';
      
      if (this.isRelevant(playerName, teams, players)) {
        facts.push(`${playerName} averaging ${statValue} ${statType}${gameCount ? ` over last ${gameCount} games` : ''}`);
      }
    }

    // Pattern 3: Team record/trends
    // "Team [record] ATS/SU"
    const recordPattern = /([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+(?:are?|is)\s+(\d+-\d+(?:-\d+)?)\s+(ATS|SU|straight up|against the spread)/gi;
    while ((match = recordPattern.exec(text)) !== null) {
      const teamName = match[1];
      const record = match[2];
      const recordType = match[3];
      
      if (this.isRelevant(teamName, teams, players)) {
        facts.push(`${teamName} ${record} ${recordType}`);
      }
    }

    // Pattern 4: Winning/losing streaks
    const streakPattern = /([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+(?:have|has)\s+(?:won|lost)\s+(\d+)\s+(?:straight|consecutive|in a row)/gi;
    while ((match = streakPattern.exec(text)) !== null) {
      const teamName = match[1];
      const streakLength = match[2];
      const streakType = text.includes('won') ? 'won' : 'lost';
      
      if (this.isRelevant(teamName, teams, players)) {
        facts.push(`${teamName} have ${streakType} ${streakLength} straight games`);
      }
    }

    // Pattern 5: Specific game stats
    // "Team scored/allowed X points in Y"
    const gameStatPattern = /([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+(scored?|allowed?)\s+(\d+)\s+points?\s+in\s+(?:their\s+)?(?:last\s+game|previous\s+game|most recent)/gi;
    while ((match = gameStatPattern.exec(text)) !== null) {
      const teamName = match[1];
      const action = match[2];
      const points = match[3];
      
      if (this.isRelevant(teamName, teams, players)) {
        facts.push(`${teamName} ${action} ${points} points in last game`);
      }
    }

    return facts;
  }

  /**
   * Check if a name is relevant to the query
   */
  isRelevant(name, teams, players) {
    const nameLower = name.toLowerCase();
    
    // Check against teams
    for (const team of teams) {
      const variations = this.getTeamVariations(team);
      if (variations.some(v => nameLower.includes(v.toLowerCase()) || v.toLowerCase().includes(nameLower))) {
        return true;
      }
    }
    
    // Check against players
    for (const player of players) {
      if (nameLower.includes(player.toLowerCase()) || player.toLowerCase().includes(nameLower)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get team name variations for flexible matching
   */
  getTeamVariations(teamName) {
    const variations = [teamName];
    
    // Common variations
    const teamMap = {
      'Los Angeles Lakers': ['Lakers', 'LA Lakers', 'L.A. Lakers', 'LAL'],
      'Los Angeles Clippers': ['Clippers', 'LA Clippers', 'L.A. Clippers', 'LAC'],
      'Golden State Warriors': ['Warriors', 'Golden State', 'GSW'],
      'Boston Celtics': ['Celtics', 'Boston', 'BOS'],
      'Miami Heat': ['Heat', 'Miami', 'MIA'],
      'Dallas Cowboys': ['Cowboys', 'Dallas', 'DAL'],
      'Kansas City Chiefs': ['Chiefs', 'Kansas City', 'KC', 'KC Chiefs'],
      'New England Patriots': ['Patriots', 'New England', 'NE', 'Pats'],
      'Green Bay Packers': ['Packers', 'Green Bay', 'GB'],
      'Philadelphia Eagles': ['Eagles', 'Philadelphia', 'Philly', 'PHI'],
      // Add more as needed
    };
    
    if (teamMap[teamName]) {
      variations.push(...teamMap[teamName]);
    }
    
    // Extract city and team name separately
    const parts = teamName.split(' ');
    if (parts.length > 1) {
      variations.push(parts[parts.length - 1]); // Last word (team name)
    }
    
    return variations;
  }

  /**
   * Deduplicate similar facts
   */
  deduplicateFacts(facts) {
    const unique = [];
    const seen = new Set();
    
    for (const fact of facts) {
      // Normalize for comparison (lowercase, remove attribution)
      const normalized = fact.toLowerCase().replace(/\(.*?\)/g, '').trim();
      
      if (!seen.has(normalized)) {
        seen.add(normalized);
        unique.push(fact);
      }
    }
    
    return unique;
  }

  /**
   * Get human-readable time ago
   */
  getTimeAgo(timestamp) {
    const now = Date.now();
    const published = new Date(timestamp).getTime();
    const diffMs = now - published;
    
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    if (hours < 1) {
      const minutes = Math.floor(diffMs / (1000 * 60));
      return `${minutes}m ago`;
    } else if (hours < 24) {
      return `${hours}h ago`;
    } else {
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    }
  }

  /**
   * Format research for AI consumption
   */
  formatForAI(research) {
    if (!research || !research.facts || research.facts.length === 0) {
      return null;
    }

    // Build bullet list of facts
    const factsList = research.facts.map(fact => `- ${fact}`).join('\n');
    
    // Build sources list
    const sourcesList = research.sources
      .map((source, idx) => `[${idx + 1}] ${source.source}: "${source.title}"`)
      .join('\n');

    return `📊 Research:\n${factsList}\n\nSources:\n${sourcesList}`;
  }
}

module.exports = { RSSResearchService };
