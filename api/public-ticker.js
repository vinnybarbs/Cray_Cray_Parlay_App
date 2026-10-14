// Public-ticker endpoint. Serves the Landing ticker.
//
// Rebuilt 2026-10-14 (owner: "ticker is broke and crap looking"). The old
// version read raw game_analysis edges, so it showed what the board never
// publishes: muted markets (an MLB total as an 11 point Sharp Take while
// MLB totals publish 0), whole shadow sports (MLS, with a nickname of
// "SC"), Skip tier sides, games already under way, and totals with no
// teams ("NHL O 6.5" four times). It now reads the same published picks
// and traps Today shows, upcoming games only, and gates every item on the
// publish dials, so the ticker can never say something the app does not.
//
// Response: {
//   items:    [{ kind, sport, label, matchup, tier, book_pct, our_pct, pp, game_date }],
//   inSeason: ['NHL', ...],   // sports with an item in the window
// }

const { createClient } = require('@supabase/supabase-js');
const { latestPerGame, bookAndOurPct } = require('./today.js');
const { publishFlagsAll, CODE_SHADOW_SPORTS } = require('../lib/services/publish-markets.js');

const HORIZON_HOURS = 36;
const MAX_PICKS = 8;
const MAX_TRAPS = 4;
// Lean and above. A Skip or Leg never reaches the ticker.
const MIN_PP = 2;
const HEADLINE_SESSION = /^auto_digest_\d{4}-\d{2}-\d{2}$/;
const TRAP_SESSION = /^auto_digest_trap_\d{4}-\d{2}-\d{2}$/;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// Nicknames that are two words. Everything else is the last word, which
// also gives a tennis or UFC surname.
const TWO_WORD = ['Red Sox', 'White Sox', 'Blue Jays', 'Maple Leafs', 'Red Wings', 'Blue Jackets', 'Golden Knights', 'Trail Blazers'];
// One on one sports have no home side, so the game reads "A vs B".
const INDIVIDUAL = new Set(['Tennis', 'UFC', 'MMA', 'Boxing']);
function nickname(team) {
  const t = String(team || '').trim();
  const two = TWO_WORD.find(n => t.endsWith(` ${n}`) || t === n);
  return two || t.split(/\s+/).pop();
}

/** 'ml' | 'spread' | 'total' from the stored bet_type. */
function marketOf(betType) {
  const b = String(betType || '').toLowerCase();
  if (b.includes('money')) return 'ml';
  if (b.includes('spread') || b.includes('puck') || b.includes('run line')) return 'spread';
  if (b.includes('total') || b.includes('over') || b.includes('under')) return 'total';
  return null;
}

/**
 * Pure: the short side and the matchup for one pick row.
 * "Boston Bruins ML -130" -> { label: 'Bruins ML', matchup: 'Bruins at Sharks' }
 * "Over 6.5" -> { label: 'Over 6.5', matchup: 'Flames at Ducks' }
 */
function labelFor(r) {
  const away = nickname(r.away_team);
  const home = nickname(r.home_team);
  const solo = INDIVIDUAL.has(r.sport);
  const matchup = away && home ? (solo ? `${away} vs ${home}` : `${away} at ${home}`) : null;
  const pick = String(r.pick || '').trim();
  const market = marketOf(r.bet_type);
  if (market === 'total') {
    const m = pick.match(/^(Over|Under)\s+([\d.]+)/i);
    if (!m) return null;
    return { label: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`, matchup };
  }
  for (const team of [r.home_team, r.away_team]) {
    if (team && pick.startsWith(team)) {
      const rest = pick.slice(team.length).trim();
      if (market === 'ml') return { label: `${nickname(team)} ML`, matchup };
      const line = rest.match(/^([+-]?[\d.]+)/);
      if (market === 'spread' && line) return { label: `${nickname(team)} ${line[1]}`, matchup };
    }
  }
  return null;
}

/** Pure: true when the pick's market publishes for its sport. */
function published(flagsBySport, sport, market) {
  if (!market) return false;
  const flags = flagsBySport?.[sport];
  if (!flags) return !CODE_SHADOW_SPORTS.has(sport);
  return flags[market] === 1;
}

/**
 * Pure shaping: published headline picks (strongest first) and traps
 * (most overpriced bait first), interleaved so a trap lands every few
 * plays. Upcoming only. A row that cannot be labeled is dropped.
 */
function shapeTicker(pickRows, trapRows, flagsBySport, now = new Date()) {
  const upcoming = r => new Date(r.game_date).getTime() > now.getTime();
  const shape = (kind) => (r) => {
    const l = labelFor(r);
    if (!l) return null;
    const edge = Number(r.edge_pp);
    return {
      kind,
      sport: r.sport,
      label: l.label,
      matchup: l.matchup,
      tier: r.tier,
      pp: edge,
      game_date: r.game_date,
      ...bookAndOurPct(r),
    };
  };
  const ok = r => upcoming(r) && published(flagsBySport, r.sport, marketOf(r.bet_type));
  const picks = latestPerGame((pickRows || []).filter(r => HEADLINE_SESSION.test(String(r.session_id))))
    .filter(r => ok(r) && Number(r.edge_pp) >= MIN_PP && !['Trap', 'Leg', 'Skip'].includes(r.tier))
    .sort((a, b) => Number(b.edge_pp) - Number(a.edge_pp))
    .map(shape('play')).filter(Boolean).slice(0, MAX_PICKS);
  const traps = latestPerGame((trapRows || []).filter(r => TRAP_SESSION.test(String(r.session_id))))
    .filter(r => ok(r) && Number(r.edge_pp) < 0)
    .sort((a, b) => Number(a.edge_pp) - Number(b.edge_pp))
    .map(shape('trap')).filter(Boolean).slice(0, MAX_TRAPS);
  const items = [];
  let t = 0;
  picks.forEach((p, i) => {
    items.push(p);
    if (i % 2 === 1 && t < traps.length) items.push(traps[t++]);
  });
  while (t < traps.length) items.push(traps[t++]);
  return { items, inSeason: [...new Set(items.map(i => i.sport))] };
}

async function publicTicker(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const supabase = getSupabase();
  if (!supabase) { res.status(500).json({ error: 'Supabase not configured' }); return; }

  try {
    const now = new Date();
    const horizon = new Date(now.getTime() + HORIZON_HOURS * 3600 * 1000).toISOString();
    const cols = 'sport, home_team, away_team, game_date, bet_type, pick, odds, edge_pp, implied_prob, tier, session_id';
    const base = () => supabase
      .from('ai_suggestions')
      .select(cols)
      .eq('actual_outcome', 'pending')
      .is('voided_at', null)
      .gt('game_date', now.toISOString())
      .lt('game_date', horizon);
    const [picksRes, trapsRes, flags] = await Promise.all([
      base().like('session_id', 'auto_digest%').not('tier', 'in', '("Trap","Leg","Skip")').limit(300),
      base().like('session_id', 'auto_digest_trap_%').limit(100),
      publishFlagsAll(supabase),
    ]);
    const err = picksRes.error || trapsRes.error;
    if (err) { res.status(500).json({ error: err.message }); return; }

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.status(200).json(shapeTicker(picksRes.data, trapsRes.data, flags, now));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = publicTicker;
module.exports.shapeTicker = shapeTicker;
module.exports.labelFor = labelFor;
module.exports.nickname = nickname;
