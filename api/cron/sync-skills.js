/**
 * Cron: sync .claude/skills into the skills table on demand.
 *
 * The same sync runs at every server start, so this endpoint exists for
 * verification and for a manual refresh between deploys.
 *
 * Endpoint: POST /cron/sync-skills?secret=...
 */

const { createClient } = require('@supabase/supabase-js');
const { syncSkills } = require('../../lib/services/skill-sync');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function syncSkillsEndpoint(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const startTime = Date.now();
  const result = await syncSkills({ source: 'cron' });
  try {
    await supabase.from('cron_job_logs').insert({
      job_name: 'sync-skills',
      status: result.error ? 'failed' : 'completed',
      details: JSON.stringify({ ...result, duration_ms: Date.now() - startTime }),
    });
  } catch { /* best-effort */ }
  res.status(result.error ? 500 : 200).json({ success: !result.error, ...result });
}

module.exports = syncSkillsEndpoint;
