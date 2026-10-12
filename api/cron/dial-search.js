/**
 * CRON (weekly, and on demand): the two stage dial search.
 *
 * POST /cron/dial-search?secret=...&sports=NFL,NHL,NCAAF,MLB&recent_days=7&confirm_days=60&apply=1
 *
 * For each sport, lib/replay/dial-search.js searches last week for the
 * dial moves that would have made it more profitable, replays the best of
 * them over the weeks before it, and files the ones that pass the three
 * tests to build_queue. One cron_job_logs row per sport (job_name
 * dial-search). It never writes a dial.
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { runDialSearch } = require('../../lib/replay/dial-search.js');

const ALLOWED = new Set(['MLB', 'NFL', 'NCAAF', 'NHL', 'NBA', 'NCAAB']);

function parseSports(text) {
  return String(text || '').split(',').map(s => s.trim().toUpperCase()).filter(s => ALLOWED.has(s));
}

async function dialSearch(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const sports = parseSports(req.query.sports || req.query.sport);
  if (!sports.length) return res.status(400).json({ error: 'sports= is required, for example sports=NFL,NHL' });
  const recentDays = Math.min(14, Math.max(3, parseInt(req.query.recent_days, 10) || 7));
  const confirmDays = Math.min(120, Math.max(14, parseInt(req.query.confirm_days, 10) || 60));
  const minDelta = Number.isFinite(Number(req.query.min_delta)) && req.query.min_delta !== undefined ? Number(req.query.min_delta) : 0.5;
  const top = Math.min(6, Math.max(1, parseInt(req.query.top, 10) || 4));
  const file = String(req.query.file ?? '1') !== '0';
  const apply = String(req.query.apply || '') === '1';
  res.status(202).json({ status: 'accepted', message: `Dial search started: ${sports.join(', ')}, last ${recentDays} days, confirmed on the ${confirmDays} before` });
  (async () => {
    for (const sport of sports) {
      try {
        const summary = await runDialSearch(supabase, { sport, recentDays, confirmDays, minDelta, top, file, apply, log: (m) => console.warn(m) });
        await supabase.from('cron_job_logs').insert({ job_name: 'dial-search', status: 'completed', details: JSON.stringify(summary) });
      } catch (err) {
        console.error(`dial-search ${sport} error:`, err.message);
        try { await supabase.from('cron_job_logs').insert({ job_name: 'dial-search', status: 'failed', details: JSON.stringify({ sport, error: err.message }) }); } catch { /* best effort */ }
      }
    }
  })();
}

module.exports = dialSearch;
module.exports.parseSports = parseSports;
