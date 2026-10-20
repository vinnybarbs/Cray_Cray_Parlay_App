/**
 * CRON: every directive change, posted to the Discord model channel.
 *
 * Directive 29 (owner 2026-10-20) lets the downstream sync edit the
 * directives itself, without asking first. The guardrail is that every
 * edit is seen and can be undone: the trigger on directives writes each
 * insert or update to directive_history with the before and after, and
 * this job posts each unposted row once (one embed per change: what
 * changed, why, the old and new text, and the one call that reverts it),
 * then stamps posted_at so a later run never repeats it. No LLM calls,
 * no links.
 *
 * Endpoint: POST /cron/discord-directive-changes?secret=...
 * Schedule: hourly at :20 (cron discord-directive-changes).
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { sendDiscordEmbeds, clip, BRAND_COLOR } = require('../../lib/services/discord-alerts.js');

const BATCH = 20;
// Discord refuses a message whose embeds add up past 6000 characters,
// so one change stays well under it: three fields before and after.
const VALUE_CAP = 700;
const MAX_FIELDS = 3;
const FIELD_LABEL = {
  directive: 'Rule', enforcement: 'Enforcement', check_sql: 'Check', notes: 'Notes', status: 'Status', decided_on: 'Decided',
};

function sourceLabel(source) {
  if (source === 'downstream-sync') return 'by the downstream sync';
  if (source === 'revert') return 'reverted';
  if (/^migration /.test(source || '')) return 'by a migration';
  return 'by hand';
}

/** Pure formatter: one embed per directive_history row. */
function formatDirectiveChange(row) {
  const op = row.op === 'insert' ? 'added' : 'updated';
  const fields = (row.changed_fields || []).filter(f => f !== 'id');
  const embed = {
    title: clip(`📜 Directive ${row.directive_id} ${op} ${sourceLabel(row.source)}`, 256),
    description: clip(row.reason || 'No reason recorded.', 1000),
    color: BRAND_COLOR,
    fields: [],
    footer: { text: `Undo with select revert_directive_change(${row.id})` },
  };
  if (row.op === 'insert') {
    embed.fields.push({ name: 'Rule', value: clip(row.after?.directive || 'none', 1000) });
  } else {
    for (const f of fields.slice(0, MAX_FIELDS)) {
      const label = FIELD_LABEL[f] || f;
      embed.fields.push({ name: `${label} before`, value: clip(String(row.before?.[f] ?? 'none'), VALUE_CAP) });
      embed.fields.push({ name: `${label} now`, value: clip(String(row.after?.[f] ?? 'none'), VALUE_CAP) });
    }
    if (fields.length > MAX_FIELDS) {
      embed.fields.push({ name: 'Also changed', value: fields.slice(MAX_FIELDS).map(f => FIELD_LABEL[f] || f).join(', ') });
    }
  }
  return embed;
}

async function runDirectiveChanges() {
  const startTime = Date.now();
  const { data: rows, error } = await supabase
    .from('directive_history')
    .select('id, directive_id, op, source, reason, changed_fields, before, after, changed_at')
    .is('posted_at', null)
    .order('id', { ascending: true })
    .limit(BATCH);
  if (error) throw error;
  let result = { sent: false, reason: 'nothing to post' };
  if ((rows || []).length) {
    result = await sendDiscordEmbeds(rows.map(formatDirectiveChange), 'model');
    if (result.sent) {
      const { error: upError } = await supabase
        .from('directive_history')
        .update({ posted_at: new Date().toISOString() })
        .in('id', rows.map(r => r.id));
      if (upError) result.reason = `posted but not stamped: ${upError.message}`;
    }
  }
  await supabase.from('cron_job_logs').insert({
    job_name: 'discord-directive-changes',
    status: result.sent || !(rows || []).length ? 'completed' : 'skipped',
    details: JSON.stringify({
      history_ids: (rows || []).map(r => r.id),
      sent: result.sent,
      fallback: result.fallback || false,
      messages: result.messages || 0,
      reason: result.reason || null,
      duration_ms: Date.now() - startTime,
    }),
  });
  return result;
}

async function discordDirectiveChanges(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.status(202).json({ status: 'accepted', message: 'Directive change post started' });
  runDirectiveChanges().catch(err => console.error('Directive change post error:', err.message));
}

module.exports = discordDirectiveChanges;
module.exports.formatDirectiveChange = formatDirectiveChange;
module.exports.runDirectiveChanges = runDirectiveChanges;
