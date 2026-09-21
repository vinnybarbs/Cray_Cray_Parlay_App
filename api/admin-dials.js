// Admin: the live dial board per market, read only (owner 2026-09-15:
// "link in the admin dashboard to a live dials dashboard for each
// market", "do not allow tweaking dials in the view").
//
// One call returns, for a sport, everything the Edge Anatomy chain reads
// from the database plus the reads it produced in a window: the merged
// dial board (sport row over __all__ row, with the scope that won), the
// flat multipliers, the raw band map, the rails, the publication flags,
// the last weight changes, and every game_analysis row with its factor
// stack, the pick it published and how the shadow ledger graded the
// recommended side. Nothing here writes: dials move only through
// sport_dials and model_weight_changes under the review protocol
// (directives 7, 8, 21).

const { requireAdmin, getSupabase } = require('./admin-dashboard');

const SPORTS = ['MLB', 'NFL', 'NCAAF', 'NBA', 'NHL', 'NCAAB', 'EPL', 'MLS', 'Tennis', 'UFC'];
const PROPS = 'NFL_props';
const RAIL_DIALS = new Set(['chalk_penalty_pp', 'longshot_penalty_pp', 'exposure_guard_pp']);
const PUBLISH_DIALS = new Set(['publish_ml', 'publish_spread', 'publish_total']);
const MATCH_WINDOW_MS = 6 * 3600 * 1000;

/** Sport row over __all__ row, each dial once, with the scope that won. Pure. */
function mergeDials(rows, sport) {
  const out = new Map();
  for (const r of rows || []) {
    if (r.sport !== '__all__' && r.sport !== sport) continue;
    const prev = out.get(r.dial);
    if (!prev || (prev.scope === '__all__' && r.sport === sport)) {
      out.set(r.dial, { dial: r.dial, value: r.value, scope: r.sport, updated_at: r.updated_at });
    }
  }
  return [...out.values()].sort((a, b) => a.dial.localeCompare(b.dial));
}

/** Split the merged board into factor dials, rails and publication flags. Pure. */
function groupDials(merged) {
  const factors = [], rails = [], publish = {};
  for (const d of merged) {
    if (PUBLISH_DIALS.has(d.dial)) publish[d.dial.replace('publish_', '')] = Number(d.value);
    else if (RAIL_DIALS.has(d.dial)) rails.push(d);
    else factors.push(d);
  }
  return { factors, rails, publish };
}

/** Attach each published pick to the read for the same matchup near the same kickoff. Pure. */
function attachPicks(reads, picks) {
  const byRead = new Map();
  for (const p of picks || []) {
    const t = new Date(p.game_date).getTime();
    for (const r of reads || []) {
      if (r.home_team !== p.home_team || r.away_team !== p.away_team) continue;
      if (Math.abs(new Date(r.game_date).getTime() - t) > MATCH_WINDOW_MS) continue;
      if (!byRead.has(r.id)) byRead.set(r.id, []);
      byRead.get(r.id).push(p);
      break;
    }
  }
  return byRead;
}

module.exports = async function adminDials(req, res) {
  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
  const adminUser = await requireAdmin(req, res, supabase);
  if (!adminUser) return;

  const sport = String(req.query.sport || 'MLB');
  if (![...SPORTS, PROPS].includes(sport)) {
    return res.status(400).json({ error: `Unknown market ${sport}`, sports: [...SPORTS, PROPS] });
  }
  const days = Math.max(1, Math.min(14, parseInt(req.query.days, 10) || 2));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const until = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();

  try {
    const dialSport = sport;
    const keyPrefix = sport === PROPS ? 'NFL' : sport;
    const [dialRes, multRes, bandRes, changeRes] = await Promise.all([
      supabase.from('sport_dials').select('sport, dial, value, updated_at').in('sport', ['__all__', dialSport]),
      supabase.from('edge_calibration').select('key, multiplier, measured_k, sample_n, source, updated_at')
        .or(`key.eq.__global__,key.eq.${keyPrefix},key.like.${keyPrefix}:%`),
      supabase.from('bucket_targets').select('sport, band, floor_pp, updated_at')
        .in('sport', ['__all__', keyPrefix]).order('sport').order('floor_pp'),
      supabase.from('model_weight_changes').select('changed_at, sport, component, before, after, reason, source')
        .in('sport', ['__all__', dialSport]).order('changed_at', { ascending: false }).limit(10),
    ]);
    const merged = mergeDials(dialRes.data || [], dialSport);
    const grouped = groupDials(merged);

    const payload = {
      sport, sports: SPORTS, props: PROPS, days,
      dials: grouped.factors, rails: grouped.rails, publish: grouped.publish,
      multipliers: multRes.data || [], bucketTargets: bandRes.data || [], weightChanges: changeRes.data || [],
      errors: [dialRes.error, multRes.error, bandRes.error, changeRes.error].filter(Boolean).map(e => e.message),
      fetched_at: new Date().toISOString(),
    };

    if (sport === PROPS) {
      const { data, error } = await supabase.from('prop_reads')
        .select('id, event_id, commence_time, home_team, away_team, week, market, player_name, line, side, anchor_prob, model_prob, damped_prob, model_mean, model_sigma, games_used, edge_pp, tier, books, best_book, best_price, actual_value, actual_outcome, v2_side, v2_edge_pp, v2_tier, v2_outcome, v2_factors, factors')
        .gte('commence_time', since).lte('commence_time', until)
        .order('commence_time', { ascending: true }).order('edge_pp', { ascending: false }).limit(300);
      if (error) payload.errors.push(error.message);
      payload.propReads = data || [];
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(payload);
    }

    const { data: reads, error: readErr } = await supabase.from('game_analysis')
      .select('id, game_key, home_team, away_team, game_date, analysis_version, generated_at, model_used, implied_home_prob, calc_home_prob, edges_raw, edges, edge_factors, recommended_pick, recommended_side, recommended_odds, trap_calls')
      .eq('sport', sport).gte('game_date', since).lte('game_date', until)
      .order('game_date', { ascending: true }).limit(80);
    if (readErr) payload.errors.push(readErr.message);
    const readRows = reads || [];
    const ids = readRows.map(r => r.id);

    const [pickRes, shadowRes] = await Promise.all([
      supabase.from('ai_suggestions')
        .select('id, home_team, away_team, game_date, session_id, tier, bet_type, pick, odds, edge_pp, edge_pp_raw, actual_outcome, tier_history')
        .eq('sport', sport).like('session_id', 'auto_digest%').is('voided_at', null)
        .gte('game_date', since).lte('game_date', until).limit(400),
      ids.length ? supabase.from('shadow_reads_graded')
        .select('analysis_id, market, side, side_name, raw_pp, cal_pp, point, price, outcome, units, price_clv_pp, close_price, close_point, home_score, away_score')
        .in('analysis_id', ids) : Promise.resolve({ data: [] }),
    ]);
    if (pickRes.error) payload.errors.push(pickRes.error.message);
    if (shadowRes.error) payload.errors.push(shadowRes.error.message);

    const picksByRead = attachPicks(readRows, pickRes.data || []);
    const shadowByRead = new Map();
    for (const s of shadowRes.data || []) {
      if (!shadowByRead.has(s.analysis_id)) shadowByRead.set(s.analysis_id, []);
      shadowByRead.get(s.analysis_id).push(s);
    }
    payload.reads = readRows.map(r => ({
      ...r,
      picks: picksByRead.get(r.id) || [],
      shadow: shadowByRead.get(r.id) || [],
    }));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports.mergeDials = mergeDials;
module.exports.groupDials = groupDials;
module.exports.attachPicks = attachPicks;
module.exports.SPORTS = SPORTS;
