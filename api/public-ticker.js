// Public-ticker endpoint. Serves real edges for the Landing ticker.
//
// The ticker used to scroll a hardcoded demo array labeled LIVE, which showed
// NBA/NFL edges in July. Bettors notice. This returns actual per-side edges
// from game_analysis for the next ~36 hours, plus which leagues currently
// have games, so the Landing can render live numbers for in-season leagues
// and honest coverage status for off-season ones.
//
// Response: {
//   items:    [{ sport, label, pp, tier }],   // strongest signed edges, pos and neg
//   inSeason: ['MLB', ...],                    // leagues with games in the window
// }

const { createClient } = require('@supabase/supabase-js');
const { edgeTier } = require('../lib/services/pick-grader.js');

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// "Los Angeles Dodgers" -> "Dodgers"; "Jannik Sinner" -> "Sinner"
const nickname = (team) => (team || '').trim().split(' ').pop();

function sideLabel(side, g) {
  switch (side) {
    case 'home_ml':     return `${nickname(g.home_team)} ML`;
    case 'away_ml':     return `${nickname(g.away_team)} ML`;
    case 'home_spread': return g.spread != null ? `${nickname(g.home_team)} ${g.spread > 0 ? '+' : ''}${g.spread}` : null;
    case 'away_spread': return g.spread != null ? `${nickname(g.away_team)} ${-g.spread > 0 ? '+' : ''}${-g.spread}` : null;
    case 'over':        return g.total != null ? `O ${g.total}` : null;
    case 'under':       return g.total != null ? `U ${g.total}` : null;
    default:            return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const supabase = getSupabase();
  if (!supabase) { res.status(500).json({ error: 'Supabase not configured' }); return; }

  try {
    const from = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 36 * 3600 * 1000).toISOString();

    const { data: games, error } = await supabase
      .from('game_analysis')
      .select('sport, home_team, away_team, game_date, spread, total, edges')
      .gte('game_date', from)
      .lte('game_date', to)
      .order('game_date', { ascending: true })
      .limit(120);

    if (error) { res.status(500).json({ error: error.message }); return; }

    const inSeason = [...new Set((games || []).map(g => g.sport).filter(Boolean))];

    // One item per game: the strongest-magnitude side, positive or negative.
    // Negative edges are the product's differentiator, so show them.
    const items = [];
    for (const g of games || []) {
      if (!g.edges) continue;
      let best = null;
      for (const [side, val] of Object.entries(g.edges)) {
        if (val == null) continue;
        if (!best || Math.abs(val) > Math.abs(best.val)) best = { side, val };
      }
      if (!best) continue;
      const label = sideLabel(best.side, g);
      if (!label) continue;
      const pp = Math.round(best.val * 1000) / 10;
      items.push({ sport: g.sport, label, pp, tier: edgeTier(pp) });
    }

    // Strongest signals first, then cap the reel.
    items.sort((a, b) => Math.abs(b.pp) - Math.abs(a.pp));

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.status(200).json({ items: items.slice(0, 14), inSeason });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
