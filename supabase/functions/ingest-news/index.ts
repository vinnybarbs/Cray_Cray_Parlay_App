// supabase/functions/ingest-news/index.ts
// Deno Edge Function to ingest RSS feeds into Supabase `news_sources` and `news_articles`.
// - Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to write to the DB via REST.
// - If OPENAI_API_KEY is provided, it will compute embeddings and store them in news_embeddings.embedding_json.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';

const DB_ENABLED = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

if (!DB_ENABLED) {
  console.warn('[ingest-news] DB writes DISABLED: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in Edge env');
} else {
  console.log('[ingest-news] DB writes ENABLED: using SUPABASE_URL from env');
}

// Feeds to ingest (ESPN + CBSSports as provided)
const FEEDS: { name: string; url: string }[] = [
  { name: 'espn-news', url: 'https://www.espn.com/espn/rss/news' },
  { name: 'espn-nfl', url: 'https://www.espn.com/espn/rss/nfl/news' },
  { name: 'espn-nba', url: 'https://www.espn.com/espn/rss/nba/news' },
  { name: 'espn-mlb', url: 'https://www.espn.com/espn/rss/mlb/news' },
  { name: 'espn-nhl', url: 'https://www.espn.com/espn/rss/nhl/news' },
  { name: 'espn-golf', url: 'https://www.espn.com/espn/rss/golf/news' },
  { name: 'espn-tennis', url: 'https://www.espn.com/espn/rss/tennis/news' },
  { name: 'espn-soccer', url: 'https://www.espn.com/espn/rss/soccer/news' },
  { name: 'espn-ncb', url: 'https://www.espn.com/espn/rss/ncb/news' },
  { name: 'espn-ncf', url: 'https://www.espn.com/espn/rss/ncf/news' },
  { name: 'cbssports-college-basketball', url: 'https://www.cbssports.com/rss/headlines/college-basketball' },
  { name: 'cbssports-college-football', url: 'https://www.cbssports.com/rss/headlines/college-football' },
  { name: 'cbssports-headlines', url: 'https://www.cbssports.com/rss/headlines/' },
  { name: 'cbssports-golf', url: 'https://www.cbssports.com/rss/headlines/golf' },
  { name: 'cbssports-masters', url: 'https://www.cbssports.com/rss/tag/masters/' },
  { name: 'cbssports-mlb', url: 'https://www.cbssports.com/rss/headlines/mlb' },
  { name: 'cbssports-mma', url: 'https://www.cbssports.com/rss/headlines/mma' },
  { name: 'cbssports-nba', url: 'https://www.cbssports.com/rss/headlines/nba' },
  { name: 'cbssports-nfl', url: 'https://www.cbssports.com/rss/headlines/nfl' },
  { name: 'cbssports-nhl', url: 'https://www.cbssports.com/rss/headlines/nhl' },
  { name: 'cbssports-soccer', url: 'https://www.cbssports.com/rss/headlines/soccer' },
  { name: 'cbssports-tennis', url: 'https://www.cbssports.com/rss/headlines/tennis' },
  { name: 'cbssports-betting', url: 'https://www.cbssports.com/rss/headlines/betting/' }
];

// To avoid hitting Edge Function timeouts, cap work per invocation
const MAX_FEEDS_PER_RUN = 1;          // process only first N feeds each run (small test slice)
const MAX_ITEMS_PER_FEED = 5;         // limit number of articles per feed (small test slice)

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function supabaseGet(path: string) {
  if (!DB_ENABLED) {
    console.warn('[ingest-news] Skipping Supabase GET, DB_DISABLED, path=', path);
    return null;
  }
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Supabase GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabasePost(path: string, body: any) {
  if (!DB_ENABLED) {
    console.warn('[ingest-news] Skipping Supabase POST, DB_DISABLED, path=', path);
    return null;
  }
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase POST ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// OpenAI embeddings helper (currently disabled to keep runtime small)
async function getEmbedding(text: string) {
  return null;
}

// Parse RSS/XML using DOMParser available in Deno runtime
function parseRss(xmlText: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const items = Array.from(doc.querySelectorAll('item'));
  return items.map((it) => {
    const title = it.querySelector('title')?.textContent ?? '';
    const link = it.querySelector('link')?.textContent ?? '';
    const guid = it.querySelector('guid')?.textContent ?? '';
    const pubDate = it.querySelector('pubDate')?.textContent ?? '';
    const description = it.querySelector('description')?.textContent ?? '';
    const content = it.querySelector('content\\:encoded')?.textContent ?? '';
    return { title, link, guid, pubDate, description, content };
  });
}

export default async function handler(req: Request) {
  const runStarted = new Date().toISOString();
  const jobName = 'ingest-news';
  const runLog: any = { job_name: jobName, started_at: runStarted, status: 'started' };

  try {
    // For each feed: ensure source exists and ingest items (limited per run)
    const feedsToProcess = FEEDS.slice(0, MAX_FEEDS_PER_RUN);

    // Simple counters so we can see in the response/logs whether writes succeeded
    let sourcesCreated = 0;
    let articlesInserted = 0;

    for (const feed of feedsToProcess) {
      try {
        // Ensure source exists
        let sources = await supabaseGet(`news_sources?feed_url=eq.${encodeURIComponent(feed.url)}&select=*`);
        let sourceId: number | null = null;
        if (sources && sources.length > 0) {
          sourceId = sources[0].id;
        } else {
          const created = await supabasePost('news_sources', { name: feed.name, feed_url: feed.url });
          sourceId = created?.[0]?.id ?? null;
          if (sourceId) {
            sourcesCreated += 1;
          }
        }

        // Fetch feed with timeout to avoid hanging on slow endpoints
        const resp = await fetchWithTimeout(feed.url, { headers: { 'User-Agent': 'Cray_Cray_Ingest/1.0' } });
        if (!resp.ok) { console.warn(`Feed ${feed.url} returned ${resp.status}`); continue; }
        const text = await resp.text();
        const items = parseRss(text).slice(0, MAX_ITEMS_PER_FEED);

        for (const item of items) {
          const dedupeKey = item.guid || item.link || item.title;
          // Check if article exists
          const q = await supabaseGet(`news_articles?source_id=eq.${sourceId}&dedupe_key=eq.${encodeURIComponent(dedupeKey)}&select=*`);
          if (q && q.length > 0) continue; // already exists

          // Insert article
          const payload = {
            source_id: sourceId,
            feed_url: feed.url,
            dedupe_key: dedupeKey,
            title: item.title,
            link: item.link,
            published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
            content: item.content || item.description,
            summary: item.description,
            raw_json: { parsed_from: 'rss' },
          };
          const inserted = await supabasePost('news_articles', payload);
          if (inserted && Array.isArray(inserted) && inserted.length > 0) {
            articlesInserted += inserted.length;
          }
          // Embeddings disabled for now to keep function runtime within limits
        }
      } catch (feedErr) {
        console.warn('Feed error', feed.url, feedErr?.message || feedErr);
      }
    }

    // Update run log success
    runLog.status = 'success';
    runLog.finished_at = new Date().toISOString();
    (runLog as any).sources_created = sourcesCreated;
    (runLog as any).articles_inserted = articlesInserted;

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      // cron_job_logs schema: job_name, status, details, created_at
      const details = {
        sources_created: sourcesCreated,
        articles_inserted: articlesInserted,
        feeds_processed: feedsToProcess.length,
      };
      await supabasePost('cron_job_logs', {
        job_name: jobName,
        status: 'completed',
        details: JSON.stringify(details),
      });
    }

    return new Response(JSON.stringify({ status: 'ok', run: runLog }), { status: 200 });
  } catch (err) {
    runLog.status = 'failed';
    runLog.finished_at = new Date().toISOString();
    runLog.detail = { message: err?.message || String(err) };

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const errorDetails = {
        error: runLog.detail,
      };
      try {
        await supabasePost('cron_job_logs', {
          job_name: jobName,
          status: 'failed',
          details: JSON.stringify(errorDetails),
        });
      } catch (_) {}
    }

    return new Response(JSON.stringify({ status: 'error', error: runLog }), { status: 500 });
  }
}
