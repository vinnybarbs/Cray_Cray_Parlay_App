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

// Strong Play floor. Settled data through July 2026: picks under 7pp ran
// 46-51% win, 10pp+ ran 60-65%. Now that edges are calibrated per market,
// a published pp approximates real excess probability, and 7pp is the
// lowest tier that has actually earned headline billing.
const POD_MIN_PP = 7;
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
      .select('sport, home_team, away_team, game_date, bet_type, pick, odds, edge_pp, tier, model_prob, implied_prob, created_at')
      .eq('generate_mode', 'auto_digest')
      .eq('actual_outcome', 'pending')
      .gt('game_date', new Date().toISOString())
      .gte('edge_pp', POD_MIN_PP)
      .order('created_at', { ascending: false })
      .limit(80);

    if (error) { res.status(500).json({ error: error.message }); return; }

    // Only consider picks from the freshest digest generation. Analyses
    // regenerate every few hours; an older pending pick can carry a bigger
    // edge from a line or model state that no longer exists, and the free
    // tile must match what the current board says.
    let fresh = rows || [];
    if (fresh.length > 0) {
      const newest = new Date(fresh[0].created_at).getTime();
      fresh = fresh.filter(r => newest - new Date(r.created_at).getTime() < 3 * 3600 * 1000);
    }
    fresh.sort((a, b) => Number(b.edge_pp) - Number(a.edge_pp));

    const qualifying = fresh.find(r => {
      if (r.bet_type !== 'Moneyline') return true;
      const n = Number(String(r.odds || '').replace('+', ''));
      return Number.isNaN(n) || n <= POD_MAX_ML_ODDS;
    });

    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600');
    if (!qualifying) {
      res.status(200).json({ quiet: true, pick: null });
      return;
    }

    // "Show the work" payload — the INPUTS the model saw and WHICH signals
    // fired, sanitized. Adjustment magnitudes, weights, and the blend stay
    // server-side; publishing them would hand over the calculator.
    let work = null;
    try {
      const { data: ga } = await supabase
        .from('game_analysis')
        .select('edge_factors')
        .eq('sport', qualifying.sport)
        .eq('home_team', qualifying.home_team)
        .eq('away_team', qualifying.away_team)
        .not('edges', 'is', null)
        .order('generated_at', { ascending: false })
        .limit(1);
      const ef = ga?.[0]?.edge_factors;
      if (ef) {
        // Season record comes from ESPN standings — the authoritative W-L.
        // The 20-game window from game_results is a recency stat and must
        // be labeled as such: publishing it as "Record" showed the White
        // Sox at 9-11 when they were 48-45 (July 2026 credibility bug).
        const teamInputs = (side) => ({
          seasonRecord: ef.standings?.[side]?.record ?? null,
          windowRecord: ef[`${side}Record`] ? `${ef[`${side}Record`].wins}-${ef[`${side}Record`].losses}` : null,
          pointDiffPerGame: ef[`${side}PointDiff`] ?? null,
          last10: ef.standings?.[side]?.last_10 ?? null,
          streak: ef.standings?.[side]?.streak ?? null,
        });
        const signals = Array.isArray(ef.adjustments)
          ? ef.adjustments
              .filter(a => a && a.factor && a.impact != null && a.impact !== 0)
              .slice(0, 6)
              .map(a => ({
                factor: a.factor,
                favors: a.impact > 0 ? qualifying.home_team : qualifying.away_team,
              }))
          : [];
        work = { home: teamInputs('home'), away: teamInputs('away'), signals };
      }
    } catch { /* work section is best-effort */ }

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
      work,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
