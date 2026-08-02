/**
 * CRON: Sync Tennis Data from ESPN
 *
 * Fills the two tables behind tennis pre-match context (tennis_rankings,
 * tennis_match_results) from ESPN's public tennis API, the same host
 * espn-results.js already settles tennis picks against. Without this sync
 * every tennis analysis prompt carried only odds, and each Deep Research
 * card honestly reported "records not available from the data sources".
 *
 * Per run:
 *   - ATP + WTA rankings, full table upsert (one row per tour+player)
 *   - Completed singles results for the trailing ?days=N days (default 3,
 *     capped at 21 so a manual backfill can seed the workload window)
 *
 * Schedule: minute 5, every 4 hours (20 min before pre-analyze-Tennis at :25)
 * Endpoint: POST /cron/sync-tennis-data?days=3
 */

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { parseRankingsPayload, parseScoreboardPayload } = require('../../lib/services/tennis-data.js');

const SITE_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const TOURS = ['atp', 'wta'];

const DEFAULT_DAYS = 3;
const MAX_DAYS = 21;

function yyyymmdd(date) {
  return date.toISOString().split('T')[0].replace(/-/g, '');
}

function isoDate(date) {
  return date.toISOString().split('T')[0];
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

async function syncRankings() {
  const summary = {};
  for (const tour of TOURS) {
    try {
      const payload = await fetchJson(`${SITE_BASE}/tennis/${tour}/rankings`);
      const rows = parseRankingsPayload(payload, tour);
      if (rows.length === 0) {
        summary[tour] = { rankings: 0, note: 'empty parse' };
        continue;
      }
      const { error } = await supabase
        .from('tennis_rankings')
        .upsert(rows, { onConflict: 'tour,player_key' });
      if (error) throw new Error(error.message);
      summary[tour] = { rankings: rows.length };
      console.log(`  🎾 ${tour.toUpperCase()} rankings: ${rows.length} players`);
    } catch (err) {
      summary[tour] = { rankings: 0, error: err.message };
      console.warn(`  ⚠️ ${tour.toUpperCase()} rankings sync failed: ${err.message}`);
    }
  }
  return summary;
}

async function syncResults(days) {
  const summary = { matches: 0, errors: [] };
  for (const tour of TOURS) {
    for (let back = 0; back < days; back++) {
      const date = new Date(Date.now() - back * 24 * 60 * 60 * 1000);
      try {
        const payload = await fetchJson(`${SITE_BASE}/tennis/${tour}/scoreboard?dates=${yyyymmdd(date)}`);
        const rows = parseScoreboardPayload(payload, tour, isoDate(date));
        if (rows.length === 0) continue;
        const { error } = await supabase
          .from('tennis_match_results')
          .upsert(rows, { onConflict: 'tour,match_date,winner_key,loser_key', ignoreDuplicates: false });
        if (error) throw new Error(error.message);
        summary.matches += rows.length;
      } catch (err) {
        summary.errors.push(`${tour} ${yyyymmdd(date)}: ${err.message}`);
      }
      // Be polite to the free API; the cron has a 5-minute timeout budget.
      await new Promise(r => setTimeout(r, 250));
    }
  }
  if (summary.matches > 0) console.log(`  🎾 Results upserted: ${summary.matches} matches`);
  if (summary.errors.length > 0) console.warn(`  ⚠️ Result sync errors: ${summary.errors.slice(0, 3).join(' | ')}`);
  return summary;
}

async function runSync(days) {
  const startTime = Date.now();
  try {
    // First run after deploy: self-backfill the full window so the 14-day
    // workload signal works immediately instead of accreting over a week.
    if (days < MAX_DAYS) {
      const { count } = await supabase
        .from('tennis_match_results')
        .select('id', { count: 'exact', head: true });
      if (count === 0) {
        console.log(`  🎾 Empty results table, backfilling ${MAX_DAYS} days`);
        days = MAX_DAYS;
      }
    }
    console.log(`\n🎾 CRON: Syncing tennis data (${days} day${days === 1 ? '' : 's'} of results)...`);
    const rankings = await syncRankings();
    const results = await syncResults(days);

    await supabase.from('cron_job_logs').insert({
      job_name: 'sync-tennis-data',
      status: results.errors.length === 0 ? 'completed' : 'partial',
      details: JSON.stringify({
        days,
        rankings,
        matches_upserted: results.matches,
        errors: results.errors.slice(0, 5),
        duration_ms: Date.now() - startTime,
      }),
    });
    console.log(`✅ Tennis sync complete in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  } catch (error) {
    console.error('❌ Tennis sync failed:', error.message);
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: 'sync-tennis-data',
        status: 'failed',
        details: JSON.stringify({ error: error.message }),
      });
    } catch (e) { /* don't block on logging */ }
  }
}

async function syncTennisData(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const days = Math.min(MAX_DAYS, Math.max(1, parseInt(req.query.days, 10) || DEFAULT_DAYS));
  res.status(202).json({ status: 'accepted', message: `Tennis sync started (${days} days of results)` });
  runSync(days).catch(err => console.error('❌ Tennis sync background error:', err.message));
}

module.exports = syncTennisData;
