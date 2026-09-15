/**
 * CRON: Sync the official NFL practice report and depth charts from
 * nflverse into nfl_injury_reports and nfl_depth_charts.
 *
 * The practice report (Wednesday through Friday participation plus the
 * Friday designation) is the availability signal the line prices
 * gradually before the ESPN status list catches it, and the depth chart says
 * who steps in. Both are free, maintained releases on the nflverse-data
 * GitHub project, the same source as nfl_player_game_stats. Stored as
 * inputs for the narration context today and for a replayable practice
 * participation factor after the dial freeze (build_queue 11). Nothing
 * here changes a published edge.
 *
 * Directive 14: a file that downloads but writes zero rows logs partial,
 * never completed. A season file that does not exist yet (404) is a
 * graceful skip.
 *
 * Endpoint: POST /cron/sync-nfl-injuries?secret=...&season=2026
 * Schedule: every 6 hours (pg_cron, migration 20260914200000).
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { parseCsv, defaultSeason } = require('./sync-nflverse-player-stats.js');
const { mapInjuryRow, depthChartRows } = require('../../lib/services/nfl-inactives.js');
const { DEPTH_WINDOW_DAYS } = require('../../lib/services/football-injuries.js');

const INJURIES_URL = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${season}.csv`;
const DEPTH_URL = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_${season}.csv`;

const CHUNK = 500;

function rowsAsObjects(text) {
  const parsed = parseCsv(text);
  const header = parsed[0] || [];
  const out = [];
  for (let i = 1; i < parsed.length; i++) {
    const d = {};
    for (let j = 0; j < header.length; j++) d[header[j]] = parsed[i][j];
    out.push(d);
  }
  return out;
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw new Error(`nflverse download ${res.status} for ${url}`);
  return { text: await res.text() };
}

async function upsertChunks(table, rows, onConflict, summary, label) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) {
      summary.errors.push(`${label} chunk ${i}: ${error.message}`);
      if (summary.errors.length >= 3) return;
    } else summary[label].rows_upserted += chunk.length;
  }
}

async function syncInjuries(season, summary) {
  const s = summary.injuries;
  const got = await download(INJURIES_URL(season));
  if (got.missing) { s.status = 'skipped'; s.reason = 'season file not published yet'; return; }
  const raw = rowsAsObjects(got.text);
  s.rows_in_file = raw.length;
  const rows = raw.map(mapInjuryRow).filter(Boolean);
  // Dedupe on the conflict key so one upsert never touches a row twice.
  const byKey = new Map();
  for (const r of rows) byKey.set(`${r.season}|${r.week}|${r.team}|${r.player_key}`, r);
  const unique = [...byKey.values()];
  s.rows_mapped = unique.length;
  if (unique.length === 0) { s.status = 'partial'; s.reason = 'file downloaded, nothing mapped'; return; }
  await upsertChunks('nfl_injury_reports', unique, 'season,week,team,player_key', summary, 'injuries');
  s.weeks = [...new Set(unique.map(r => r.week))].sort((a, b) => a - b);
  s.status = s.rows_upserted > 0 ? 'completed' : 'partial';
}

/**
 * The depth chart release is a snapshot history (518k lines, 49MB on
 * 2026-09-14) and parsing it whole peaked at 627MB of heap. The first
 * two columns are dt and team, so keep, with a cheap slice per line,
 * only the lines at or after sinceIso and parse those. Since 2026-09-15
 * the table holds a rolling DEPTH_WINDOW_DAYS window per club (the
 * depth gate reads each player's best rank over it), and each run
 * keeps only snapshots newer than what is stored.
 */
function recentDepthChartText(text, sinceIso) {
  const lines = text.split(/\r?\n/);
  const header = lines[0] || '';
  const dtOf = (line) => {
    const i1 = line.indexOf(',');
    return i1 < 0 ? null : line.slice(0, i1);
  };
  const kept = [header];
  let newest = null;
  for (let i = 1; i < lines.length; i++) {
    const dt = dtOf(lines[i]);
    if (!dt) continue;
    if (!newest || dt > newest) newest = dt;
    if (!sinceIso || dt >= sinceIso) kept.push(lines[i]);
  }
  return { text: kept.join('\n'), newest, lines_in_file: Math.max(0, lines.filter(l => l !== '').length - 1) };
}
async function syncDepthCharts(season, summary) {
  const s = summary.depth_charts;
  const got = await download(DEPTH_URL(season));
  if (got.missing) { s.status = 'skipped'; s.reason = 'season file not published yet'; return; }
  const windowStart = new Date(Date.now() - DEPTH_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  // Only snapshots newer than the newest stored one are parsed and
  // written, so the six hourly run touches a day of rows, not a month.
  let sinceIso = windowStart;
  const [{ data: maxRow }, { data: minRow }] = await Promise.all([
    supabase.from('nfl_depth_charts').select('snapshot_at').order('snapshot_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('nfl_depth_charts').select('snapshot_at').order('snapshot_at', { ascending: true }).limit(1).maybeSingle(),
  ]);
  const storedNewest = maxRow?.snapshot_at ? new Date(maxRow.snapshot_at).toISOString() : null;
  const storedOldest = minRow?.snapshot_at ? new Date(minRow.snapshot_at).toISOString() : null;
  // Backfill the whole window when the table does not reach back to it
  // (first run after the window shipped, or a gap), otherwise only what
  // is newer than stored.
  const backfillEdge = new Date(Date.now() - (DEPTH_WINDOW_DAYS - 2) * 24 * 3600 * 1000).toISOString();
  const backfill = !storedOldest || storedOldest > backfillEdge;
  if (!backfill && storedNewest && storedNewest > sinceIso) sinceIso = storedNewest.replace(/\.\d{3}Z$/, 'Z');
  const recent = recentDepthChartText(got.text, sinceIso);
  got.text = null;
  s.rows_in_file = recent.lines_in_file;
  s.newest_in_file = recent.newest;
  s.since = sinceIso;
  s.backfill = backfill;
  const rows = depthChartRows(rowsAsObjects(recent.text), sinceIso)
    .filter(r => backfill || !storedNewest || r.snapshot_at > storedNewest);
  s.rows_mapped = rows.length;
  // Roll the window: drop snapshots older than DEPTH_WINDOW_DAYS.
  const { error: delErr } = await supabase.from('nfl_depth_charts').delete().lt('snapshot_at', windowStart);
  if (delErr) summary.errors.push(`depth window delete: ${delErr.message}`);
  if (rows.length === 0) {
    s.status = storedNewest ? 'completed' : 'partial';
    s.reason = storedNewest ? 'no snapshot newer than stored' : 'file downloaded, no snapshot rows';
    return;
  }
  await upsertChunks('nfl_depth_charts', rows, 'team,snapshot_at,pos_grp,pos_abb,pos_slot,pos_rank', summary, 'depth_charts');
  s.teams = new Set(rows.map(r => r.team)).size;
  s.snapshots = new Set(rows.map(r => r.snapshot_at)).size;
  s.newest_snapshot = rows.map(r => r.snapshot_at).sort().pop() || null;
  s.status = s.rows_upserted > 0 ? 'completed' : 'partial';
}

async function runSync(season) {
  const startTime = Date.now();
  const summary = {
    season,
    injuries: { status: 'pending', rows_in_file: 0, rows_mapped: 0, rows_upserted: 0 },
    depth_charts: { status: 'pending', rows_in_file: 0, rows_mapped: 0, rows_upserted: 0 },
    errors: [],
  };
  try {
    try { await syncInjuries(season, summary); }
    catch (e) { summary.injuries.status = 'failed'; summary.errors.push(`injuries: ${e.message}`); }
    try { await syncDepthCharts(season, summary); }
    catch (e) { summary.depth_charts.status = 'failed'; summary.errors.push(`depth_charts: ${e.message}`); }

    const statuses = [summary.injuries.status, summary.depth_charts.status];
    const status = statuses.every(s => s === 'skipped') ? 'skipped'
      : (summary.errors.length === 0 && statuses.every(s => s === 'completed' || s === 'skipped')) ? 'completed'
      : 'partial';
    await supabase.from('cron_job_logs').insert({
      job_name: 'sync-nfl-injuries',
      status,
      details: JSON.stringify({ ...summary, errors: summary.errors.slice(0, 5), duration_ms: Date.now() - startTime }),
    });
  } catch (error) {
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: 'sync-nfl-injuries', status: 'failed',
        details: JSON.stringify({ season, error: error.message }),
      });
    } catch { /* best-effort */ }
  }
  return summary;
}

async function syncNflInjuries(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const season = parseInt(req.query.season, 10) || defaultSeason();
  res.status(202).json({ status: 'accepted', message: `NFL injury report sync started (season ${season})` });
  runSync(season).catch(err => console.error('NFL injury sync error:', err.message));
}

module.exports = syncNflInjuries;
module.exports.runSync = runSync;
module.exports.rowsAsObjects = rowsAsObjects;
module.exports.recentDepthChartText = recentDepthChartText;
