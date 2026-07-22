// Public-stats endpoint. Proxies mv_public_record (the ledger-population
// rollup: graded era, actionable tiers, no soccer v1) to the Landing without
// requiring auth, so the Track Record section + hero hit-rate render for
// unauthenticated visitors. Uses the service role key server-side so RLS
// can stay strict on the underlying table (anon SELECT remains blocked).
//
// Response shape: { overall: {wins,losses,push,total,hitRate}, tiers: [...] }
// All fields safe to expose publicly, just aggregate W/L/% per tier.

const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

module.exports = async (req, res) => {
  // CORS: Landing is served from the same origin in production but local
  // dev runs on a different port. Be permissive for GET reads.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    res.status(500).json({ error: 'Supabase not configured' });
    return;
  }

  try {
    const { data: rows, error } = await supabase
      .from('mv_public_record')
      .select('*')
      .in('period_bucket', ['last_30d', 'all']);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const allRows = (rows || []).filter(r => r.period_bucket === 'all');

    const rows30 = (rows || []).filter(r => r.period_bucket === 'last_30d');
    const overallRow = rows30.find(r => r.dimension_type === 'overall');
    const sportRows = rows30.filter(r => r.dimension_type === 'sport');
    const tierRows = rows30.filter(r => r.dimension_type === 'tier');

    const overall = overallRow ? (() => {
      const wins = overallRow.won || 0;
      const losses = overallRow.lost || 0;
      const push = overallRow.push || 0;
      const decided = wins + losses;
      return {
        total: wins + losses + push,
        wins,
        losses,
        push,
        hitRate: decided > 0 ? Math.round((wins / decided) * 1000) / 10 : null,
      };
    })() : null;

    const shape = (rows, key) => rows.map(r => {
      const wins = r.won || 0;
      const losses = r.lost || 0;
      const decided = wins + losses;
      return {
        [key]: r.dimension_value,
        wins,
        losses,
        hitRate: decided > 0 ? ((wins / decided) * 100).toFixed(1) : null,
      };
    });

    const bySport = shape(sportRows, 'sport');
    const tiers = shape(tierRows, 'tier');

    // The hero claim: Sharp Take all-time record with ROI. Only published
    // when the sample is real (100+ decided picks). The number itself is
    // whatever the ledger says, good or bad. That is the brand.
    const stRow = allRows.find(r => r.dimension_type === 'tier' && r.dimension_value === 'Sharp Take');
    let sharpTakeAllTime = null;
    if (stRow && (stRow.won + stRow.lost) >= 100) {
      const decided = stRow.won + stRow.lost;
      sharpTakeAllTime = {
        wins: stRow.won,
        losses: stRow.lost,
        hitRate: Math.round((stRow.won / decided) * 1000) / 10,
        // Same math as the House Ledger: units profit over decided 1u stakes.
        roiPct: stRow.roi_units != null && decided > 0
          ? Math.round((Number(stRow.roi_units) / decided) * 1000) / 10
          : null,
      };
    }

    // Cache 5 minutes at the CDN edge; the MV refreshes after settlements.
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.status(200).json({ overall, bySport, tiers, sharpTakeAllTime });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
