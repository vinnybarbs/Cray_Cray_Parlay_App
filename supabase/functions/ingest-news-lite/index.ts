// supabase/functions/ingest-news-lite/index.ts
// Minimal version of ingest-news that processes a single feed per run.
// Useful as a fallback when the primary ingest function deployment is unhealthy.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const DB_ENABLED = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const FEEDS: { name: string; url: string }[] = [
  // ── ESPN (sport-specific) ──
  { name: 'espn-news', url: 'https://www.espn.com/espn/rss/news' },
  { name: 'espn-nba', url: 'https://www.espn.com/espn/rss/nba/news' },
  { name: 'espn-nhl', url: 'https://www.espn.com/espn/rss/nhl/news' },
  { name: 'espn-mlb', url: 'https://www.espn.com/espn/rss/mlb/news' },
  { name: 'espn-ncaab', url: 'https://www.espn.com/espn/rss/ncb/news' },
  { name: 'espn-ncaaf', url: 'https://www.espn.com/espn/rss/ncf/news' },
  { name: 'espn-nfl', url: 'https://www.espn.com/espn/rss/nfl/news' },
  { name: 'espn-soccer', url: 'https://www.espn.com/espn/rss/soccer/news' },

  // ── Google News (aggregates On3, 247Sports, team sites, local papers, etc.) ──
  { name: 'gnews-march-madness', url: 'https://news.google.com/rss/search?q=March+Madness+NCAA+tournament+basketball&hl=en-US&gl=US&ceid=US:en' },
  { name: 'gnews-ncaab', url: 'https://news.google.com/rss/search?q=college+basketball+NCAA+preview+picks&hl=en-US&gl=US&ceid=US:en' },
  { name: 'gnews-nba', url: 'https://news.google.com/rss/search?q=NBA+basketball+injury+report+preview&hl=en-US&gl=US&ceid=US:en' },
  { name: 'gnews-nhl', url: 'https://news.google.com/rss/search?q=NHL+hockey+injury+preview+tonight&hl=en-US&gl=US&ceid=US:en' },
  { name: 'gnews-mlb', url: 'https://news.google.com/rss/search?q=MLB+baseball+spring+training+preview&hl=en-US&gl=US&ceid=US:en' },
  { name: 'gnews-betting', url: 'https://news.google.com/rss/search?q=sports+betting+picks+odds+predictions+today&hl=en-US&gl=US&ceid=US:en' },

  // ── CBS Sports ──
  { name: 'cbs-headlines', url: 'https://www.cbssports.com/rss/headlines/' },
  { name: 'cbs-nba', url: 'https://www.cbssports.com/rss/headlines/nba/' },
  { name: 'cbs-nhl', url: 'https://www.cbssports.com/rss/headlines/nhl/' },
  { name: 'cbs-mlb', url: 'https://www.cbssports.com/rss/headlines/mlb/' },
  { name: 'cbs-nfl', url: 'https://www.cbssports.com/rss/headlines/nfl/' },
  { name: 'cbs-ncaab', url: 'https://www.cbssports.com/rss/headlines/college-basketball/' },

  // ── Yahoo Sports ──
  { name: 'yahoo-sports', url: 'https://sports.yahoo.com/rss/' },
  { name: 'yahoo-nba', url: 'https://sports.yahoo.com/nba/rss.xml' },
  { name: 'yahoo-nhl', url: 'https://sports.yahoo.com/nhl/rss.xml' },
  { name: 'yahoo-mlb', url: 'https://sports.yahoo.com/mlb/rss.xml' },
  { name: 'yahoo-nfl', url: 'https://sports.yahoo.com/nfl/rss.xml' },
  { name: 'yahoo-ncaab', url: 'https://sports.yahoo.com/college-basketball/rss.xml' },
  { name: 'yahoo-soccer', url: 'https://sports.yahoo.com/soccer/rss.xml' },

  // ── Bleacher Report ──
  { name: 'br-nba', url: 'https://bleacherreport.com/articles/feed?tag_id=20' },
  { name: 'br-nfl', url: 'https://bleacherreport.com/articles/feed?tag_id=18' },
  { name: 'br-mlb', url: 'https://bleacherreport.com/articles/feed?tag_id=23' },
  { name: 'br-nhl', url: 'https://bleacherreport.com/articles/feed?tag_id=22' },

  // ── Betting / Odds / Picks ──
  { name: 'covers-news', url: 'https://www.covers.com/rss/cmsnews.aspx' },
  { name: 'oddschecker-insights', url: 'https://www.oddschecker.com/us/insight/rss' },
  { name: 'sportsbettingdime', url: 'https://www.sportsbettingdime.com/feed/' },
  { name: 'betiq-picks', url: 'https://betiq.teamrankings.com/feed/' },
  { name: 'actionnetwork', url: 'https://www.actionnetwork.com/feed' },

  // ── The Ringer / SBNation / Deadspin ──
  { name: 'ringer', url: 'https://www.theringer.com/rss/index.xml' },
  { name: 'sbnation', url: 'https://www.sbnation.com/rss/current' },

  // ── Sport-specific deep sources ──
  { name: 'nba-official', url: 'https://www.nba.com/feeds/allnews.xml' },
  { name: 'mlb-news', url: 'https://www.mlb.com/feeds/news/rss.xml' },
  { name: 'nhl-news', url: 'https://www.nhl.com/rss/news.xml' },
  { name: 'rotowire-news', url: 'https://www.rotowire.com/rss/news.htm' },
  { name: 'clutchpoints', url: 'https://clutchpoints.com/feed' },
  { name: 'sportingnews', url: 'https://www.sportingnews.com/us/rss' },
  { name: 'ncaa-official', url: 'https://www.ncaa.com/news/basketball-men/d1/rss.xml' },

];

const MAX_ITEMS_PER_FEED = 10;
const FETCH_TIMEOUT_MS = 5000;

async function fetchWithTimeout(url: string, init?: RequestInit, timeout = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function supabaseGet(path: string) {
  if (!DB_ENABLED) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabasePost(path: string, body: any) {
  if (!DB_ENABLED) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function parseRss(xmlText: string) {
  try {
    const items = [];
    // Simple regex-based RSS parser (works reliably in Deno)
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    const matches = xmlText.matchAll(itemRegex);
    
    for (const match of matches) {
      const itemXml = match[1];
      const extractTag = (tag: string) => {
        const tagRegex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
        const tagMatch = itemXml.match(tagRegex);
        if (!tagMatch) return '';
        // Decode HTML entities and strip CDATA
        let content = tagMatch[1].trim();
        content = content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
        content = content
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'");
        return content;
      };
      
      items.push({
        title: extractTag('title'),
        link: extractTag('link'),
        guid: extractTag('guid'),
        pubDate: extractTag('pubDate'),
        description: extractTag('description'),
        content: extractTag('content:encoded') || extractTag('content')
      });
    }
    
    return items;
  } catch (e) {
    console.warn('parseRss error', e instanceof Error ? e.message : String(e));
    return [];
  }
}

// Background processing function
async function processFeeds() {
  const jobName = 'ingest-news-lite';
  const runStarted = new Date().toISOString();
  let articlesInserted = 0;
  let sourcesCreated = 0;

  console.log('[ingest-news-lite] Background processing started');
  
  try {
    // Process 10 feeds per run, rotating through all sources over time
    // Use hour-based offset to rotate which feeds get processed
    const batchSize = 15;
    // Use epoch minutes so each invocation hits different feeds (not stuck on same hour)
    const epochMinutes = Math.floor(Date.now() / 60000);
    const offset = (epochMinutes * batchSize) % FEEDS.length;
    const feedsToProcess = [];
    for (let i = 0; i < batchSize; i++) {
      feedsToProcess.push(FEEDS[(offset + i) % FEEDS.length]);
    }
    console.log(`[ingest-news-lite] Processing ${feedsToProcess.length} feeds (offset=${offset})`);
    
    for (const feed of feedsToProcess) {
      console.log('[ingest-news-lite] Processing feed:', feed.name);
      let sourceId: number | null = null;
      try {
        console.log('[ingest-news-lite] Checking for existing source...');
        const existing = await supabaseGet(`news_sources?feed_url=eq.${encodeURIComponent(feed.url)}&select=*`);
        console.log('[ingest-news-lite] Existing source result:', existing?.length || 0);
        if (existing && existing.length > 0) {
          sourceId = existing[0].id;
        } else {
          const created = await supabasePost('news_sources', { name: feed.name, feed_url: feed.url });
          sourceId = created?.[0]?.id ?? null;
          if (sourceId) sourcesCreated += 1;
        }

        console.log('[ingest-news-lite] Fetching RSS feed:', feed.url);
        const resp = await fetchWithTimeout(feed.url, {
          headers: { 'User-Agent': 'CrayCrayIngestLite/1.0' },
        });
        console.log('[ingest-news-lite] RSS fetch response:', resp.status);
        if (!resp.ok) {
          console.warn(`Feed ${feed.url} returned ${resp.status}`);
          continue;
        }

        const text = await resp.text();
        console.log('[ingest-news-lite] RSS text length:', text.length);
        const items = parseRss(text).slice(0, MAX_ITEMS_PER_FEED);
        console.log('[ingest-news-lite] Parsed items:', items.length);

        for (const item of items) {
          const dedupeKey = item.guid || item.link || item.title;
          console.log('[ingest-news-lite] Checking dedupe for:', dedupeKey.substring(0, 50));
          const dup = await supabaseGet(
            `news_articles?source_id=eq.${sourceId}&dedupe_key=eq.${encodeURIComponent(dedupeKey)}&select=id`
          );
          if (dup && dup.length > 0) {
            console.log('[ingest-news-lite] Duplicate found, skipping');
            continue;
          }

          console.log('[ingest-news-lite] Inserting article:', item.title.substring(0, 50));
          await supabasePost('news_articles', {
            source_id: sourceId,
            feed_url: feed.url,
            dedupe_key: dedupeKey,
            title: item.title,
            link: item.link,
            published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
            content: item.content || item.description,
            summary: item.description,
            raw_json: { parsed_from: 'rss-lite' },
          });
          articlesInserted += 1;
          console.log('[ingest-news-lite] Article inserted, total:', articlesInserted);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn('Feed error', feed.url, errMsg);
      }
    }

    console.log('[ingest-news-lite] Background processing complete', { articlesInserted, sourcesCreated });
    
    if (DB_ENABLED) {
      await supabasePost('cron_job_logs', {
        job_name: jobName,
        status: 'completed',
        details: JSON.stringify({
          sources_created: sourcesCreated,
          articles_inserted: articlesInserted,
        }),
      });
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[ingest-news-lite] Background error:', errMsg);

    if (DB_ENABLED) {
      try {
        await supabasePost('cron_job_logs', {
          job_name: jobName,
          status: 'failed',
          details: JSON.stringify({ error: errMsg }),
        });
      } catch (_) {
        // ignore
      }
    }
  }
}

serve(async (req: Request) => {
  console.log('[ingest-news-lite] Request received, starting background job');
  
  // Return immediately
  const response = new Response(
    JSON.stringify({ 
      status: 'accepted', 
      message: 'RSS ingestion started in background',
      timestamp: new Date().toISOString()
    }),
    { status: 202, headers: { 'Content-Type': 'application/json' } }
  );
  
  // Process in background (fire and forget)
  processFeeds().catch(err => {
    console.error('[ingest-news-lite] Background job failed:', err);
  });
  
  return response;
});
