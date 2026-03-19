/**
 * Cron: Enrich news articles with full content + AI analysis
 *
 * 1. Fetches articles that have a link but no full content
 * 2. Scrapes the article text from ESPN/CBS/Yahoo
 * 3. Uses GPT-4o-mini to extract betting-relevant intelligence
 *
 * POST /cron/enrich-articles
 */

const { supabase } = require('../../lib/middleware/supabaseAuth');
const { logger } = require('../../shared/logger');

const MAX_ARTICLES_PER_RUN = 10;
const FETCH_TIMEOUT = 8000;

// Site-specific content extractors
const EXTRACTORS = {
  'espn.com': (html) => {
    // ESPN article body is in <div class="article-body"> or data-testid="article-body"
    const patterns = [
      /<div[^>]*class="[^"]*article-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
      /<div[^>]*data-testid="article-body"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
      /<section[^>]*class="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return stripHtml(match[1]);
    }
    // Fallback: grab all <p> tags
    return extractParagraphs(html);
  },
  'cbssports.com': (html) => {
    const match = html.match(/<div[^>]*class="[^"]*Article-bodyContent[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (match) return stripHtml(match[1]);
    return extractParagraphs(html);
  },
  'yahoo.com': (html) => {
    const match = html.match(/<div[^>]*class="[^"]*caas-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (match) return stripHtml(match[1]);
    return extractParagraphs(html);
  },
  'bleacherreport.com': (html) => {
    const match = html.match(/<div[^>]*class="[^"]*articleBody[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (match) return stripHtml(match[1]);
    return extractParagraphs(html);
  }
};

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractParagraphs(html) {
  const paragraphs = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = pRegex.exec(html)) !== null) {
    const text = stripHtml(match[1]).trim();
    // Filter out short fragments, nav text, etc.
    if (text.length > 40 && !text.startsWith('©') && !text.includes('cookie')) {
      paragraphs.push(text);
    }
  }
  return paragraphs.join('\n\n');
}

function getExtractor(url) {
  for (const [domain, extractor] of Object.entries(EXTRACTORS)) {
    if (url.includes(domain)) return extractor;
  }
  // Generic fallback
  return (html) => extractParagraphs(html);
}

async function fetchArticleContent(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CrayCrayParlay/1.0)',
        'Accept': 'text/html',
      },
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const html = await response.text();
    const extractor = getExtractor(url);
    const content = extractor(html);

    // Only return if we got meaningful content (>100 chars)
    return content && content.length > 100 ? content : null;
  } catch (err) {
    logger.warn(`Failed to fetch ${url}: ${err.message}`);
    return null;
  }
}

async function extractBettingIntel(title, content, articleLink) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !content || content.length < 100) return null;

  try {
    // Truncate content to save tokens
    const truncated = content.substring(0, 3000);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `You extract betting-relevant intelligence from sports articles. Return JSON only, no markdown.`
        }, {
          role: 'user',
          content: `Extract betting-relevant info from this article.

Title: ${title}
Content: ${truncated}

Return this exact JSON structure:
{
  "betting_summary": "1-2 sentence summary of what matters for betting (injuries, lineup changes, matchup edges, trends). If nothing betting-relevant, say 'No direct betting impact.'",
  "injury_mentions": [{"player": "name", "team": "team", "status": "out/questionable/probable/returning", "details": "brief"}],
  "sentiment": "bullish/bearish/neutral",
  "teams_mentioned": ["Team Name"],
  "key_stats": ["any specific stats mentioned like '5-game win streak' or 'averaging 28 PPG'"]
}`
        }],
        max_tokens: 500,
        temperature: 0.3
      })
    });

    if (!response.ok) return null;

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) return null;

    // Parse JSON from response (handle potential markdown wrapping)
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (err) {
    logger.warn(`AI enrichment failed: ${err.message}`);
    return null;
  }
}

async function enrichArticles(req, res) {
  const startTime = Date.now();

  try {
    // Find articles that need enrichment:
    // - Have a link
    // - Content is null OR very short (just RSS snippet)
    // - Published in last 3 days (don't waste time on old articles)
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const { data: articles, error } = await supabase
      .from('news_articles')
      .select('id, title, link, content, summary')
      .not('link', 'is', null)
      .gte('published_at', threeDaysAgo)
      .is('betting_summary', null)
      .order('published_at', { ascending: false })
      .limit(MAX_ARTICLES_PER_RUN);

    if (error) throw error;

    if (!articles || articles.length === 0) {
      return res.json({ success: true, message: 'No articles to enrich', enriched: 0 });
    }

    logger.info(`Enriching ${articles.length} articles...`);

    let enriched = 0;
    let scraped = 0;
    let aiAnalyzed = 0;

    for (const article of articles) {
      try {
        // Step 1: Scrape full content if we only have a snippet
        let fullContent = article.content;
        const needsScrape = !fullContent || fullContent.length < 200;

        if (needsScrape && article.link) {
          const scraped_content = await fetchArticleContent(article.link);
          if (scraped_content) {
            fullContent = scraped_content;
            scraped++;
          }
        }

        // Step 2: AI analysis for betting intelligence
        const intel = await extractBettingIntel(article.title, fullContent || article.summary || article.title, article.link);

        // Step 3: Update the article
        const updates = {};
        if (fullContent && fullContent.length > (article.content?.length || 0)) {
          updates.content = fullContent;
        }
        if (intel) {
          updates.betting_summary = intel.betting_summary || null;
          updates.injury_mentions = intel.injury_mentions || null;
          updates.sentiment = intel.sentiment || null;
          // Store extra intel in raw_json
          updates.raw_json = {
            teams_mentioned: intel.teams_mentioned || [],
            key_stats: intel.key_stats || [],
            enriched_at: new Date().toISOString()
          };
          aiAnalyzed++;
        } else {
          // Mark as processed even without AI results so we don't retry
          updates.betting_summary = 'Not analyzed';
        }

        if (Object.keys(updates).length > 0) {
          const { error: updateError } = await supabase
            .from('news_articles')
            .update(updates)
            .eq('id', article.id);

          if (updateError) {
            logger.warn(`Failed to update article ${article.id}: ${updateError.message}`);
          } else {
            enriched++;
          }
        }

        // Small delay between requests to be polite
        await new Promise(r => setTimeout(r, 500));

      } catch (articleErr) {
        logger.warn(`Error enriching article ${article.id}: ${articleErr.message}`);
      }
    }

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      enriched,
      scraped,
      aiAnalyzed,
      total: articles.length,
      duration: `${duration}ms`
    });

  } catch (err) {
    logger.error('Article enrichment error:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = enrichArticles;
