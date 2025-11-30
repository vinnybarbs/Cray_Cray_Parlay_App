/**
 * Learning Analyzer Service
 * Analyzes settled picks (especially losses) to generate insights for future predictions
 */

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../../shared/logger');

class LearningAnalyzer {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  /**
   * Analyze all recently settled picks that haven't been analyzed yet
   */
  async analyzeRecentOutcomes() {
    try {
      logger.info('🧠 Starting learning analysis...');

      // Get settled picks that haven't been analyzed yet
      const { data: picks, error } = await this.supabase
        .from('ai_suggestions')
        .select('*')
        .in('actual_outcome', ['won', 'lost'])
        .is('analyzed_at', null)
        .order('resolved_at', { ascending: false })
        .limit(50); // Analyze in batches

      if (error) throw error;

      if (!picks || picks.length === 0) {
        logger.info('No new outcomes to analyze');
        return { analyzed: 0 };
      }

      logger.info(`Found ${picks.length} picks to analyze`);

      let analyzedCount = 0;

      for (const pick of picks) {
        try {
          const analysis = await this.analyzePickOutcome(pick);
          
          if (analysis) {
            await this.saveAnalysis(pick.id, analysis);
            analyzedCount++;
          }
        } catch (error) {
          logger.error(`Error analyzing pick ${pick.id}:`, error);
        }
      }

      logger.info(`✅ Analyzed ${analyzedCount} picks`);
      return { analyzed: analyzedCount };

    } catch (error) {
      logger.error('Error in analyzeRecentOutcomes:', error);
      throw error;
    }
  }

  /**
   * Use AI to analyze why a pick won or lost
   */
  async analyzePickOutcome(pick) {
    try {
      const prompt = this.buildAnalysisPrompt(pick);

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are an expert sports betting analyst who learns from outcomes to improve future predictions. Analyze picks objectively and extract actionable lessons.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();
      const analysisText = data.choices[0].message.content;

      // Extract structured lessons
      const lessons = this.extractLessons(analysisText, pick);

      return {
        post_analysis: analysisText,
        lessons_learned: lessons
      };

    } catch (error) {
      logger.error(`Error analyzing pick ${pick.id}:`, error);
      return null;
    }
  }

  /**
   * Build analysis prompt for OpenAI
   */
  buildAnalysisPrompt(pick) {
    const outcome = pick.actual_outcome === 'won' ? 'WON' : 'LOST';
    
    return `Analyze this sports betting pick outcome and extract lessons:

PICK DETAILS:
- Sport: ${pick.sport}
- Game: ${pick.away_team} @ ${pick.home_team}
- Date: ${pick.game_date}
- Bet Type: ${pick.bet_type}
- Pick: ${pick.pick}
- Odds: ${pick.odds}
- Point/Line: ${pick.point || 'N/A'}

ORIGINAL REASONING:
${pick.reasoning || 'No reasoning provided'}

OUTCOME: ${outcome}
Confidence: ${pick.confidence}/10

ANALYSIS TASK:
1. WHY did this pick ${outcome}? What factors led to this result?
2. Was the original reasoning sound or flawed?
3. What patterns or conditions made this ${outcome === 'WON' ? 'successful' : 'unsuccessful'}?
4. What should be avoided or emphasized in similar future picks?

Provide a concise analysis (2-3 paragraphs) with actionable insights.`;
  }

  /**
   * Extract structured lessons from AI analysis
   */
  extractLessons(analysisText, pick) {
    const lessons = {
      outcome: pick.actual_outcome,
      sport: pick.sport,
      bet_type: pick.bet_type,
      confidence_was: pick.confidence,
      key_factors: [],
      patterns: [],
      recommendations: []
    };

    // Simple extraction - look for key phrases
    const lines = analysisText.toLowerCase().split('\n');
    
    lines.forEach(line => {
      if (line.includes('avoid') || line.includes('caution')) {
        lessons.recommendations.push(line.trim());
      }
      if (line.includes('pattern') || line.includes('trend')) {
        lessons.patterns.push(line.trim());
      }
      if (line.includes('factor') || line.includes('reason')) {
        lessons.key_factors.push(line.trim());
      }
    });

    return lessons;
  }

  /**
   * Save analysis back to database
   */
  async saveAnalysis(pickId, analysis) {
    try {
      const { error } = await this.supabase
        .from('ai_suggestions')
        .update({
          post_analysis: analysis.post_analysis,
          lessons_learned: analysis.lessons_learned,
          analyzed_at: new Date().toISOString()
        })
        .eq('id', pickId);

      if (error) throw error;

      logger.info(`Saved analysis for pick ${pickId}`);
    } catch (error) {
      logger.error(`Error saving analysis for pick ${pickId}:`, error);
      throw error;
    }
  }

  /**
   * Fetch relevant lessons for upcoming picks
   * Used by coordinator when generating new picks
   */
  async getRelevantLessons({ sport, betType, teams, limit = 10 }) {
    try {
      let query = this.supabase
        .from('ai_suggestions')
        .select('sport, bet_type, pick, actual_outcome, post_analysis, lessons_learned, game_date')
        .not('post_analysis', 'is', null)
        .order('analyzed_at', { ascending: false });

      // Filter by sport
      if (sport) {
        query = query.eq('sport', sport);
      }

      // Filter by bet type
      if (betType) {
        query = query.eq('bet_type', betType);
      }

      // Get recent analyses
      query = query.limit(limit);

      const { data, error } = await query;

      if (error) throw error;

      return data || [];

    } catch (error) {
      logger.error('Error fetching relevant lessons:', error);
      return [];
    }
  }

  /**
   * Get performance summary by category
   */
  async getPerformanceSummary() {
    try {
      const { data, error } = await this.supabase
        .from('ai_suggestions')
        .select('sport, bet_type, actual_outcome, confidence')
        .in('actual_outcome', ['won', 'lost']);

      if (error) throw error;

      // Group by categories
      const summary = {};
      
      data.forEach(pick => {
        const key = `${pick.sport}-${pick.bet_type}`;
        if (!summary[key]) {
          summary[key] = { wins: 0, losses: 0, totalConfidence: 0, count: 0 };
        }
        
        if (pick.actual_outcome === 'won') summary[key].wins++;
        if (pick.actual_outcome === 'lost') summary[key].losses++;
        summary[key].totalConfidence += pick.confidence || 0;
        summary[key].count++;
      });

      // Calculate win rates
      Object.keys(summary).forEach(key => {
        const s = summary[key];
        s.winRate = s.wins / (s.wins + s.losses);
        s.avgConfidence = s.totalConfidence / s.count;
      });

      return summary;

    } catch (error) {
      logger.error('Error getting performance summary:', error);
      return {};
    }
  }
}

module.exports = LearningAnalyzer;
