/**
 * CRON: the exec assistant's daily message, posted to Discord.
 *
 * The exec assistant (agents/exec-assistant.md) files one agent_reports
 * row each morning with the owner's message in short form: the record,
 * WHAT SHIPPED TODAY, WHAT THE MACHINE FOUND, YOUR CALLS. The routine's
 * own final message reaches the owner by push and email. This job puts
 * the same thing in the Discord channel (owner 2026-10-09: "can the
 * executive assistant send me a discord message in the channel").
 *
 * Reads the newest exec-assistant row from the last 20 hours, posts it
 * once (the cron_job_logs row carries the report id, a repeat run with
 * the same id skips), no LLM calls, never touches the record.
 *
 * Endpoint: POST /cron/discord-exec-brief?secret=...
 * Schedule: 15:45, 16:45 and 17:45 UTC daily (the exec assistant fires
 * 08:57 Denver, which is 14:57 or 15:57 UTC by season, and a run can
 * take half an hour), so the first slot after the row lands posts it
 * and the later slots skip.
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { sendDiscordEmbeds, embedsFromLines, clip, BRAND_COLOR } = require('../../lib/services/discord-alerts.js');

const SECTIONS = ['WHAT SHIPPED TODAY', 'WHAT THE MACHINE FOUND', 'YOUR CALLS'];
const LOOKBACK_HOURS = 20;

/**
 * Pure formatter. Splits the summary into the lead and the three
 * sections by their headers, one embed per section. A summary without
 * the headers posts as one embed.
 */
function formatExecBrief(row, dateLabel) {
  const text = String(row?.summary || '').trim();
  const cuts = SECTIONS
    .map(name => ({ name, at: text.indexOf(name) }))
    .filter(c => c.at >= 0)
    .sort((a, b) => a.at - b.at);
  const lead = (cuts.length ? text.slice(0, cuts[0].at) : text).replace(/^skills from supabase[.,]?\s*/i, '').trim();
  const embeds = [{
    title: `🦅 Exec assistant · ${dateLabel}`,
    description: clip(lead || 'No lead line in this morning\'s row.', 4000),
    color: BRAND_COLOR,
  }];
  cuts.forEach((c, i) => {
    const end = i + 1 < cuts.length ? cuts[i + 1].at : text.length;
    const body = text.slice(c.at + c.name.length, end).replace(/^[:.\s]+/, '').trim();
    const lines = body.split(/\n+|(?<=\.)\s+(?=[A-Z0-9(])/).map(s => s.trim()).filter(Boolean);
    const title = c.name.charAt(0) + c.name.slice(1).toLowerCase();
    embeds.push(...embedsFromLines(title, lines.length ? lines : ['Nothing today.'], {
      footer: i === cuts.length - 1 ? `Blackboard row ${row.id}. Answer the calls in chat and the exec assistant ships them.` : null,
    }));
  });
  if (!cuts.length) embeds[0].footer = { text: `Blackboard row ${row.id}.` };
  return embeds;
}

async function alreadyPosted(reportId) {
  const { data } = await supabase
    .from('cron_job_logs')
    .select('id')
    .eq('job_name', 'discord-exec-brief')
    .eq('status', 'completed')
    .like('details', `%"report_id":${reportId},%`)
    .limit(1);
  return (data || []).length > 0;
}

async function runExecBrief() {
  const startTime = Date.now();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from('agent_reports')
    .select('id, agent, summary, created_at')
    .eq('agent', 'exec-assistant')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (rows || [])[0];
  let result;
  if (!row) {
    result = { sent: false, reason: 'no exec-assistant row in the window' };
  } else if (await alreadyPosted(row.id)) {
    result = { sent: false, reason: 'already posted', skipped_duplicate: true };
  } else {
    const dateLabel = new Date(row.created_at).toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/Denver',
    });
    result = await sendDiscordEmbeds(formatExecBrief(row, dateLabel), 'board');
  }
  await supabase.from('cron_job_logs').insert({
    job_name: 'discord-exec-brief',
    status: result.sent ? 'completed' : 'skipped',
    details: JSON.stringify({
      report_id: row ? row.id : null,
      sent: result.sent,
      channel: result.channel || 'board',
      fallback: result.fallback || false,
      messages: result.messages || 0,
      reason: result.reason || null,
      duration_ms: Date.now() - startTime,
    }),
  });
  return result;
}

async function discordExecBrief(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.status(202).json({ status: 'accepted', message: 'Exec brief post started' });
  runExecBrief().catch(err => console.error('Exec brief error:', err.message));
}

module.exports = discordExecBrief;
module.exports.formatExecBrief = formatExecBrief;
module.exports.runExecBrief = runExecBrief;
