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
  {
    name: 'espn-news',
    url: 'https://www.espn.com/espn/rss/news'
  },
  {
    name: 'espn-nfl',
    url: 'https://www.espn.com/espn/rss/nfl/news'
  },
  {
    name: 'espn-nba',
    url: 'https://www.espn.com/espn/rss/nba/news'
  }
];
const MAX_FEEDS_PER_RUN = 1;
const MAX_ITEMS_PER_FEED = 5;
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
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    const items = Array.from(doc.querySelectorAll('item'));
    return items.map((it)=>{
      const title = it.querySelector('title')?.textContent ?? '';
      const link = it.querySelector('link')?.textContent ?? '';
      const guid = it.querySelector('guid')?.textContent ?? '';
      const pubDate = it.querySelector('pubDate')?.textContent ?? '';
      const description = it.querySelector('description')?.textContent ?? '';
      const content = it.querySelector('content\\:encoded')?.textContent ?? '';
      return {
        title,
        link,
        guid,
        pubDate,
        description,
        content
      };
    });
  } catch (e) {
    console.warn('parseRss error', e?.message || e);
    return [];
  }
}
export default async function handler(req) {
  const runStarted = Date.now();
  const MAX_TOTAL_RUN_MS = 28000; // keep under ~30s
  const jobName = 'ingest-news';
  const runLog: any = {
    job_name: jobName,
    started_at: new Date(runStarted).toISOString(),
    status: 'started'
  };
  try {
    const feedsToProcess = FEEDS.slice(0, MAX_FEEDS_PER_RUN);
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
    runLog.status = 'success';
    runLog.finished_at = new Date().toISOString();
    runLog.sources_created = sourcesCreated;
    runLog.articles_inserted = articlesInserted;
    const details = {
      sources_created: sourcesCreated,
      articles_inserted: articlesInserted,
      feeds_processed: feedsToProcess.length
    };
    if (DB_ENABLED) {
      try {
        await supabasePost('cron_job_logs', {
          job_name: jobName,
          status: 'completed',
          details: JSON.stringify(details)
        });
      } catch (e) {
        console.warn('cron log write failed', e instanceof Error ? e.message : String(e));
      }
    }
    return new Response(JSON.stringify({
      status: 'ok',
      run: runLog
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'keep-alive'
      }
    });
  } catch (err) {
    runLog.status = 'failed';
    runLog.finished_at = new Date().toISOString();
    const errMsg = err instanceof Error ? err.message : String(err);
    runLog.detail = { message: errMsg };

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        await supabasePost('cron_job_logs', {
          job_name: jobName,
          status: 'failed',
          details: JSON.stringify({ error: runLog.detail })
        });
      } catch (e) {
        console.warn('cron log write failed', e instanceof Error ? e.message : String(e));
      }
    }
    return new Response(JSON.stringify({
      status: 'error',
      error: runLog
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}
