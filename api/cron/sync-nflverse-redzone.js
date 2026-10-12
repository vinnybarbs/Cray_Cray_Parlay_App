/**
 * CRON: Sync per player per game red zone usage from nflverse play by
 * play into nfl_player_redzone, the input the anytime TD read prices
 * from (lib/services/nfl-redzone.js aggregates, prop-edge TD_RATES
 * converts). The season file is a gzipped CSV of about 20 MB that
 * nflverse refreshes nightly in season, streamed so the whole file never
 * sits in memory.
 *
 * Each run syncs the current season and backfills the previous one when
 * the table has none of it yet (the history a TD read looks back over).
 * A season file that does not exist yet (404) is a graceful skip.
 *
 * Endpoint: POST /cron/sync-nflverse-redzone?secret=...&season=2026
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { aggregateGzipStream } = require('../../lib/services/nfl-redzone.js');
const { defaultSeason } = require('./sync-nflverse-player-stats.js');

const PBP_URL = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;
const CHUNK = 500;
const JOB = 'sync-nflverse-redzone';

async function syncSeason(season) {
  const res = await fetch(PBP_URL(season), { redirect: 'follow' });
  if (res.status === 404) return { season, skipped: 'season file not published yet' };
  if (!res.ok || !res.body) throw new Error(`nflverse pbp download ${res.status}`);
  const { plays, rows } = await aggregateGzipStream(res.body);
  const out = { season, plays, rows: rows.length, upserted: 0, errors: [] };
  const stamped = rows.map(r => ({ ...r, updated_at: new Date().toISOString() }));
  for (let i = 0; i < stamped.length; i += CHUNK) {
    const { error } = await supabase.from('nfl_player_redzone').upsert(stamped.slice(i, i + CHUNK), { onConflict: 'game_id,player_id' });
    if (error) { out.errors.push(error.message); if (out.errors.length >= 3) break; } else out.upserted += Math.min(CHUNK, stamped.length - i);
  }
  return out;
}

async function runSync(season) {
  const started = Date.now();
  const summary = { seasons: [] };
  let status = 'completed';
  try {
    const { count } = await supabase.from('nfl_player_redzone').select('game_id', { count: 'exact', head: true }).eq('season', season - 1);
    const seasons = (count || 0) > 0 ? [season] : [season - 1, season];
    for (const s of seasons) {
      const r = await syncSeason(s);
      summary.seasons.push(r);
      if (r.errors && r.errors.length) status = 'partial';
    }
    if (summary.seasons.every(r => r.skipped)) status = 'skipped';
  } catch (err) {
    status = 'failed';
    summary.error = err.message;
  }
  summary.duration_ms = Date.now() - started;
  try {
    await supabase.from('cron_job_logs').insert({ job_name: JOB, status, details: JSON.stringify(summary) });
  } catch { /* best effort */ }
  return summary;
}

async function syncNflverseRedzone(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const season = parseInt(req.query.season, 10) || defaultSeason();
  res.status(202).json({ status: 'accepted', message: `Red zone sync started (season ${season})` });
  runSync(season).catch(err => console.error('Red zone sync error:', err.message));
}

module.exports = syncNflverseRedzone;
module.exports.runSync = runSync;
