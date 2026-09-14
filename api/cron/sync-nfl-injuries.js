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
const { mapInjuryRow, latestDepthChartRows } = require('../../lib/services/nfl-inactives.js');

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
 * two columns are dt and team, so find each team's newest dt with a
 * cheap slice per line and parse only those lines.
 */
function latestDepthChartText(text) {
  const lines = text.split(/\r?\n/);
  const header = lines[0] || '';
  const newest = new Map();
  const dtTeam = (line) => {
    const i1 = line.indexOf(',');
    if (i1 < 0) return null;
    const i2 = line.indexOf(',', i1 + 1);
    if (i2 < 0) return null;
    return [line.slice(0, i1), line.slice(i1 + 1, i2)];
  };
  for (let i = 1; i < lines.length; i++) {
    const p = dtTeam(lines[i]);
    if (!p) continue;
    const prev = newest.get(p[1]);
    if (!prev || p[0] > prev) newest.set(p[1], p[0]);
  }
  const kept = [header];
  for (let i = 1; i < lines.length; i++) {
    const p = dtTeam(lines[i]);
    if (p && newest.get(p[1]) === p[0]) kept.push(lines[i]);
  }
  return { text: kept.join('\n'), lines_in_file: Math.max(0, lines.filter(l => l !== '').length - 1) };
}

async function syncDepthCharts(season, summary) {
  const s = summary.depth_charts;
  const got = await download(DEPTH_URL(season));
  if (got.missing) { s.status = 'skipped'; s.reason = 'season file not published yet'; return; }
  const latest = latestDepthChartText(got.text);
  got.text = null;
  s.rows_in_file = latest.lines_in_file;
  const rows = latestDepthChartRows(rowsAsObjects(latest.text));
  s.rows_mapped = rows.length;
  if (rows.length === 0) { s.status = 'partial'; s.reason = 'file downloaded, no snapshot rows'; return; }
  // Each team's chart is replaced whole: drop the slots the newest
  // snapshot no longer lists, then upsert the snapshot.
  const snapshotByTeam = new Map();
  for (const r of rows) snapshotByTeam.set(r.team, r.snapshot_at);
  for (const [team, snap] of snapshotByTeam) {
    const { error } = await supabase.from('nfl_depth_charts').delete().eq('team', team).lt('snapshot_at', snap);
    if (error) summary.errors.push(`depth delete ${team}: ${error.message}`);
  }
  await upsertChunks('nfl_depth_charts', rows, 'team,pos_grp,pos_abb,pos_slot,pos_rank', summary, 'depth_charts');
  s.teams = snapshotByTeam.size;
  s.newest_snapshot = [...snapshotByTeam.values()].sort().pop() || null;
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
module.exports.latestDepthChartText = latestDepthChartText;
