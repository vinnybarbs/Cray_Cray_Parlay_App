// The paywall (build_queue 71, owner 2026-10-14). Off until PAYWALL=on
// on Railway, so shipping it changes nothing for anyone. When on, a
// visitor without Pro sees every Lean, every trap, every started or
// graded pick and the whole ledger, plus one free Play a day on Today
// and the two strongest props. Every other Play and above comes back
// locked: the game, the market and the tier stay, the side, the price
// and the why are removed on the server, so nothing leaks to the page.

const { getSupabase, entitlementFor, readRow } = require('./billing');

// Play and above, the tier floor the paid plan is sold on.
const PAID_PP = 4;
const FREE_TODAY_PLAYS = 1;
const FREE_PROPS = 2;
const VIEWER_TTL_MS = 60e3;

function paywallOn(env = process.env) {
  return env.PAYWALL === 'on';
}

const viewerCache = new Map();

/**
 * Who is asking and whether they have Pro. Never fails a request: a
 * missing or bad token is a signed out visitor. Cached a minute per
 * token so a page of parallel calls costs one auth lookup.
 */
async function resolveViewer(req, { now = new Date() } = {}) {
  const header = (req.headers && req.headers.authorization) || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { user: null, entitlement: entitlementFor(null, null, now) };
  const hit = viewerCache.get(token);
  if (hit && hit.at > now.getTime() - VIEWER_TTL_MS) return hit.viewer;
  const supabase = getSupabase();
  let viewer = { user: null, entitlement: entitlementFor(null, null, now) };
  if (supabase) {
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data && data.user) {
        const row = await readRow(supabase, data.user.id).catch(() => null);
        viewer = { user: data.user, row, entitlement: entitlementFor(data.user, row, now) };
      }
    } catch { /* signed out */ }
  }
  if (viewerCache.size > 5000) viewerCache.clear();
  viewerCache.set(token, { at: now.getTime(), viewer });
  return viewer;
}

/** Forget a cached viewer, after a webhook changes their access. */
function forgetViewers() {
  viewerCache.clear();
}

/**
 * Whether this request sees everything. Sets the cache header, since a
 * gated answer differs per viewer and must never sit in a shared cache.
 */
async function viewerSeesAll(req, res) {
  if (!paywallOn()) return { all: true };
  if (res && res.setHeader) res.setHeader('Cache-Control', 'private, no-store');
  const viewer = await resolveViewer(req);
  return { all: viewer.entitlement.entitled, viewer };
}

const isPaid = (edge) => edge != null && Number(edge) >= PAID_PP;

/** A Today or board pick with the side taken off. Pure. */
function lockPick(p) {
  return {
    sport: p.sport,
    home_team: p.home_team,
    away_team: p.away_team,
    game_date: p.game_date,
    bet_type: p.bet_type,
    tier: p.tier,
    outcome: p.outcome || null,
    locked: true,
  };
}

/**
 * The Today payload for a visitor without Pro. The single strongest
 * Play stays open as the free play of the day. Pure.
 */
function gateToday(payload) {
  let free = FREE_TODAY_PLAYS;
  const picks = (payload.picks || []).map(p => {
    if (!isPaid(p.edge_pp)) return p;
    if (free > 0) { free--; return { ...p, free: true }; }
    return lockPick(p);
  });
  return { ...payload, picks, gated: true };
}

/** A prop read with the side, line and why taken off. Pure. */
function lockProp(r) {
  return {
    playerKey: r.playerKey,
    player: r.player,
    team: r.team || null,
    market: r.market,
    marketLabel: r.marketLabel,
    homeAbbr: r.homeAbbr,
    awayAbbr: r.awayAbbr,
    commence_time: r.commence_time,
    home_team: r.home_team,
    away_team: r.away_team,
    text: `${r.player} ${r.marketLabel}`,
    locked: true,
  };
}

/**
 * The props payload without Pro: the strongest two Plays stay open.
 * Longshots not yet started are locked too; started ones were public
 * at kickoff, like the started Plays. Pure.
 */
function gateProps(payload) {
  const upcoming = (payload.upcoming || []).map((r, i) => (i < FREE_PROPS ? { ...r, free: true } : lockProp(r)));
  const longshots = (payload.longshots || []).map(r => (r.started ? r : lockProp(r)));
  return { ...payload, upcoming, longshots, gated: true };
}

/** The player sheet without Pro: reads not yet started are locked. Pure. */
function gatePlayer(payload, now = new Date()) {
  const reads = (payload.reads || []).map(r => {
    const upcoming = r.commence_time && new Date(r.commence_time).getTime() > now.getTime();
    if (!upcoming || !isPaid(r.edgePp)) return r;
    return { text: 'Pro read', label: 'Pro read', market: r.market, commence_time: r.commence_time, opponent: r.opponent || null, outcome: r.outcome, locked: true };
  });
  return { ...payload, reads, gated: true };
}

// What a board game tile gives away about the side beyond the
// published pick: the model's own read, its probabilities and its why.
const GAME_SIDE_FIELDS = [
  'recommended_pick', 'recommended_side', 'recommended_odds', 'analysis_snippet',
  'key_factors', 'edges', 'edges_raw', 'calc_home_prob', 'calc_away_prob',
  'edge_score', 'edge_movement', 'what_changed', 'trap_calls',
];

/** One upcoming board game without Pro. Pure. */
function gateGame(game) {
  if (!game) return game;
  const pick = game.published_pick;
  const alts = (game.published_alts || []).map(a => (isPaid(a.edge_pp) ? { bet_type: a.bet_type, tier: a.tier, locked: true } : a));
  if (!pick || !isPaid(pick.edge_pp)) return { ...game, published_alts: game.published_alts ? alts : null };
  const out = { ...game, published_pick: { bet_type: pick.bet_type, tier: pick.tier, locked: true }, published_alts: game.published_alts ? alts : null, locked: true };
  for (const f of GAME_SIDE_FIELDS) delete out[f];
  return out;
}

/**
 * The digest payload without Pro. Only upcoming games lock, a started
 * game's pick is already public on the ledger. Pure.
 */
function gateDigest(payload) {
  const gamesBySport = {};
  for (const [sport, games] of Object.entries(payload.gamesBySport || {})) {
    gamesBySport[sport] = Array.isArray(games) ? games.map(gateGame) : games;
  }
  return { ...payload, gamesBySport, gated: true };
}

/**
 * House parlays without Pro: on a pending ticket, a leg whose game has
 * not started is locked. Pure.
 */
function gateParlays(rows, now = new Date()) {
  return (rows || []).map(p => {
    if (p.status !== 'pending') return p;
    const legs = (p.legs || []).map(l => (l.game_date && new Date(l.game_date).getTime() > now.getTime()
      ? { sport: l.sport, bet_type: l.bet_type, home_team: l.home_team, away_team: l.away_team, game_date: l.game_date, outcome: l.outcome || null, locked: true }
      : l));
    return { ...p, legs, locked: legs.some(l => l.locked) };
  });
}

module.exports = {
  PAID_PP,
  FREE_TODAY_PLAYS,
  FREE_PROPS,
  paywallOn,
  resolveViewer,
  forgetViewers,
  viewerSeesAll,
  lockPick,
  gateToday,
  lockProp,
  gateProps,
  gatePlayer,
  gateGame,
  gateDigest,
  gateParlays,
};
