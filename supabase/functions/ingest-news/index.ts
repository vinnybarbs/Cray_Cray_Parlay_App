import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const DB_ENABLED = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
if (!DB_ENABLED) {
  console.warn('[ingest-news] DB writes DISABLED: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in Edge env');
} else {
  console.log('[ingest-news] DB writes ENABLED: using SUPABASE_URL from env');
}
const FEEDS = [
  // ESPN
  { name: 'espn-news', url: 'https://www.espn.com/espn/rss/news' },
  { name: 'espn-nfl', url: 'https://www.espn.com/espn/rss/nfl/news' },
  { name: 'espn-nba', url: 'https://www.espn.com/espn/rss/nba/news' },
  { name: 'espn-nhl', url: 'https://www.espn.com/espn/rss/nhl/news' },
  { name: 'espn-mlb', url: 'https://www.espn.com/espn/rss/mlb/news' },
  
  // CBS Sports
  { name: 'cbs-headlines', url: 'https://www.cbssports.com/rss/headlines/' },
  { name: 'cbs-nfl', url: 'https://www.cbssports.com/rss/headlines/nfl/' },
  { name: 'cbs-nba', url: 'https://www.cbssports.com/rss/headlines/nba/' },
  { name: 'cbs-nhl', url: 'https://www.cbssports.com/rss/headlines/nhl/' },
  { name: 'cbs-mlb', url: 'https://www.cbssports.com/rss/headlines/mlb/' },
  
  // Yahoo Sports
  { name: 'yahoo-sports', url: 'https://sports.yahoo.com/rss/' },
  { name: 'yahoo-nfl', url: 'https://sports.yahoo.com/nfl/rss.xml' },
  { name: 'yahoo-nba', url: 'https://sports.yahoo.com/nba/rss.xml' },
  { name: 'yahoo-nhl', url: 'https://sports.yahoo.com/nhl/rss.xml' },
  { name: 'yahoo-mlb', url: 'https://sports.yahoo.com/mlb/rss.xml' },
  
  // Bleacher Report
  { name: 'br-nfl', url: 'https://bleacherreport.com/articles/feed?tag_id=18' },
  { name: 'br-nba', url: 'https://bleacherreport.com/articles/feed?tag_id=20' },
];
const MAX_ITEMS_PER_FEED = 10;
function timeoutAfter(ms) {
  return new Promise((_, reject)=>setTimeout(()=>reject(new Error('timeout')), ms));
}
async function fetchWithTimeout(url, init, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init || {},
      signal: controller.signal
    });
    return res;
  } finally{
    clearTimeout(id);
  }
}
async function supabaseFetch(path, options = {}, timeoutMs = 8000) {
  if (!DB_ENABLED) {
    console.warn('[ingest-news] Skipping Supabase fetch, DB_DISABLED, path=', path);
    return null;
  }
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...options.headers || {},
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY
      }
    });
    return res;
  } finally{
    clearTimeout(id);
  }
}
async function supabaseGet(path) {
  const res = await supabaseFetch(path, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  });
  if (!res) return null;
  if (!res.ok) throw new Error(`Supabase GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}
async function supabasePost(path, body) {
  const res = await supabaseFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    }
  });
  if (!res) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase POST ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}
function parseRss(xmlText) {
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
    console.warn('parseRss error', e?.message || e);
    return [];
  }
}
// Background processing function
async function processFeeds() {
  const runStarted = Date.now();
  const MAX_TOTAL_RUN_MS = 120000; // 2 minutes max for background job
  const jobName = 'ingest-news';
  
  console.log('[ingest-news] Background processing started');
  
  try {
    // Process ALL feeds, not just first 5 - we want ESPN, CBS, Yahoo, Bleacher Report
    const feedsToProcess = FEEDS;
    let sourcesCreated = 0;
    let articlesInserted = 0;
    for (const feed of feedsToProcess){
      // global timeout guard
      if (Date.now() - runStarted > MAX_TOTAL_RUN_MS) {
        console.warn('[ingest-news] global timeout reached, returning early');
        break;
      }
      try {
        // Ensure source exists
        let sources = null;
        try {
          sources = await supabaseGet(`news_sources?feed_url=eq.${encodeURIComponent(feed.url)}&select=*`);
        } catch (e) {
          console.warn('supabaseGet news_sources failed', e?.message || e);
        }
        let sourceId = null;
        if (sources && sources.length > 0) {
          sourceId = sources[0].id;
        } else {
          try {
            const created = await supabasePost('news_sources', {
              name: feed.name,
              feed_url: feed.url
            });
            sourceId = created?.[0]?.id ?? null;
            if (sourceId) sourcesCreated += 1;
          } catch (e) {
            console.warn('create source failed', e?.message || e);
          }
        }
        // Fetch feed with timeout
        let resp = null;
        try {
          resp = await fetchWithTimeout(feed.url, {
            headers: {
              'User-Agent': 'Cray_Cray_Ingest/1.0'
            }
          }, 10000);
        } catch (e) {
          console.warn('fetch feed failed', feed.url, e?.message || e);
          continue;
        }
        if (!resp || !resp.ok) {
          console.warn(`Feed ${feed.url} returned ${resp?.status}`);
          continue;
        }
        const text = await resp.text();
        const items = parseRss(text).slice(0, MAX_ITEMS_PER_FEED);
        for (const item of items){
          if (Date.now() - runStarted > MAX_TOTAL_RUN_MS) {
            console.warn('[ingest-news] global timeout reached during items loop, breaking');
            break;
          }
          const dedupeKey = item.guid || item.link || item.title;
          let q = null;
          try {
            q = await supabaseGet(`news_articles?source_id=eq.${sourceId}&dedupe_key=eq.${encodeURIComponent(dedupeKey)}&select=*`);
          } catch (e) {
            console.warn('supabaseGet articles failed', e?.message || e);
          }
          if (q && q.length > 0) continue;
          const payload = {
            source_id: sourceId,
            feed_url: feed.url,
            dedupe_key: dedupeKey,
            title: item.title,
            link: item.link,
            published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
            content: item.content || item.description,
            summary: item.description,
            raw_json: {
              parsed_from: 'rss'
            }
          };
          try {
            const inserted = await supabasePost('news_articles', payload);
            if (inserted && Array.isArray(inserted) && inserted.length > 0) articlesInserted += inserted.length;
          } catch (e) {
            console.warn('insert article failed', e?.message || e);
          }
        }
      } catch (feedErr) {
        console.warn('Feed error', feed.url, feedErr?.message || feedErr);
      }
    }
    console.log('[ingest-news] Background processing complete', { 
      sourcesCreated, 
      articlesInserted, 
      feedsProcessed: feedsToProcess.length 
    });
    
    if (DB_ENABLED) {
      try {
        await supabasePost('cron_job_logs', {
          job_name: jobName,
          status: 'completed',
          details: JSON.stringify({
            sources_created: sourcesCreated,
            articles_inserted: articlesInserted,
            feeds_processed: feedsToProcess.length
          })
        });
      } catch (e) {
        console.warn('cron log write failed', e instanceof Error ? e.message : String(e));
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[ingest-news] Background error:', errMsg);

    if (DB_ENABLED) {
      try {
        await supabasePost('cron_job_logs', {
          job_name: jobName,
          status: 'failed',
          details: JSON.stringify({ error: errMsg })
        });
      } catch (e) {
        console.warn('cron log write failed', e instanceof Error ? e.message : String(e));
      }
    }
  }
}

serve(async (req: Request) => {
  console.log('[ingest-news] Request received, starting background job');
  
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
    console.error('[ingest-news] Background job failed:', err);
  });
  
  return response;
});
