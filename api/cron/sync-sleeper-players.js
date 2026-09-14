/**
 * CRON: Daily snapshot of Sleeper's NFL player feed into nfl_player_status.
 *
 * Owner 2026-09-14: "sleeper feed would be cool" (build_queue 37). One
 * free call with no key returns every NFL player with injury status,
 * body part, notes, practice participation, depth chart position and
 * order, and a news_updated instant, and it moves faster than the
 * official report between filings. Sleeper asks for one full pull a
 * day, so this runs once at 06:30 MT. Rostered players only (a team
 * set), about 2,700 rows.
 *
 * Stored input next to nfl_injury_reports for the practice participation
 * factor (build_queue 35). Nothing here changes a published edge.
 *
 * Endpoint: POST /cron/sync-sleeper-players?secret=...
 * Schedule: daily 12:30 UTC (pg_cron, migration 20260914220000).
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { normalizeAbbr } = require('../../lib/services/nfl-inactives.js');

const SLEEPER_URL = 'https://api.sleeper.app/v1/players/nfl';
const CHUNK = 500;

const clean = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};

/** One Sleeper player object to a table row, or null when not rostered. Pure. */
function mapPlayer(p, syncedAt) {
  if (!p || !p.player_id || !p.team) return null;
  const name = clean(p.full_name) || [clean(p.first_name), clean(p.last_name)].filter(Boolean).join(' ');
  if (!name) return null;
  const order = Number.isFinite(Number(p.depth_chart_order)) && p.depth_chart_order != null ? Number(p.depth_chart_order) : null;
  const newsMs = Number(p.news_updated);
  return {
    sleeper_id: String(p.player_id),
    full_name: name,
    team: normalizeAbbr(p.team),
    position: clean(p.position),
    status: clean(p.status),
    injury_status: clean(p.injury_status),
    injury_body_part: clean(p.injury_body_part),
    injury_notes: clean(p.injury_notes),
    injury_start_date: clean(p.injury_start_date),
    practice_participation: clean(p.practice_participation),
    practice_description: clean(p.practice_description),
    depth_chart_position: clean(p.depth_chart_position),
    depth_chart_order: order,
    espn_id: p.espn_id != null ? String(p.espn_id) : null,
    gsis_id: clean(p.gsis_id),
    news_updated: Number.isFinite(newsMs) && newsMs > 0 ? new Date(newsMs).toISOString() : null,
    synced_at: syncedAt,
  };
}

async function runSync() {
  const startTime = Date.now();
  const syncedAt = new Date(startTime).toISOString();
  const summary = { players_in_feed: 0, rows_mapped: 0, rows_upserted: 0, rows_removed: 0, with_injury_status: 0, errors: [] };
  try {
    const res = await fetch(SLEEPER_URL, { headers: { 'User-Agent': 'TrapHawk/1.0' } });
    if (!res.ok) throw new Error(`sleeper ${res.status}`);
    const feed = await res.json();
    const players = Object.values(feed || {});
    summary.players_in_feed = players.length;
    const rows = players.map(p => mapPlayer(p, syncedAt)).filter(Boolean);
    summary.rows_mapped = rows.length;
    summary.with_injury_status = rows.filter(r => r.injury_status).length;

    if (rows.length > 0) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { error } = await supabase.from('nfl_player_status').upsert(chunk, { onConflict: 'sleeper_id' });
        if (error) {
          summary.errors.push(`chunk ${i}: ${error.message}`);
          if (summary.errors.length >= 3) break;
        } else summary.rows_upserted += chunk.length;
      }
      // Players who left every roster since the last pull drop off.
      if (summary.errors.length === 0) {
        const { data: gone, error } = await supabase
          .from('nfl_player_status').delete().lt('synced_at', syncedAt).select('sleeper_id');
        if (error) summary.errors.push(`prune: ${error.message}`);
        else summary.rows_removed = (gone || []).length;
      }
    }

    await supabase.from('cron_job_logs').insert({
      job_name: 'sync-sleeper-players',
      status: summary.errors.length === 0 && summary.rows_upserted > 0 ? 'completed' : 'partial',
      details: JSON.stringify({ ...summary, errors: summary.errors.slice(0, 5), duration_ms: Date.now() - startTime }),
    });
  } catch (error) {
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: 'sync-sleeper-players', status: 'failed',
        details: JSON.stringify({ error: error.message }),
      });
    } catch { /* best-effort */ }
  }
  return summary;
}

async function syncSleeperPlayers(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.status(202).json({ status: 'accepted', message: 'Sleeper player sync started' });
  runSync().catch(err => console.error('Sleeper sync error:', err.message));
}

module.exports = syncSleeperPlayers;
module.exports.runSync = runSync;
module.exports.mapPlayer = mapPlayer;
