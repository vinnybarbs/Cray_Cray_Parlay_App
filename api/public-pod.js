// Public Pick-of-the-Day endpoint — the real free pick for the Landing.
//
// The Landing's "SEE TODAY'S FREE PICK" CTA used to scroll to a hardcoded
// illustrative tile. The competitor research (competitor-profiles/_summary.md)
// called a real free-value moment the conversion wedge, so serve the actual
// highest-edge upcoming pick. One pick only — the full board stays paid.
//
// Selection mirrors DailyDigest.pickOfTheDay: highest signed pp that clears
// the Play tier (>= 4pp). Below that we say so instead of forcing a pick —
// "quiet day" is part of the brand (docs/marketing/landing-page-v1.md).

const { createClient } = require('@supabase/supabase-js');

const POD_MIN_PP = 4;
// Longshot fence (restores the POD_MAX_ML_ODDS guard): a +2500 tennis
// moneyline is not a credible headline pick even when the math likes it.
const POD_MAX_ML_ODDS = 300;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const supabase = getSupabase();
  if (!supabase) { res.status(500).json({ error: 'Supabase not configured' }); return; }

  try {
    const { data: rows, error } = await supabase
      .from('ai_suggestions')
      .select('sport, home_team, away_team, game_date, bet_type, pick, odds, edge_pp, tier, model_prob, implied_prob')
      .eq('generate_mode', 'auto_digest')
      .eq('actual_outcome', 'pending')
      .gt('game_date', new Date().toISOString())
      .gte('edge_pp', POD_MIN_PP)
      .order('edge_pp', { ascending: false })
      .limit(10);

    if (error) { res.status(500).json({ error: error.message }); return; }

    const qualifying = (rows || []).find(r => {
      if (r.bet_type !== 'Moneyline') return true;
      const n = Number(String(r.odds || '').replace('+', ''));
      return Number.isNaN(n) || n <= POD_MAX_ML_ODDS;
    });

    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600');
    if (!qualifying) {
      res.status(200).json({ quiet: true, pick: null });
      return;
    }

    res.status(200).json({
      quiet: false,
      pick: {
        sport: qualifying.sport,
        homeTeam: qualifying.home_team,
        awayTeam: qualifying.away_team,
        gameDate: qualifying.game_date,
        betType: qualifying.bet_type,
        pick: qualifying.pick,
        edgePp: qualifying.edge_pp != null ? Number(qualifying.edge_pp) : null,
        tier: qualifying.tier,
        modelProb: qualifying.model_prob != null ? Number(qualifying.model_prob) : null,
        impliedProb: qualifying.implied_prob != null ? Number(qualifying.implied_prob) : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
