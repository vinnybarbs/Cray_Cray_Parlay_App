/**
 * CRON: Sync per-player per-game NFL stat lines from nflverse.
 *
 * The settlement truth for player props and the history a prop model
 * trains on. nflverse publishes one CSV per season of weekly player
 * stats (free, maintained, the standard public NFL data source). One
 * endpoint serves both jobs: backfill a finished season on demand and
 * keep the current season fresh in-season (the file updates within a
 * day of games).
 *
 * The season's file does not exist until its games start, and nflverse
 * answers that with a 404 page. That is a graceful skip, not a failure:
 * the weekly schedule can run year round.
 *
 * Endpoint: POST /cron/sync-nflverse-player-stats?secret=...&season=2025
 * Default season: the season whose games are nearest (year, minus one
 * before September, since an NFL season is labeled by its start year).
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { playerKey } = require('../../lib/services/tennis-data.js');

const RELEASE_URL = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;

const CHUNK = 500;

/**
 * Minimal RFC-4180 CSV parser: quoted fields, escaped quotes, commas and
 * newlines inside quotes. Returns array of rows (arrays of strings).
 * nflverse cells include quoted lists, so naive split(',') corrupts rows.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const toNum = (v) => {
  const n = Number(v);
  return v !== '' && Number.isFinite(n) ? n : null;
};

/**
 * Map one nflverse CSV row (as an object) to a table row, or null for
 * rows that cannot settle a prop (no id, no name, or a pure special
 * teams/defense line with no offensive touches, which we skip to keep
 * the table prop-shaped).
 */
function mapStatRow(d) {
  const name = d.player_display_name || d.player_name;
  if (!d.player_id || !name || !d.game_id) return null;
  const row = {
    season: toInt(d.season),
    week: toInt(d.week),
    season_type: d.season_type || 'REG',
    game_id: d.game_id,
    player_id: d.player_id,
    player_name: name,
    player_key: playerKey(name),
    position: d.position || null,
    team: d.team || null,
    opponent: d.opponent_team || null,
    completions: toInt(d.completions),
    attempts: toInt(d.attempts),
    passing_yards: toNum(d.passing_yards),
    passing_tds: toInt(d.passing_tds),
    interceptions: toInt(d.passing_interceptions),
    carries: toInt(d.carries),
    rushing_yards: toNum(d.rushing_yards),
    rushing_tds: toInt(d.rushing_tds),
    receptions: toInt(d.receptions),
    targets: toInt(d.targets),
    receiving_yards: toNum(d.receiving_yards),
    receiving_tds: toInt(d.receiving_tds),
    last_updated: new Date().toISOString(),
  };
  if (row.season == null || row.week == null || !row.player_key) return null;
  const touches = (row.attempts || 0) + (row.carries || 0) + (row.targets || 0)
    + (row.receptions || 0) + (row.completions || 0);
  if (touches === 0) return null;
  return row;
}

function defaultSeason(now = new Date()) {
  // NFL seasons are labeled by their start year and begin in September.
  const y = now.getUTCFullYear();
  return now.getUTCMonth() >= 8 ? y : y - 1;
}

async function runSync(season) {
  const startTime = Date.now();
  const summary = { season, rows_in_file: 0, rows_mapped: 0, rows_upserted: 0, errors: [] };
  try {
    const res = await fetch(RELEASE_URL(season), { redirect: 'follow' });
    if (res.status === 404) {
      await supabase.from('cron_job_logs').insert({
        job_name: 'sync-nflverse-player-stats', status: 'skipped',
        details: JSON.stringify({ season, reason: 'season file not published yet' }),
      });
      return;
    }
    if (!res.ok) throw new Error(`nflverse download ${res.status}`);
    const text = await res.text();

    const parsed = parseCsv(text);
    const header = parsed[0] || [];
    summary.rows_in_file = Math.max(0, parsed.length - 1);
    const rows = [];
    for (let i = 1; i < parsed.length; i++) {
      const d = {};
      for (let j = 0; j < header.length; j++) d[header[j]] = parsed[i][j];
      const mapped = mapStatRow(d);
      if (mapped) rows.push(mapped);
    }
    summary.rows_mapped = rows.length;

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from('nfl_player_game_stats')
        .upsert(chunk, { onConflict: 'game_id,player_id' });
      if (error) {
        summary.errors.push(`chunk ${i}: ${error.message}`);
        if (summary.errors.length >= 3) break;
      } else summary.rows_upserted += chunk.length;
    }

    await supabase.from('cron_job_logs').insert({
      job_name: 'sync-nflverse-player-stats',
      status: summary.errors.length === 0 ? 'completed' : 'partial',
      details: JSON.stringify({ ...summary, duration_ms: Date.now() - startTime }),
    });
  } catch (error) {
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: 'sync-nflverse-player-stats', status: 'failed',
        details: JSON.stringify({ season, error: error.message }),
      });
    } catch { /* best-effort */ }
  }
}

async function syncNflPlayerStats(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const season = toInt(req.query.season) || defaultSeason();
  res.status(202).json({ status: 'accepted', message: `Player stats sync started (season ${season})` });
  runSync(season).catch(err => console.error('Player stats sync error:', err.message));
}

module.exports = syncNflPlayerStats;
module.exports.parseCsv = parseCsv;
module.exports.mapStatRow = mapStatRow;
module.exports.defaultSeason = defaultSeason;
