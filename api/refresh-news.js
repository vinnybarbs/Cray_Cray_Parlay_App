const { supabase } = require('../lib/middleware/supabaseAuth.js');
const { logger } = require('../shared/logger');

/**
 * Refresh news and betting trends cache using Serper
 * POST /cron/refresh-news
 * Protected by CRON_SECRET
 * Run daily to cache injury reports, analyst picks, team news
 */
async function refreshNewsCache(req, res) {
  try {
    // Verify cron secret
    const cronSecret = req.headers.authorization?.replace('Bearer ', '');
    if (cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const serperKey = process.env.SERPER_API_KEY;
    if (!serperKey) {
      return res.status(500).json({ error: 'Serper API key not configured' });
    }

    let totalSearches = 0;
    let totalArticles = 0;

    // NFL injury searches
    const nflTeams = [
      'Buffalo Bills', 'Miami Dolphins', 'New England Patriots', 'New York Jets',
      'Baltimore Ravens', 'Cincinnati Bengals', 'Cleveland Browns', 'Pittsburgh Steelers',
      'Houston Texans', 'Indianapolis Colts', 'Jacksonville Jaguars', 'Tennessee Titans',
      'Denver Broncos', 'Kansas City Chiefs', 'Las Vegas Raiders', 'Los Angeles Chargers',
      'Dallas Cowboys', 'New York Giants', 'Philadelphia Eagles', 'Washington Commanders',
      'Chicago Bears', 'Detroit Lions', 'Green Bay Packers', 'Minnesota Vikings',
      'Atlanta Falcons', 'Carolina Panthers', 'New Orleans Saints', 'Tampa Bay Buccaneers',
      'Arizona Cardinals', 'Los Angeles Rams', 'San Francisco 49ers', 'Seattle Seahawks'
    ];

    // Search for injury reports (top 8 teams with upcoming games)
    logger.info('Fetching NFL injury reports...');
    for (const team of nflTeams.slice(0, 8)) {
      await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit

      const query = `${team} injury report latest news`;
      
      try {
        const response = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'X-API-KEY': serperKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            q: query,
            num: 5,
            gl: 'us'
          })
        });

        if (response.ok) {
          const data = await response.json();
          const articles = (data.organic || []).map(item => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet,
            date: item.date || new Date().toISOString()
          }));

          if (articles.length > 0) {
            const { error } = await supabase
              .from('news_cache')
              .upsert({
                sport: 'NFL',
                search_type: 'injuries',
                team_name: team,
                search_query: query,
                articles: articles,
                summary: articles.map(a => a.snippet).join(' '),
                last_updated: new Date().toISOString(),
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
              }, {
                onConflict: 'sport,search_type,team_name'
              });

            if (!error) {
              totalSearches++;
              totalArticles += articles.length;
            }
          }
        }
      } catch (error) {
        logger.error(`Error fetching news for ${team}:`, error.message);
      }
    }

    // Search for analyst picks and betting trends
    logger.info('Fetching NFL analyst picks...');
    const analystQuery = 'NFL week picks expert predictions betting';
    
    try {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': serperKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          q: analystQuery,
          num: 10,
          gl: 'us'
        })
      });

      if (response.ok) {
        const data = await response.json();
        const articles = (data.organic || []).map(item => ({
          title: item.title,
          link: item.link,
          snippet: item.snippet,
          date: item.date || new Date().toISOString()
        }));

        if (articles.length > 0) {
          const { error } = await supabase
            .from('news_cache')
            .upsert({
              sport: 'NFL',
              search_type: 'analyst_picks',
              search_query: analystQuery,
              articles: articles,
              summary: articles.map(a => a.snippet).join(' '),
              last_updated: new Date().toISOString(),
              expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            }, {
              onConflict: 'sport,search_type'
            });

          if (!error) {
            totalSearches++;
            totalArticles += articles.length;
          }
        }
      }
    } catch (error) {
      logger.error('Error fetching analyst picks:', error.message);
    }

    // Clean up expired news
    await supabase
      .from('news_cache')
      .delete()
      .lt('expires_at', new Date().toISOString());

    logger.info('News cache refresh complete', { totalSearches, totalArticles });
    
    res.json({ 
      success: true, 
      totalSearches,
      totalArticles,
      timestamp: new Date().toISOString() 
    });

  } catch (error) {
    logger.error('Error in refreshNewsCache', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = refreshNewsCache;
