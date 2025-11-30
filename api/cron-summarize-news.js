/**
 * Cron endpoint to summarize news articles daily
 * Extracts betting-relevant insights from raw articles
 * 
 * URL: POST /api/cron/summarize-news
 */

const NewsSummarizer = require('../lib/services/news-summarizer');
const { logger } = require('../shared/logger');

async function cronSummarizeNews(req, res) {
  try {
    logger.info('📰 Starting news summarization cron job...');
    
    const summarizer = new NewsSummarizer();
    const result = await summarizer.summarizeRecentNews();
    
    logger.info(`✅ News summarization complete: ${result.processed} articles, ${result.summaries} teams`);
    
    res.json({
      success: true,
      message: `Summarized news for ${result.summaries} teams`,
      timestamp: new Date().toISOString(),
      ...result
    });
    
  } catch (error) {
    logger.error('❌ Error in news summarization cron:', error);
    res.status(500).json({ 
      error: 'Failed to summarize news',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = cronSummarizeNews;
