// Cron endpoint for the data-integrity agent sweep. Same auth pattern as the
// other cron endpoints (CRON_SECRET via header or query). Responds 202 and
// runs in the background — the pg_cron http_post has a 3s timeout.

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { runDataIntegritySweep } = require('../../lib/services/data-integrity-agent.js');

module.exports = async function dataIntegrity(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.status(202).json({ status: 'accepted', message: 'Data integrity sweep started' });

  try {
    const summary = await runDataIntegritySweep(supabase);
    console.log('🕵️ Data integrity sweep:', JSON.stringify(summary));
  } catch (err) {
    console.error('❌ Data integrity sweep failed:', err.message);
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: 'data_integrity_sweep',
        status: 'error',
        details: { error: err.message },
      });
    } catch { /* best-effort */ }
  }
};
