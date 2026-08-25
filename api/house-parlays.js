// House parlays for the digest's parlay view. Public and read-only,
// same receipts philosophy as Yesterday's Board: today's machine-built
// parlays when they exist, else the most recent built day inside a week,
// plus the running settled record the 70 percent hit goal is judged on.

const { supabase } = require('../lib/middleware/supabaseAuth.js');
const { siteDay, siteDayOffset } = require('../shared/site-day.js');

module.exports = async function houseParlays(req, res) {
  try {
    const today = siteDay();
    const { data: recent, error } = await supabase
      .from('house_parlays')
      .select('id, parlay_date, legs_count, legs, combined_odds, model_win_prob, fair_win_prob, status, settled_at')
      .gte('parlay_date', siteDayOffset(-7))
      .order('parlay_date', { ascending: false })
      .order('legs_count', { ascending: true });
    if (error) throw error;

    const rows = recent || [];
    const day = rows.some(r => r.parlay_date === today)
      ? today
      : (rows[0]?.parlay_date || today);
    const parlays = rows.filter(r => r.parlay_date === day);

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
