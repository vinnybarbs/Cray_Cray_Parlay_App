// House parlays for the digest's parlay view. Public and read-only.
// TODAY'S OPEN TICKETS ONLY (owner call 2026-08-26): the digest is the
// live board, so it never re-shows a settled ticket. The full parlay
// history, wins and losses alike, lives on the House Ledger. The
// running record line stays here because the 70 percent hit goal is
// judged in public.

const { supabase } = require('../lib/middleware/supabaseAuth.js');
const { siteDay } = require('../shared/site-day.js');
const { enrichParlayLegOutcomes } = require('../lib/services/parlay-leg-outcomes.js');

module.exports = async function houseParlays(req, res) {
  try {
    const today = siteDay();
    const { data: rows, error } = await supabase
      .from('house_parlays')
      .select('id, parlay_date, legs_count, legs, combined_odds, model_win_prob, fair_win_prob, status, settled_at')
      .eq('parlay_date', today)
      .eq('status', 'pending')
      .order('legs_count', { ascending: true });
    if (error) throw error;

    const day = today;
    const parlays = await enrichParlayLegOutcomes(supabase, rows || []);

    const { data: settledRows, error: recErr } = await supabase
      .from('house_parlays')
      .select('status')
      .in('status', ['won', 'lost']);
    if (recErr) throw recErr;
    let won = 0, lost = 0;
    for (const r of settledRows || []) {
      if (r.status === 'won') won++; else lost++;
    }
    const settled = won + lost;
    const record = {
      won,
      lost,
      hitRate: settled > 0 ? Math.round((won / settled) * 1000) / 10 : null,
    };

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ date: day, isToday: day === today, parlays, record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
