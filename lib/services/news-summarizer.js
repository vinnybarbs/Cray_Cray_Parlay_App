/**
 * News Summarization Service
 * Processes raw news articles into betting-relevant insights
 * Runs daily in background to pre-compute summaries
 */

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../../shared/logger');

class NewsSummarizer {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  /**
   * Main job: Summarize recent news for all teams across all sports
   * Call this daily via cron
   */
  async summarizeRecentNews() {
    try {
      logger.info('📰 Starting news summarization job...');

      // Get all teams across all sports
      const { data: teams } = await this.supabase
        .from('teams')
        .select('id, name, sport');

      if (!teams || teams.length === 0) {
        logger.warn('No teams found for summarization');
        return { processed: 0, summaries: 0 };
      }

      let processed = 0;
      let summaries = 0;

      for (const team of teams) {
        try {
          // Get unsummarized articles for this team (last 24 hours)
          const { data: articles } = await this.supabase
            .from('news_articles')
            .select('id, title, content, published_at')
            .or(`title.ilike.%${team.name}%,content.ilike.%${team.name}%`)
            .gte('published_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .is('betting_summary', null) // Only unsummarized
            .order('published_at', { ascending: false })
            .limit(10);

          if (!articles || articles.length === 0) continue;

          // Batch summarize articles for this team
          const summary = await this.summarizeTeamNews(team.name, articles);
          
          if (summary) {
            // Store summary for each article
            for (const article of articles) {
              await this.supabase
                .from('news_articles')
                .update({
                  betting_summary: summary.key_insights,
                  injury_mentions: summary.injuries,
                  sentiment: summary.sentiment
                })
                .eq('id', article.id);
            }
            summaries++;
          }

          processed += articles.length;
          
        } catch (teamError) {
          logger.error(`Error processing ${team.name}:`, teamError.message);
        }
      }

      logger.info(`✅ Summarization complete: ${processed} articles, ${summaries} teams`);
      return { processed, summaries };

    } catch (error) {
      logger.error('Error in summarization job:', error);
      throw error;
    }
  }

  /**
   * Use OpenAI to extract betting-relevant insights from articles
   */
  async summarizeTeamNews(teamName, articles) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      logger.warn('OpenAI API key not configured');
      return null;
    }

    try {
      // Combine article titles and first paragraphs
      const articlesText = articles.map(a => {
        const cleanContent = a.content
          ? a.content.replace(/<[^>]*>/g, '').substring(0, 300)
          : '';
        return `${a.title}\n${cleanContent}`;
      }).join('\n\n---\n\n');

      const prompt = `Analyze these recent news articles about ${teamName} and extract ONLY betting-relevant insights:

${articlesText}

Extract:
1. Key Insights (bullet points): Injuries, lineup changes, performance trends, coaching decisions
2. Injury Mentions: List any player names mentioned as injured/questionable
3. Sentiment: positive/negative/neutral (team's current form/morale)

Focus on facts that impact betting: injuries, suspensions, lineup changes, performance trends, coaching changes.
Ignore: schedules, ticket sales, social media, generic commentary.

Return JSON:
{
  "key_insights": "• Insight 1\n• Insight 2\n• Insight 3",
  "injuries": ["Player Name 1", "Player Name 2"],
  "sentiment": "positive|negative|neutral"
}`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', // Cheaper model for summarization
          messages: [
            {
              role: 'system',
              content: 'You are a sports betting analyst. Extract only betting-relevant facts from news. Return valid JSON only.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.2,
          max_tokens: 500,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        logger.error(`OpenAI API error: ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) return null;

      // Parse JSON response
      const parsed = JSON.parse(content);
      return parsed;

    } catch (error) {
      logger.error(`Error summarizing ${teamName} news:`, error.message);
      return null;
    }
  }

  /**
   * Get pre-computed summaries for teams (fast lookup)
   * Falls back to raw article titles/summaries when no betting_summary exists
   */
  async getTeamInsights(teamNames, daysBack = 7) {
    try {
      const insights = {};
      const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

      for (const teamName of teamNames) {
        // Try mascot-based matching for better NCAAB/NBA coverage
        const mascot = teamName.split(' ').slice(-1)[0];
        const searchTerms = [teamName];
        if (mascot && mascot.length > 3) searchTerms.push(mascot);

        // First try: pre-summarized articles
        const { data: summarized } = await this.supabase
          .from('news_articles')
          .select('betting_summary, injury_mentions, sentiment, published_at')
          .or(searchTerms.map(t => `title.ilike.%${t}%`).join(','))
          .not('betting_summary', 'is', null)
          .gte('published_at', cutoff)
          .order('published_at', { ascending: false })
          .limit(5);

        if (summarized && summarized.length > 0) {
          const allInsights = summarized
            .map(a => a.betting_summary)
            .filter(Boolean)
            .join('\n');
          
          const allInjuries = [...new Set(
            summarized.flatMap(a => a.injury_mentions || [])
          )];

          insights[teamName] = {
            insights: allInsights,
            injuries: allInjuries,
            sentiment: summarized[0].sentiment || 'neutral'
          };
          continue;
        }

        // Fallback: use raw article titles + summaries directly
        const { data: rawArticles } = await this.supabase
          .from('news_articles')
          .select('title, summary, published_at')
          .or(searchTerms.map(t => `title.ilike.%${t}%`).join(','))
          .gte('published_at', cutoff)
          .order('published_at', { ascending: false })
          .limit(5);

        if (rawArticles && rawArticles.length > 0) {
          const rawInsights = rawArticles.map(a => {
            const summary = a.summary ? `: ${a.summary.substring(0, 100)}` : '';
            return `- ${a.title}${summary}`;
          }).join('\n');

          insights[teamName] = {
            insights: rawInsights,
            injuries: [],
            sentiment: 'neutral'
          };
        }
      }

      return insights;

    } catch (error) {
      logger.error('Error fetching team insights:', error);
      return {};
    }
  }
}

module.exports = NewsSummarizer;
