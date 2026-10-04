/**
 * NHL lineups: who is out of a club's lineup and how much of the lineup
 * he was. The hockey twin of the NFL depth chart gate, built the night
 * NHL went live (owner 2026-10-03: goalie and lineup inputs).
 *
 * Source: DailyFaceoff's team line combinations page, one JSON blob per
 * club with every player's even strength slot (f1 to f4, d1 to d3, g),
 * the special teams units, and an injured group (category oi, group ir)
 * with injuryStatus ir or dtd, the player's cap hit and the latest news
 * line. Cached thirty minutes per club.
 *
 * The weight of an absence is the larger of two ladders: the slot the
 * chart still shows him in (a day to day player often stays listed) and
 * his cap hit, which is the market's own price on the player and the
 * only signal the chart keeps once an injured player is pulled off the
 * lines. IR counts in full, day to day at the dtd weight. Each full
 * weight skater costs nhl_skater_out_pp of win probability and a club's
 * absences cap at nhl_lineup_cap_pp, both dials.
 *
 * Fail soft: no page, no slug, no parse, null, and the calculator keeps
 * the generic injury factor for that club.
 */

'use strict';

const DFO_TEAM = (slug) => `https://www.dailyfaceoff.com/teams/${slug}/line-combinations/`;
const TTL_MS = 30 * 60 * 1000;
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; TrapHawk/1.0)' };

const SLOT_WEIGHT = { f1: 1, f2: 0.7, f3: 0.4, f4: 0.15, d1: 1, d2: 0.6, d3: 0.25, g: 0 };
const STATUS_WEIGHT = { ir: 1, out: 1, dtd: 0.4 };
const CAP_FLOOR = 1_000_000;
const CAP_FULL = 7_500_000;

const DEFAULTS = { skaterOutPp: 0.015, capPp: 0.05 };

const _pages = new Map();
let _slugs = null;

function nameKey(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/** The DFO slug for a club: the site's own team list once seen, else the hyphenated name. */
function slugFor(teamName, teams = _slugs) {
  const k = nameKey(teamName);
  if (teams) {
    for (const t of teams) {
      const tk = nameKey(t.name);
      if (tk === k || tk.includes(k) || k.includes(tk) || (t.mascot && k.endsWith(nameKey(t.mascot)))) return t.slug;
    }
  }
  return k.replace(/\s+/g, '-');
}

/** Pure: the page to { players, updatedAt, teams }. */
function parseLinesPage(html) {
  const m = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s.exec(String(html || ''));
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }
  const pp = data?.props?.pageProps;
  const c = pp?.combinations;
  if (!c || !Array.isArray(c.players)) return null;
  const teams = Array.isArray(pp.sortedTeams) ? pp.sortedTeams.filter(t => t && t.slug && t.name) : null;
  const players = c.players.map(p => ({
    name: p.name,
    position: p.positionIdentifier || null,
    category: p.categoryIdentifier || null,
    group: p.groupIdentifier || null,
    status: p.injuryStatus ? String(p.injuryStatus).toLowerCase() : null,
    gtd: p.gameTimeDecision === true,
    capHit: Number(p?.cap?.capHit) || 0,
    news: p?.latestNews?.details ? String(p.latestNews.details).trim().slice(0, 160) : null,
  }));
  return { team: c.teamName || null, abbr: c.teamAbbreviation || null, updatedAt: c.updatedAt || null, players, teams };
}

/** Pure: the cap hit ladder, 0 at a million, 1 at seven and a half. */
function capWeight(capHit) {
  const c = Number(capHit) || 0;
  return Math.max(0, Math.min(1, (c - CAP_FLOOR) / (CAP_FULL - CAP_FLOOR)));
}

/**
 * Pure: the absences and the win probability cost for one club.
 * Returns { impact (<= 0), out: [...], keyLoss, counted } or a zero
 * report when nobody is listed.
 */
function lineupImpact(page, { skaterOutPp = DEFAULTS.skaterOutPp, capPp = DEFAULTS.capPp } = {}) {
  const players = page?.players || [];
  // One entry per player: the EV slot wins when he is still on a line.
  const byName = new Map();
  for (const p of players) {
    const k = nameKey(p.name);
    if (!k) continue;
    const cur = byName.get(k) || { ...p, slot: null };
    if (p.category === 'ev' && SLOT_WEIGHT[p.group] != null) cur.slot = p.group;
    if (p.status) cur.status = p.status;
    if (p.gtd) cur.gtd = true;
    cur.capHit = Math.max(cur.capHit || 0, p.capHit || 0);
    if (p.news) cur.news = p.news;
    byName.set(k, cur);
  }
  const out = [];
  let total = 0;
  for (const p of byName.values()) {
    const st = p.status;
    if (!st || STATUS_WEIGHT[st] == null) continue;
    if ((p.slot === 'g') || String(p.position || '').startsWith('g')) continue; // goalies are their own factor
    const slotW = p.slot ? SLOT_WEIGHT[p.slot] : 0;
    const weight = Math.max(slotW, capWeight(p.capHit));
    const statusW = STATUS_WEIGHT[st];
    const cost = Math.round(weight * statusW * skaterOutPp * 10000) / 10000;
    total += cost;
    out.push({ player: p.name, position: p.position, status: st, slot: p.slot, cap_hit: p.capHit, weight: Math.round(weight * 100) / 100, cost, news: p.news || null });
  }
  out.sort((a, b) => b.cost - a.cost);
  const impact = -Math.min(capPp, Math.round(total * 10000) / 10000);
  const keyLoss = out[0] ? `${out[0].player} (${out[0].position || 'skater'}, ${out[0].status}, weight ${out[0].weight})` : null;
  return { impact: Math.round(impact * 10000) / 10000, out, keyLoss, counted: out.length };
}

async function fetchPage(slug, fetchFn = fetch) {
  const cached = _pages.get(slug);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.page;
  let page = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetchFn(DFO_TEAM(slug), { headers: UA, signal: controller.signal, redirect: 'follow' });
      if (res.ok) page = parseLinesPage(await res.text());
    } finally { clearTimeout(timer); }
  } catch { page = null; }
  if (page?.teams && !_slugs) _slugs = page.teams;
  _pages.set(slug, { at: Date.now(), page });
  return page;
}

/** The lineup report for a club, or null when the page is unavailable. */
async function getNhlLineupImpact(teamName, dials = {}, fetchFn = fetch) {
  const slug = slugFor(teamName);
  const page = await fetchPage(slug, fetchFn);
  if (!page) return null;
  const r = lineupImpact(page, dials);
  return { ...r, slug, updatedAt: page.updatedAt, source: 'dailyfaceoff' };
}

function _resetCache() { _pages.clear(); _slugs = null; }

module.exports = { slugFor, parseLinesPage, capWeight, lineupImpact, fetchPage, getNhlLineupImpact, SLOT_WEIGHT, STATUS_WEIGHT, DEFAULTS, _resetCache };
