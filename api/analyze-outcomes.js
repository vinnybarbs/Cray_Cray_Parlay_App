/**
 * Learning Analysis API Endpoint
 * Analyzes settled picks to generate insights for future predictions
 */

const LearningAnalyzer = require('../lib/services/learning-analyzer');
const { logger } = require('../shared/logger');

/**
 * Analyze recent outcomes
 * POST /api/analyze-outcomes
 */
async function analyzeOutcomes(req, res) {
  try {
    logger.info('Starting outcome analysis...');
    
    const analyzer = new LearningAnalyzer();
    const result = await analyzer.analyzeRecentOutcomes();
    
    res.json({
      success: true,
      message: `Analyzed ${result.analyzed} picks`,
      analyzed: result.analyzed
    });
    
  } catch (error) {
    logger.error('Error in analyzeOutcomes:', error);
    res.status(500).json({ 
      error: 'Failed to analyze outcomes',
      details: error.message 
    });
  }
}

/**
 * Get relevant lessons for specific criteria
 * GET /api/lessons?sport=NFL&betType=Spread
 */
async function getLessons(req, res) {
  try {
    const { sport, betType, limit } = req.query;
    
    const analyzer = new LearningAnalyzer();
    const lessons = await analyzer.getRelevantLessons({
      sport,
      betType,
      limit: parseInt(limit) || 10
    });
    
    res.json({
      success: true,
      lessons,
      count: lessons.length
    });
    
  } catch (error) {
    logger.error('Error in getLessons:', error);
    res.status(500).json({ 
      error: 'Failed to get lessons',
      details: error.message 
    });
  }
}

/**
 * Get performance summary
 * GET /api/performance-summary
 */
async function getPerformanceSummary(req, res) {
  try {
    const analyzer = new LearningAnalyzer();
    const summary = await analyzer.getPerformanceSummary();
    
    res.json({
      success: true,
      summary
    });
    
  } catch (error) {
    logger.error('Error in getPerformanceSummary:', error);
    res.status(500).json({ 
      error: 'Failed to get performance summary',
      details: error.message 
    });
  }
}

module.exports = {
  analyzeOutcomes,
  getLessons,
  getPerformanceSummary
};
