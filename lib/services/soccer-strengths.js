/**
 * Soccer goal model: team attack and defense ratings from match results.
 *
 * Owner 2026-10-13: "Do goal model". The soccer 1X2 model has carried a
 * Dixon-Coles pricer since launch (soccer-1x2.js goalModelProbabilities)
 * but nothing ever fed it, so every soccer read was market only. This
 * module fits the inputs that pricer needs.
 *
 * Model, per match:
 *   log lambda_home = mu[comp] + home[comp] + attack[home] - defense[away]
 *   log lambda_away = mu[comp] + attack[away] - defense[home]
 * Goals are Poisson. Matches are weighted by age (half life HALF_LIFE_DAYS)
 * and every team rating carries a ridge penalty that pulls it toward 0,
 * the league average, so a club with few matches stays near average.
 * rho, the Dixon-Coles low score correction, is fit afterwards by a grid
 * search with the rates held fixed.
 *
 * Pools: one pool for the European clubs (the five domestic leagues plus
 * the Champions League and Europa League, which link them) and one for
 * MLS. A club keeps one rating across its competitions. Each competition
 * keeps its own scoring rate and home advantage.
 *
 * Pure functions here, IO in api/cron/fit-soccer-strengths.js and the
 * loader at the bottom. Fitting costs no API credits and no model calls.
 */

const { goalModelProbabilities, devigProportional, rawImplied } = require('./edge-models/soccer-1x2.js');
const { sportDayISO } = require('./sport-day.js');

const POOLS = {
  europe: ['EPL', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Champions League', 'Europa League'],
  mls: ['MLS'],
};
const SPORT_TO_POOL = {};
for (const [pool, sports] of Object.entries(POOLS)) for (const s of sports) SPORT_TO_POOL[s] = pool;

const HALF_LIFE_DAYS = 180;
const RIDGE = 3;          // in weighted matches, per team rating
const ITERATIONS = 80;
const MIN_TEAM_GAMES = 5; // weighted matches before a club gets a price
const RHO_GRID = [-0.2, -0.15, -0.12, -0.1, -0.08, -0.06, -0.04, -0.02, 0, 0.02, 0.05];
const BLEND_WEIGHTS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 1];

function poolForSport(sport) {
  return SPORT_TO_POOL[sport] || null;
}

/**
 * JS version of the soccer_team_key() SQL function (migration
 * 20261014000000): strip accents and punctuation, fold & to and, drop
 * club suffixes, then apply the alias table. Pass the alias rows as a Map
 * of alias_key to canonical_key. Keys are only compared with other JS
 * keys. The SQL translate() target string carries one extra o, so SQL
 * maps a period to c where this maps it to a space. Both sides of the
 * grading join use the SQL one, so that one stays as it is.
 */
const ACCENTS_FROM = 'áàâäãåéèêëíìîïóòôöõøúùûüñçÁÀÂÄÉÈÊËÍÓÔÖÚÜÑÇ.';
const ACCENTS_TO = 'aaaaaaeeeeiiiioooooouuuuncAAAAEEEEIOOOUUNC ';
const SUFFIX_RE = /\b(fc|sc|afc|cf|ac|as|ss|ssc|sv|vfb|vfl|tsg|rc|rcd|ud|cd|ogc|club|de|calcio|\d+)\b/g;
function soccerTeamKey(name, aliases = null) {
  let s = String(name || '');
  let out = '';
  for (const ch of s) {
    const i = ACCENTS_FROM.indexOf(ch);
    out += i >= 0 ? ACCENTS_TO[i] : ch;
  }
  s = out.toLowerCase().replace(/&/g, ' and ').replace(/-/g, ' ');
  s = s.replace(SUFFIX_RE, '').replace(/\s+/g, ' ').trim();
  if (aliases && aliases.has(s)) return aliases.get(s);
  return s;
}

function daysBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
}

/**
 * Fit one pool.
 *
 * matches: [{ date 'YYYY-MM-DD', competition, homeId, awayId, homeName,
 *             awayName, homeGoals, awayGoals }]
 * Only matches dated before asOf are used, which is what makes the
 * walk-forward evaluation honest.
 */
function fitStrengths(matches, { asOf, halfLifeDays = HALF_LIFE_DAYS, ridge = RIDGE, iterations = ITERATIONS } = {}) {
  const asOfDate = asOf || sportDayISO();
  const rows = [];
  for (const m of matches || []) {
    if (!m || !m.date || m.date >= asOfDate) continue;
    if (m.homeId == null || m.awayId == null) continue;
    if (!Number.isFinite(m.homeGoals) || !Number.isFinite(m.awayGoals)) continue;
    const age = daysBetween(m.date, asOfDate);
    const w = Math.pow(0.5, age / halfLifeDays);
    if (w < 0.01) continue;
    rows.push({ ...m, w });
  }
  if (rows.length === 0) return null;

  // Teams and competitions.
  const teams = new Map();
  const comps = new Map();
  const touchTeam = (id, name, comp, w) => {
    let t = teams.get(id);
    if (!t) { t = { id, name, attack: 0, defense: 0, games: 0, competitions: new Set() }; teams.set(id, t); }
    t.games += w;
    t.name = name || t.name;
    t.competitions.add(comp);
  };
  for (const r of rows) {
    touchTeam(r.homeId, r.homeName, r.competition, r.w);
    touchTeam(r.awayId, r.awayName, r.competition, r.w);
    let c = comps.get(r.competition);
    if (!c) { c = { w: 0, hg: 0, ag: 0, games: 0 }; comps.set(r.competition, c); }
    c.w += r.w; c.hg += r.w * r.homeGoals; c.ag += r.w * r.awayGoals; c.games += 1;
  }
  const compParams = new Map();
  for (const [name, c] of comps) {
    const hg = Math.max(c.hg / c.w, 0.2);
    const ag = Math.max(c.ag / c.w, 0.2);
    compParams.set(name, { mu: Math.log(ag), home: Math.log(hg / ag), games: c.games });
  }

  const lambdas = (r) => {
    const cp = compParams.get(r.competition);
    const h = teams.get(r.homeId);
    const a = teams.get(r.awayId);
    return {
      lh: Math.exp(cp.mu + cp.home + h.attack - a.defense),
      la: Math.exp(cp.mu + a.attack - h.defense),
    };
  };

  for (let it = 0; it < iterations; it++) {
    // Team ratings, one Newton step each with the rest held fixed.
    const gA = new Map(); const hA = new Map(); const gD = new Map(); const hD = new Map();
    for (const id of teams.keys()) { gA.set(id, 0); hA.set(id, 0); gD.set(id, 0); hD.set(id, 0); }
    for (const r of rows) {
      const { lh, la } = lambdas(r);
      // home attack and away defense drive lh, away attack and home defense drive la
      gA.set(r.homeId, gA.get(r.homeId) + r.w * (r.homeGoals - lh));
      hA.set(r.homeId, hA.get(r.homeId) + r.w * lh);
      gD.set(r.awayId, gD.get(r.awayId) - r.w * (r.homeGoals - lh));
      hD.set(r.awayId, hD.get(r.awayId) + r.w * lh);
      gA.set(r.awayId, gA.get(r.awayId) + r.w * (r.awayGoals - la));
      hA.set(r.awayId, hA.get(r.awayId) + r.w * la);
      gD.set(r.homeId, gD.get(r.homeId) - r.w * (r.awayGoals - la));
      hD.set(r.homeId, hD.get(r.homeId) + r.w * la);
    }
    for (const t of teams.values()) {
      t.attack += (gA.get(t.id) - ridge * t.attack) / (hA.get(t.id) + ridge);
      t.defense += (gD.get(t.id) - ridge * t.defense) / (hD.get(t.id) + ridge);
    }

    // Competition scoring rate and home advantage.
    const cg = new Map();
    for (const name of compParams.keys()) cg.set(name, { gMu: 0, hMu: 0, gH: 0, hH: 0 });
    for (const r of rows) {
      const { lh, la } = lambdas(r);
      const c = cg.get(r.competition);
      c.gMu += r.w * ((r.homeGoals - lh) + (r.awayGoals - la));
      c.hMu += r.w * (lh + la);
      c.gH += r.w * (r.homeGoals - lh);
      c.hH += r.w * lh;
    }
    for (const [name, cp] of compParams) {
      const c = cg.get(name);
      if (c.hMu > 0) cp.mu += c.gMu / c.hMu;
      if (c.hH > 0) cp.home += c.gH / c.hH;
    }
  }

  // rho by grid search, rates fixed.
  let best = { rho: 0, ll: -Infinity };
  for (const rho of RHO_GRID) {
    let ll = 0;
    for (const r of rows) {
      if (r.homeGoals > 1 || r.awayGoals > 1) continue;
      const { lh, la } = lambdas(r);
      let tau = 1;
      if (r.homeGoals === 0 && r.awayGoals === 0) tau = 1 - lh * la * rho;
      else if (r.homeGoals === 0 && r.awayGoals === 1) tau = 1 + lh * rho;
      else if (r.homeGoals === 1 && r.awayGoals === 0) tau = 1 + la * rho;
      else tau = 1 - rho;
      if (!(tau > 0)) { ll = -Infinity; break; }
      ll += r.w * Math.log(tau);
    }
    if (ll > best.ll) best = { rho, ll };
  }

  const competitions = {};
  for (const [name, cp] of compParams) competitions[name] = { mu: cp.mu, home: cp.home, games: cp.games };
  return {
    asOf: asOfDate,
    halfLifeDays,
    ridge,
    rho: best.rho,
    nMatches: rows.length,
    competitions,
    teams: [...teams.values()].map((t) => ({
      id: t.id,
      name: t.name,
      attack: t.attack,
      defense: t.defense,
      games: t.games,
      competitions: [...t.competitions],
    })),
  };
}

/**
 * Index a fit (from fitStrengths or loaded rows) by soccer team key so
 * Odds API names can be looked up. Returns { competitions, rho, byKey }.
 */
function indexFit(fit, aliases = null) {
  if (!fit) return null;
  const byKey = new Map();
  const byId = new Map();
  for (const t of fit.teams || []) {
    byId.set(String(t.id), t);
    const key = soccerTeamKey(t.name, aliases);
    const prior = byKey.get(key);
    // Two clubs on one key (rare) keeps the one with more matches.
    if (!prior || t.games > prior.games) byKey.set(key, t);
  }
  return { competitions: fit.competitions || {}, rho: fit.rho || 0, byKey, byId };
}

/**
 * Expected goals for a match, the direct form goalModelProbabilities
 * takes. Null when either club is missing or thin, or the competition has
 * no fitted rate.
 */
function expectedGoalsFor(indexed, competition, home, away, aliases = null) {
  if (!indexed) return null;
  const cp = indexed.competitions[competition];
  if (!cp) return null;
  const pick = (t) => (t && typeof t === 'object' ? t : indexed.byKey.get(soccerTeamKey(t, aliases)));
  const h = pick(home);
  const a = pick(away);
  if (!h || !a || h.games < MIN_TEAM_GAMES || a.games < MIN_TEAM_GAMES) return null;
  return {
    homeExpectedGoals: Math.exp(cp.mu + cp.home + h.attack - a.defense),
    awayExpectedGoals: Math.exp(cp.mu + a.attack - h.defense),
    rho: indexed.rho,
  };
}

/** Proportional consensus of closing books, the market view. */
function marketConsensus(books) {
  const fair = [];
  for (const b of books || []) {
    const ri = rawImplied(b);
    if (!ri) continue;
    const f = devigProportional(ri.raw);
    if (f) fair.push(f);
  }
  if (fair.length === 0) return null;
  const avg = (k) => fair.reduce((s, f) => s + f[k], 0) / fair.length;
  const p = { home: avg('home'), draw: avg('draw'), away: avg('away') };
  const t = p.home + p.draw + p.away;
  return { home: p.home / t, draw: p.draw / t, away: p.away / t, books: fair.length };
}

function outcomeOf(homeGoals, awayGoals) {
  return homeGoals > awayGoals ? 'home' : homeGoals < awayGoals ? 'away' : 'draw';
}

/**
 * Score predictions. Each item: { market: {home,draw,away}, model:
 * {home,draw,away}, outcome }. Returns log loss and Brier for each blend
 * weight on the goal model (0 is the market alone, 1 the model alone).
 */
function scorePredictions(items, weights = BLEND_WEIGHTS) {
  const out = {};
  for (const w of weights) {
    let ll = 0; let brier = 0; let n = 0;
    for (const it of items) {
      const p = {};
      for (const k of ['home', 'draw', 'away']) p[k] = (1 - w) * it.market[k] + w * it.model[k];
      const po = Math.max(p[it.outcome], 1e-9);
      ll -= Math.log(po);
      for (const k of ['home', 'draw', 'away']) brier += Math.pow(p[k] - (k === it.outcome ? 1 : 0), 2);
      n++;
    }
    out[String(w)] = n ? { logLoss: +(ll / n).toFixed(5), brier: +(brier / n).toFixed(5), n } : { logLoss: null, brier: null, n: 0 };
  }
  return out;
}

/** Monday (UTC) of the week holding an ISO date. */
function weekStart(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Walk-forward replay. For each week holding a priced match, fit on the
 * matches before that Monday, price the week, and score the goal model
 * against the devigged closing consensus.
 *
 * priced: [{ date, competition, home, away, books, homeGoals, awayGoals }]
 *   home and away are names in the matches' naming (ESPN), books the
 *   closing three way prices.
 */
function walkForward(matches, priced, { aliases = null, fitOptions = {} } = {}) {
  const weeks = new Map();
  for (const g of priced || []) {
    const wk = weekStart(g.date);
    if (!weeks.has(wk)) weeks.set(wk, []);
    weeks.get(wk).push(g);
  }
  const items = [];
  let unpriced = 0;
  for (const [wk, games] of [...weeks.entries()].sort()) {
    const idx = indexFit(fitStrengths(matches, { ...fitOptions, asOf: wk }), aliases);
    for (const g of games) {
      const market = marketConsensus(g.books);
      const eg = expectedGoalsFor(idx, g.competition, g.home, g.away, aliases);
      const model = eg ? goalModelProbabilities(eg) : null;
      if (!market || !model) { unpriced++; continue; }
      items.push({ market, model, outcome: outcomeOf(g.homeGoals, g.awayGoals), date: g.date, competition: g.competition });
    }
  }
  return { scores: scorePredictions(items), n: items.length, unpriced, weeks: weeks.size, items };
}

/**
 * Load the current ratings, competition rates and goal_model_weight dials
 * for pre-analyze. Cached per process for CACHE_MS so one board run reads
 * the tables once. Fails soft: any error returns an empty model, and the
 * soccer reads stay market only, exactly as before the goal model.
 */
const CACHE_MS = 30 * 60 * 1000;
let cache = null;
async function loadCurrent(supabase, { now = Date.now() } = {}) {
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  const value = { pools: {}, weights: {}, aliases: new Map() };
  try {
    const [aliasRes, dialRes] = await Promise.all([
      supabase.from('soccer_team_aliases').select('alias_key, canonical_key'),
      supabase.from('sport_dials').select('sport, value').eq('dial', 'goal_model_weight'),
    ]);
    for (const a of aliasRes.data || []) value.aliases.set(a.alias_key, a.canonical_key);
    for (const d of dialRes.data || []) {
      const w = Number(d.value);
      if (Number.isFinite(w)) value.weights[d.sport] = Math.max(0, Math.min(1, w));
    }
    for (const pool of Object.keys(POOLS)) {
      const { data: fits } = await supabase
        .from('soccer_model_fits')
        .select('fitted_at, rho, competitions')
        .eq('pool', pool)
        .order('fitted_at', { ascending: false })
        .limit(1);
      const fit = fits && fits[0];
      if (!fit) continue;
      const { data: teams } = await supabase
        .from('soccer_team_strengths')
        .select('espn_team_id, team_name, attack, defense, games_weighted')
        .eq('pool', pool)
        .limit(2000);
      value.pools[pool] = indexFit({
        rho: Number(fit.rho),
        competitions: fit.competitions,
        teams: (teams || []).map((t) => ({
          id: t.espn_team_id,
          name: t.team_name,
          attack: Number(t.attack),
          defense: Number(t.defense),
          games: Number(t.games_weighted),
        })),
      }, value.aliases);
      value.pools[pool].fittedAt = fit.fitted_at;
    }
  } catch (err) {
    console.warn(`soccer goal model load failed, market only: ${err.message}`);
  }
  cache = { at: now, value };
  return value;
}

/**
 * Pre-analyze entry: the strengths input and blend weight for one match.
 * strengths is null when the club or competition is not rated.
 */
function goalInputsFor(current, sport, homeTeam, awayTeam) {
  const weight = (current && current.weights[sport]) || 0;
  const pool = poolForSport(sport);
  const idx = current && pool ? current.pools[pool] : null;
  const strengths = idx ? expectedGoalsFor(idx, sport, homeTeam, awayTeam, current.aliases) : null;
  return { strengths, modelWeight: weight };
}

function clearCache() { cache = null; }

module.exports = {
  loadCurrent,
  goalInputsFor,
  clearCache,
  POOLS,
  HALF_LIFE_DAYS,
  RIDGE,
  MIN_TEAM_GAMES,
  BLEND_WEIGHTS,
  poolForSport,
  soccerTeamKey,
  fitStrengths,
  indexFit,
  expectedGoalsFor,
  marketConsensus,
  outcomeOf,
  scorePredictions,
  weekStart,
  walkForward,
};
