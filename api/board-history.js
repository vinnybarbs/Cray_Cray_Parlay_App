// Yesterday's board: the full published pick list for a prior digest day,
// with settled outcomes. Public and read-only, same receipts philosophy as
// the House Ledger: on dark-slate days the board shows what the machine
// published yesterday and how it actually went, instead of a blank page.

const { supabase } = require('../lib/middleware/supabaseAuth.js');

// Same 1u math as the House Ledger. The two surfaces must never disagree.
function unitProfit(oddsStr, outcome) {
  if (outcome === 'push' || outcome === 'void') return 0;
  if (outcome === 'lost') return -1;
  if (outcome !== 'won') return 0;
  const price = parseInt(oddsStr, 10);
  if (Number.isNaN(price) || price === 0) return 0;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

module.exports = async function boardHistory(req, res) {
  try {
    // Default: the most recent digest day that actually published picks
    // (searching today backward). On a dark-slate evening that's usually
    // today's settled board; on a dark Monday it's Sunday's. Session ids
    // are keyed on the UTC date.
    const requested = String(req.query.date || '').trim();
    let date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : null;
    if (!date) {
      // Session ids sort lexically as dates, so one query finds the newest
      // day with picks (was 8 serial count queries, slow enough that the
      // button felt dead).
      const candidates = Array.from({ length: 8 }, (_, i) =>
        `auto_digest_${new Date(Date.now() - i * 24 * 3600e3).toISOString().split('T')[0]}`);
      const { data: latest } = await supabase
        .from('ai_suggestions')
        .select('session_id')
        .in('session_id', candidates)
        .order('session_id', { ascending: false })
        .limit(1);
      date = latest?.[0]?.session_id?.replace('auto_digest_', '')
        || new Date(Date.now() - 24 * 3600e3).toISOString().split('T')[0];
    }

    const { data, error } = await supabase
      .from('ai_suggestions')
      .select('sport, home_team, away_team, game_date, bet_type, pick, odds, edge_pp, tier, actual_outcome, reasoning, created_at')
      .eq('session_id', `auto_digest_${date}`)
      .order('edge_pp', { ascending: false, nullsFirst: false });

    if (error) throw error;

    const all = data || [];
    // Traps are fade advice, not bets. Split them out so the day's record
    // only counts picks, and the fade calls get their own honest framing
    // (the trap side losing = the call was right).
    const SOCCER_SPORTS = new Set(['EPL', 'MLS', 'Soccer', 'World Cup', 'Champions League', 'Copa America', 'Euros']);
    const nonSoccer = all.filter(p => !SOCCER_SPORTS.has(p.sport));
    const picks = nonSoccer.filter(p => p.tier !== 'Trap' && p.tier !== 'Skip');
    const traps = nonSoccer.filter(p => p.tier === 'Trap');

    const summary = { total: picks.length, won: 0, lost: 0, push: 0, pending: 0, units: 0 };
    for (const p of picks) {
      if (p.actual_outcome === 'won') summary.won++;
      else if (p.actual_outcome === 'lost') summary.lost++;
      else if (p.actual_outcome === 'push' || p.actual_outcome === 'void') summary.push++;
      else summary.pending++;
      summary.units += unitProfit(p.odds, p.actual_outcome);
    }
    summary.units = Math.round(summary.units * 100) / 100;
    const settled = summary.won + summary.lost;
    summary.winRate = settled > 0 ? Math.round((summary.won / settled) * 1000) / 10 : null;

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ date, summary, picks, traps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
