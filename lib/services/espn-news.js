/**
 * ESPN news for the narration prompt, one structured call per sport.
 *
 * Owner 2026-09-14 (build_queue 36): the RSS ingester (43 feeds every 2
 * hours) and the Claude enrichment pass fed nothing but five headline
 * lines of the narration prompt, so both are dropped. This replaces them
 * with ESPN's news API, which tags every article to teams and athletes,
 * so matching is by tag instead of a title substring, and there is no
 * model call anywhere in the path.
 *
 * Fail soft: any fetch or shape problem yields no lines, never a throw.
 * One fetch per sport per 30 minutes covers a whole slate.
 */

'use strict';

const ESPN_NEWS_PATHS = {
  NFL: 'football/nfl',
  NCAAF: 'football/college-football',
  NBA: 'basketball/nba',
  NCAAB: 'basketball/mens-college-basketball',
  NHL: 'hockey/nhl',
  MLB: 'baseball/mlb',
  EPL: 'soccer/eng.1',
  MLS: 'soccer/usa.1',
  Golf: 'golf/pga',
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const LIMIT = 100;
const _cache = new Map(); // sport -> { at, articles }

const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** ESPN article to the small shape the prompt needs. Pure. */
function normalizeArticle(a) {
  const headline = a?.headline || a?.title;
  if (!headline) return null;
  const cats = Array.isArray(a?.categories) ? a.categories : [];
  return {
    headline: String(headline).trim(),
    description: a?.description ? String(a.description).trim() : '',
    published: a?.published || a?.lastModified || null,
    type: a?.type || null,
    teams: cats.filter(c => c?.type === 'team' && c?.description).map(c => c.description),
    athletes: cats.filter(c => c?.type === 'athlete' && c?.description).map(c => c.description),
  };
}

function nameMatches(candidate, name) {
  const c = nameKey(candidate), n = nameKey(name);
  if (!c || !n) return false;
  return c === n || c.includes(n) || n.includes(c);
}

/**
 * Articles tagged to any of the names (team or athlete categories), or
 * whose headline carries the full name, newest first, within maxAgeDays.
 * Full names only: a mascot alone matched a Nets assistant coach once.
 * Pure.
 */
function matchNews(articles, names, { maxAgeDays = 3, limit = 5, now = Date.now() } = {}) {
  const wanted = (names || []).filter(Boolean);
  if (wanted.length === 0) return [];
  const floor = now - maxAgeDays * 24 * 3600 * 1000;
  const hits = [];
  for (const a of articles || []) {
    if (!a) continue;
    const t = a.published ? new Date(a.published).getTime() : NaN;
    if (Number.isFinite(t) && t < floor) continue;
    const tagged = [...(a.teams || []), ...(a.athletes || [])];
    const hit = wanted.some(n => tagged.some(tag => nameMatches(tag, n)) || nameKey(a.headline).includes(nameKey(n)));
    if (hit) hits.push(a);
  }
  hits.sort((x, y) => (new Date(y.published).getTime() || 0) - (new Date(x.published).getTime() || 0));
  return hits.slice(0, limit);
}

/** Prompt lines in the shape the RSS path produced. Pure. */
function formatNewsLines(articles) {
  if (!articles || articles.length === 0) return null;
  return articles.map(a => {
    let line = `- ${a.headline}`;
    if (a.description) line += ` | ${a.description.substring(0, 150)}`;
    return line;
  }).join('\n');
}

async function fetchSportNews(sport, fetchFn = fetch) {
  const path = ESPN_NEWS_PATHS[sport];
  if (!path) return null;
  const cached = _cache.get(sport);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.articles;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetchFn(`https://site.api.espn.com/apis/site/v2/sports/${path}/news?limit=${LIMIT}`, {
      headers: { 'User-Agent': 'TrapHawk/1.0' }, signal: controller.signal,
    });
    if (!res.ok) return cached ? cached.articles : null;
    const data = await res.json();
    const articles = (Array.isArray(data?.articles) ? data.articles : []).map(normalizeArticle).filter(Boolean);
    _cache.set(sport, { at: Date.now(), articles });
    return articles;
  } catch {
    return cached ? cached.articles : null;
  } finally {
    clearTimeout(timer);
  }
}

/** Newest articles about the named teams or players, as prompt lines, or null. */
async function getNewsText(sport, names, opts = {}, fetchFn = fetch) {
  const articles = await fetchSportNews(sport, fetchFn);
  if (!articles) return null;
  return formatNewsLines(matchNews(articles, names, opts));
}

/** Same articles as objects, for the digest fact sheet. */
async function getNewsArticles(sport, names, opts = {}, fetchFn = fetch) {
  const articles = await fetchSportNews(sport, fetchFn);
  if (!articles) return [];
  return matchNews(articles, names, opts);
}

function _resetCache() { _cache.clear(); }

module.exports = {
  ESPN_NEWS_PATHS, normalizeArticle, matchNews, formatNewsLines,
  fetchSportNews, getNewsText, getNewsArticles, _resetCache,
};
