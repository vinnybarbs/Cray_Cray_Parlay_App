// supabase/functions/ingest-news-lite/index.ts
// Minimal version of ingest-news that processes a single feed per run.
// Useful as a fallback when the primary ingest function deployment is unhealthy.

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const DB_ENABLED = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const FEEDS: { name: string; url: string }[] = [
  { name: 'espn-news', url: 'https://www.espn.com/espn/rss/news' },
];

const MAX_ITEMS_PER_FEED = 3;
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
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const items = Array.from(doc.querySelectorAll('item'));
  return items.map((item) => ({
    title: item.querySelector('title')?.textContent ?? '',
    link: item.querySelector('link')?.textContent ?? '',
    guid: item.querySelector('guid')?.textContent ?? '',
    pubDate: item.querySelector('pubDate')?.textContent ?? '',
    description: item.querySelector('description')?.textContent ?? '',
    content: item.querySelector('content\\:encoded')?.textContent ?? '',
  }));
}

export default async function handler(req: Request) {
  const jobName = 'ingest-news-lite';
  const runStarted = new Date().toISOString();
  let articlesInserted = 0;
  let sourcesCreated = 0;

  try {
    const feedsToProcess = FEEDS.slice(0, 1);

    for (const feed of feedsToProcess) {
      let sourceId: number | null = null;
      try {
        const existing = await supabaseGet(`news_sources?feed_url=eq.${encodeURIComponent(feed.url)}&select=*`);
        if (existing && existing.length > 0) {
          sourceId = existing[0].id;
        } else {
          const created = await supabasePost('news_sources', { name: feed.name, feed_url: feed.url });
          sourceId = created?.[0]?.id ?? null;
          if (sourceId) sourcesCreated += 1;
        }

        const resp = await fetchWithTimeout(feed.url, {
          headers: { 'User-Agent': 'CrayCrayIngestLite/1.0' },
        });
        if (!resp.ok) {
          console.warn(`Feed ${feed.url} returned ${resp.status}`);
          continue;
        }

        const text = await resp.text();
        const items = parseRss(text).slice(0, MAX_ITEMS_PER_FEED);

        for (const item of items) {
          const dedupeKey = item.guid || item.link || item.title;
          const dup = await supabaseGet(
            `news_articles?source_id=eq.${sourceId}&dedupe_key=eq.${encodeURIComponent(dedupeKey)}&select=id`
          );
          if (dup && dup.length > 0) continue;

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
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn('Feed error', feed.url, errMsg);
      }
    }

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

    return new Response(
      JSON.stringify({
        status: 'ok',
        sources_created: sourcesCreated,
        articles_inserted: articlesInserted,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[ingest-news-lite] Error:', errMsg);

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

    return new Response(
      JSON.stringify({ status: 'error', message: errMsg }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
