/**
 * CRON: NFL player prop reads, shadow first. Publishes nothing.
 *
 * Reads the synced props (player_props), builds a consensus per player
 * and market, prices it off the player's own game log
 * (nfl_player_game_stats) through lib/services/prop-edge.js with every
 * weight from the NFL_props dial board, and stores one row per prop in
 * prop_reads. ?mode=grade settles past reads against the nflverse stat
 * lines once they land (Tuesdays). The weekly review judges the record;
 * nothing here reaches ai_suggestions, the digest, or alerts.
 *
 * Endpoints:
 *   POST /cron/analyze-nfl-props?secret=...            (read, default)
 *   POST /cron/analyze-nfl-props?secret=...&mode=grade (settle)
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const propEdge = require('../../lib/services/prop-edge.js');
const { edgeTier } = require('../../lib/services/pick-grader.js');

const SPORT = 'NFL';
const DIAL_SPORT = 'NFL_props';
const WINDOW_HOURS = 24 * 4;

async function loadDials() {
  const dials = { ...propEdge.DIAL_DEFAULTS };
  try {
    const { data } = await supabase.from('sport_dials').select('sport, dial, value').in('sport', ['__all__', DIAL_SPORT]);
    const rows = Array.isArray(data) ? data : [];
    for (const scope of ['__all__', DIAL_SPORT]) {
      for (const r of rows) {
        if (r.sport === scope && r.dial in dials && Number.isFinite(Number(r.value))) dials[r.dial] = Number(r.value);
      }
    }
  } catch { /* defaults */ }
  return dials;
}

async function log(status, details) {
  try {
    await supabase.from('cron_job_logs').insert({ job_name: 'analyze-nfl-props', status, details: JSON.stringify(details) });
  } catch { /* best effort */ }
}

async function runRead() {
  const started = Date.now();
  const summary = { props: 0, groups: 0, read: 0, no_history: 0, not_modeled: 0, no_consensus: 0, upserted: 0, errors: [] };
  const dials = await loadDials();
  const now = new Date();
  const horizon = new Date(now.getTime() + WINDOW_HOURS * 3600 * 1000);

  const { data: props, error } = await supabase
    .from('player_props')
    .select('event_id, commence_time, home_team, away_team, market, player_name, player_key, line, over_price, under_price, yes_price, bookmaker')
    .eq('sport', SPORT)
    .gt('commence_time', now.toISOString())
    .lt('commence_time', horizon.toISOString());
  if (error) throw error;
  summary.props = (props || []).length;

  // Group by event, market, player.
  const groups = new Map();
  for (const p of props || []) {
    const k = `${p.event_id}|${p.market}|${p.player_key}`;
    if (!groups.has(k)) groups.set(k, { meta: p, rows: [] });
    groups.get(k).rows.push(p);
  }
  summary.groups = groups.size;

  // One history fetch per player.
  const playerKeys = [...new Set([...groups.values()].map(g => g.meta.player_key))];
  const history = new Map();
  for (let i = 0; i < playerKeys.length; i += 100) {
    const slice = playerKeys.slice(i, i + 100);
    const { data } = await supabase
      .from('nfl_player_game_stats')
      .select('player_key, season, week, season_type, passing_yards, passing_tds, rushing_yards, receiving_yards, receptions')
      .in('player_key', slice)
      .order('season', { ascending: false })
      .order('week', { ascending: false });
    for (const r of data || []) {
      if (!history.has(r.player_key)) history.set(r.player_key, []);
      history.get(r.player_key).push(r);
    }
  }

  const out = [];
  for (const { meta, rows } of groups.values()) {
    if (!(meta.market in propEdge.STAT_COLUMN)) { summary.not_modeled++; continue; }
    const consensus = propEdge.consensusFromBooks(rows);
    if (!consensus) { summary.no_consensus++; continue; }
    const baseline = propEdge.playerBaseline(history.get(meta.player_key) || [], meta.market, dials);
    if (!baseline) { summary.no_history++; continue; }
    const read = propEdge.propRead({
      line: consensus.line, anchorOverProb: consensus.overProb,
      mean: baseline.mean, sigma: baseline.sigma, games: baseline.games,
    }, dials);
    if (!read) { summary.no_consensus++; continue; }
    const wk = propEdge.nflWeekFor(meta.commence_time);
    out.push({
      sport: SPORT,
      event_id: meta.event_id,
      commence_time: meta.commence_time,
      home_team: meta.home_team,
      away_team: meta.away_team,
      season: wk ? wk.season : null,
      week: wk ? wk.week : null,
      market: meta.market,
      player_key: meta.player_key,
      player_name: meta.player_name,
      line: consensus.line,
      side: read.side,
      anchor_prob: Math.round(read.anchorProb * 10000) / 10000,
      model_prob: Math.round(read.modelProb * 10000) / 10000,
      damped_prob: Math.round(read.dampedProb * 10000) / 10000,
      model_mean: Math.round(baseline.mean * 100) / 100,
      model_sigma: Math.round(baseline.sigma * 100) / 100,
      games_used: baseline.games,
      confidence: Math.round(read.confidence * 1000) / 1000,
      edge_pp: read.edgePp,
      tier: edgeTier(read.edgePp),
      books: consensus.books,
      consensus_over_price: consensus.overPrice,
      consensus_under_price: consensus.underPrice,
      best_book: consensus.best[read.side].book,
      best_line: consensus.best[read.side].line,
      best_price: consensus.best[read.side].price,
      dials,
      factors: {
        recent_mean: Math.round(baseline.recentMean * 100) / 100,
        long_mean: Math.round(baseline.longMean * 100) / 100,
        books_at_line: consensus.atLine,
      },
      status: 'shadow',
      updated_at: new Date().toISOString(),
    });
    summary.read++;
  }

  for (let i = 0; i < out.length; i += 200) {
    const { error: upErr } = await supabase.from('prop_reads').upsert(out.slice(i, i + 200), { onConflict: 'event_id,market,player_key' });
    if (upErr) summary.errors.push(upErr.message); else summary.upserted += Math.min(200, out.length - i);
  }
  summary.tiers = out.reduce((acc, r) => { acc[r.tier] = (acc[r.tier] || 0) + 1; return acc; }, {});
  summary.dials = dials;
  summary.duration_ms = Date.now() - started;
  await log(summary.errors.length ? 'partial' : 'completed', summary);
  return summary;
}

async function runGrade() {
  const started = Date.now();
  const summary = { pending: 0, graded: 0, won: 0, lost: 0, push: 0, no_stat: 0, errors: [] };
  const { data: pending, error } = await supabase
    .from('prop_reads')
    .select('id, player_key, season, week, market, line, side')
    .eq('actual_outcome', 'pending')
    .lt('commence_time', new Date(Date.now() - 4 * 3600 * 1000).toISOString())
    .not('season', 'is', null);
  if (error) throw error;
  summary.pending = (pending || []).length;
  if (summary.pending === 0) { await log('completed', { ...summary, duration_ms: Date.now() - started }); return summary; }

  const keys = [...new Set(pending.map(p => p.player_key))];
  const seasons = [...new Set(pending.map(p => p.season))];
  const stats = new Map();
  for (let i = 0; i < keys.length; i += 100) {
    const { data } = await supabase
      .from('nfl_player_game_stats')
      .select('player_key, season, week, passing_yards, passing_tds, rushing_yards, receiving_yards, receptions')
      .in('player_key', keys.slice(i, i + 100))
      .in('season', seasons);
    for (const r of data || []) stats.set(`${r.player_key}|${r.season}|${r.week}`, r);
  }
  for (const p of pending) {
    const row = stats.get(`${p.player_key}|${p.season}|${p.week}`);
    if (!row) { summary.no_stat++; continue; }
    const actual = row[propEdge.STAT_COLUMN[p.market]];
    const outcome = propEdge.gradeRead(p.side, p.line, actual);
    if (!outcome) { summary.no_stat++; continue; }
    const { error: upErr } = await supabase.from('prop_reads')
      .update({ actual_value: actual, actual_outcome: outcome, graded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', p.id);
    if (upErr) { summary.errors.push(upErr.message); continue; }
    summary.graded++;
    summary[outcome]++;
  }
  summary.duration_ms = Date.now() - started;
  await log(summary.errors.length ? 'partial' : 'completed', summary);
  return summary;
}

async function analyzeNflProps(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const mode = req.query.mode === 'grade' ? 'grade' : 'read';
  res.status(202).json({ status: 'accepted', message: `NFL props ${mode} started` });
  (async () => {
    try {
      if (mode === 'grade') await runGrade(); else await runRead();
    } catch (err) {
      console.error('analyze-nfl-props error:', err.message);
      await log('failed', { mode, error: err.message });
    }
  })();
}

module.exports = analyzeNflProps;
module.exports.runRead = runRead;
module.exports.runGrade = runGrade;
