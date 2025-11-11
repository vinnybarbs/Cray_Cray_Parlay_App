// Direct news cache population script - bypassing the edge function
// This will populate the news_cache table directly using our working API keys

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Intelligence gathering configuration (simplified from edge function)
const INTELLIGENCE_CONFIG = {
  searchCategories: {
    injuries: {
      priority: 1,
      searchesPerSport: 3,
      queryTemplates: [
        "{team} injury report latest news",
        "{team} questionable doubtful injury status", 
        "{team} key players injury impact"
      ],
      expiresHours: 12
    },
    expert_analysis: {
      priority: 2,
      searchesPerSport: 2,
      queryTemplates: [
        "{team} expert picks predictions betting analysis",
        "{team} advanced analytics efficiency ratings"
      ],
      expiresHours: 24
    }
  }
};

const NFL_TEAMS = [
  'Kansas City Chiefs', 'Buffalo Bills', 'Cincinnati Bengals', 'Miami Dolphins',
  'Baltimore Ravens', 'Philadelphia Eagles', 'San Francisco 49ers', 'Dallas Cowboys'
];

async function performSearch(query, category, team = null) {
  try {
    console.log(`🔍 Searching: "${query}"`);
    
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num: 6, // Get top 6 results
        location: 'United States'
      })
    });

    if (!response.ok) {
      throw new Error(`Serper API responded with ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.organic || data.organic.length === 0) {
      console.log(`⚠️ No results for query: ${query}`);
      return null;
    }

    // Extract and format articles
    const articles = data.organic.slice(0, 4).map((result) => ({
      title: result.title,
      link: result.link,
      snippet: result.snippet,
      date: result.date || new Date().toISOString(),
      source: result.source
    }));

    // Generate simple summary
    const summary = generateSummary(articles, category, team || 'NFL');
    
    // Cache the intelligence
    const expiresAt = new Date();
    const config = INTELLIGENCE_CONFIG.searchCategories[category];
    expiresAt.setHours(expiresAt.getHours() + config.expiresHours);

    const cacheData = {
      sport: 'NFL',
      search_type: category,
      team_name: team || null,
      search_query: query,
      articles: JSON.stringify(articles),
      summary,
      expires_at: expiresAt.toISOString()
    };

    const { data: insertData, error } = await supabase
      .from('news_cache')
      .insert(cacheData)
      .select();

    if (error) {
      console.error('❌ Database insert error:', error);
      return null;
    }

    console.log(`✅ Cached ${articles.length} articles for ${team || 'NFL'} ${category}`);
    return { articleCount: articles.length, insightCount: 1 };

  } catch (error) {
    console.error(`❌ Search failed for "${query}":`, error.message);
    return null;
  }
}

function generateSummary(articles, category, subject) {
  if (!articles || articles.length === 0) return "";

  const snippets = articles.map(a => a.snippet).join(' ').toLowerCase();
  
  switch (category) {
    case 'injuries':
      const injuries = [];
      if (snippets.includes('questionable')) injuries.push('Questionable players for upcoming games');
      if (snippets.includes('doubtful')) injuries.push('Key players doubtful to play');
      if (snippets.includes('out') && snippets.includes('week')) injuries.push('Players ruled out');
      return injuries.length > 0
        ? `${subject} injury updates: ${injuries.join(', ')}`
        : `Latest ${subject} injury report and player availability`;
        
    case 'expert_analysis':
      const analysis = [];
      if (snippets.includes('expert') && snippets.includes('pick')) analysis.push('Expert betting recommendations');
      if (snippets.includes('prediction')) analysis.push('Game predictions');
      if (snippets.includes('analytics')) analysis.push('Advanced analytics insights');
      return analysis.length > 0
        ? `${subject} analysis: ${analysis.join(', ')}`
        : `Professional ${subject} game analysis and insights`;
        
    default:
      return snippets.substring(0, 200) + "...";
  }
}

async function populateIntelligence() {
  console.log('🚀 Starting direct news cache population...');
  
  let totalSearches = 0;
  const maxSearches = 15; // Conservative limit to avoid rate limits
  
  // Process top NFL teams only
  const teams = NFL_TEAMS.slice(0, 4); // Top 4 teams to stay within limits
  
  for (const team of teams) {
    if (totalSearches >= maxSearches) break;
    
    console.log(`\n📊 Processing ${team}...`);
    
    // Get injury intelligence for this team
    const injuryQuery = INTELLIGENCE_CONFIG.searchCategories.injuries.queryTemplates[0]
      .replace('{team}', team);
    
    const injuryResult = await performSearch(injuryQuery, 'injuries', team);
    if (injuryResult) totalSearches++;
    
    // Rate limiting between searches
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (totalSearches >= maxSearches) break;
    
    // Get expert analysis for this team
    const expertQuery = INTELLIGENCE_CONFIG.searchCategories.expert_analysis.queryTemplates[0]
      .replace('{team}', team);
    
    const expertResult = await performSearch(expertQuery, 'expert_analysis', team);
    if (expertResult) totalSearches++;
    
    // Rate limiting between teams
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  
  // Add some general NFL intelligence
  if (totalSearches < maxSearches) {
    console.log('\n🏈 Adding general NFL intelligence...');
    await performSearch('NFL Week 10 injury report latest news', 'injuries');
    totalSearches++;
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (totalSearches < maxSearches) {
      await performSearch('NFL Week 10 expert picks predictions analysis', 'expert_analysis');
      totalSearches++;
    }
  }
  
  // Check final cache status
  const { data: finalData, error } = await supabase
    .from('news_cache')
    .select('*')
    .order('last_updated', { ascending: false });
  
  if (error) {
    console.error('❌ Error checking final cache:', error);
  } else {
    console.log(`\n✅ Population complete! Cache now has ${finalData.length} entries`);
    console.log(`🔍 Used ${totalSearches} searches total`);
    
    // Show summary of what we cached
    const summary = finalData.reduce((acc, item) => {
      const key = `${item.search_type}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    
    console.log('📊 Cache breakdown:', summary);
  }
}

// Run the population
populateIntelligence().then(() => {
  console.log('\n🎉 Direct population completed successfully!');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Population failed:', error);
  process.exit(1);
});