/**
 * Red zone and goal line usage from nflverse play by play.
 *
 * The anytime TD model needs who gets the ball near the end zone, which
 * the weekly stat lines do not carry. nflverse publishes one gzipped
 * play by play CSV per season (about 20 MB, around 370 columns). This
 * module streams it and keeps only per player per game counts:
 *
 *   rz_carries   rushes from the opponent 20 or closer
 *   gl_carries   rushes from the 5 or closer
 *   rz_targets   targets from the 20 or closer (sacks excluded)
 *   ez_targets   red zone targets thrown to or past the goal line
 *   rush_tds, rec_tds  touchdowns scored on those plays
 *
 * plus the team totals for the same game (team_rz_carries and
 * team_rz_targets) so a share can be read without a second query.
 * Two point tries are excluded. Pure except for the CSV stream reader.
 */

'use strict';

const WANT = ['game_id', 'season', 'season_type', 'week', 'posteam', 'yardline_100', 'rush_attempt', 'pass_attempt',
  'sack', 'two_point_attempt', 'rusher_player_id', 'receiver_player_id', 'air_yards', 'touchdown', 'td_player_id'];

/**
 * Incremental RFC 4180 CSV reader. push(chunk) feeds text, each complete
 * row goes to onRow as an array of strings, end() flushes the tail.
 */
function csvStream(onRow) {
  let row = [], field = '', inQuotes = false, pendingQuote = false, pendingCr = false;
  function emit() {
    row.push(field); field = '';
    if (row.length > 1 || row[0] !== '') onRow(row);
    row = [];
  }
  return {
    push(text) {
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (pendingCr) { pendingCr = false; if (c === '\n') continue; }
        if (pendingQuote) {
          pendingQuote = false;
          if (c === '"') { field += '"'; continue; }
          inQuotes = false;
        }
        if (inQuotes) {
          if (c === '"') pendingQuote = true; else field += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') emit();
        else if (c === '\r') { emit(); pendingCr = true; }
        else field += c;
      }
    },
    end() {
      if (pendingQuote) { pendingQuote = false; inQuotes = false; }
      if (field !== '' || row.length > 0) emit();
    },
  };
}

const num = (v) => { const n = Number(v); return v !== '' && v != null && v !== 'NA' && Number.isFinite(n) ? n : null; };

/**
 * Accumulator over play objects (only the WANT keys are read). add(play)
 * per play, rows() returns one row per (game_id, player_id) with any red
 * zone usage. Pure.
 */
function redzoneAccumulator() {
  const players = new Map();
  const teams = new Map();
  const player = (p, id) => {
    const key = `${p.game_id}|${id}`;
    if (!players.has(key)) {
      players.set(key, { game_id: p.game_id, player_id: id, season: num(p.season), week: num(p.week),
        season_type: p.season_type || 'REG', team: p.posteam || null,
        rz_carries: 0, gl_carries: 0, rz_targets: 0, ez_targets: 0, rz_rush_tds: 0, rz_rec_tds: 0 });
    }
    return players.get(key);
  };
  const team = (p) => {
    const key = `${p.game_id}|${p.posteam}`;
    if (!teams.has(key)) teams.set(key, { carries: 0, targets: 0 });
    return teams.get(key);
  };
  return {
    add(p) {
      const yl = num(p.yardline_100);
      if (yl == null || yl > 20 || !p.game_id || !p.posteam) return;
      if (num(p.two_point_attempt) === 1) return;
      const td = num(p.touchdown) === 1;
      if (num(p.rush_attempt) === 1 && p.rusher_player_id && p.rusher_player_id !== 'NA') {
        const r = player(p, p.rusher_player_id);
        r.rz_carries++;
        if (yl <= 5) r.gl_carries++;
        if (td && p.td_player_id === p.rusher_player_id) r.rz_rush_tds++;
        team(p).carries++;
      } else if (num(p.pass_attempt) === 1 && num(p.sack) !== 1 && p.receiver_player_id && p.receiver_player_id !== 'NA') {
        const r = player(p, p.receiver_player_id);
        r.rz_targets++;
        const air = num(p.air_yards);
        if (air != null && air >= yl) r.ez_targets++;
        if (td && p.td_player_id === p.receiver_player_id) r.rz_rec_tds++;
        team(p).targets++;
      }
    },
    rows() {
      return [...players.values()].map(r => {
        const t = teams.get(`${r.game_id}|${r.team}`) || { carries: 0, targets: 0 };
        return { ...r, team_rz_carries: t.carries, team_rz_targets: t.targets };
      });
    },
  };
}

/**
 * Stream a gzipped play by play CSV body (a web ReadableStream or a Node
 * Readable) through the accumulator. Returns { plays, rows }.
 */
async function aggregateGzipStream(body) {
  const zlib = require('zlib');
  const { Readable } = require('stream');
  const acc = redzoneAccumulator();
  let header = null, idx = null, plays = 0;
  const reader = csvStream((cells) => {
    if (!header) {
      header = cells;
      idx = Object.fromEntries(WANT.map(k => [k, header.indexOf(k)]));
      return;
    }
    plays++;
    const p = {};
    for (const k of WANT) p[k] = idx[k] >= 0 ? cells[idx[k]] : null;
    acc.add(p);
  });
  const src = typeof body.getReader === 'function' ? Readable.fromWeb(body) : body;
  const gunzip = src.pipe(zlib.createGunzip());
  gunzip.setEncoding('utf8');
  for await (const chunk of gunzip) reader.push(chunk);
  reader.end();
  return { plays, rows: acc.rows() };
}

module.exports = { WANT, csvStream, redzoneAccumulator, aggregateGzipStream };
