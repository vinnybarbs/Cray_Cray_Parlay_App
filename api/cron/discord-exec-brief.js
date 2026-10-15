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
 *
 * The safety net (owner 2026-10-12: notifications on the analysis
 * routines are off, so the exec assistant is the only voice). If the
 * last slot of the day still finds no row, it posts a short alert
 * saying the brief never landed, once per day, so a failed or stuck
 * exec assistant run is never silent.
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { sendDiscordEmbeds, embedsFromLines, clip, BRAND_COLOR } = require('../../lib/services/discord-alerts.js');

const SECTIONS = ['WHAT SHIPPED TODAY', 'WHAT THE MACHINE FOUND', 'YOUR CALLS'];
const LOOKBACK_HOURS = 20;
const LAST_SLOT_UTC_HOUR = 17;
const MISSING_REASON = 'no exec-assistant row in the window';

/** True on the last daily slot (17:45 UTC), when a missing row is final. */
function isLastSlot(now = new Date()) {
  return now.getUTCHours() >= LAST_SLOT_UTC_HOUR;
}

/** Pure formatter for the alert posted when no brief landed today. */
function formatMissingBrief(dateLabel) {
  return [{
    title: `🦅 Exec assistant · ${dateLabel}`,
    description: 'No brief today. The exec assistant routine did not file its blackboard row by 11:45 MT, so the ops check, the calibration review and the cost audit findings have not reached you. Open the TrapHawk exec assistant routine and check its last run.',
    color: BRAND_COLOR,
  }];
}

async function missingAlertSent() {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from('cron_job_logs')
    .select('id')
    .eq('job_name', 'discord-exec-brief')
    .eq('status', 'completed')
    .gte('created_at', since)
    .like('details', '%"missing_alert":true%')
    .limit(1);
  return (data || []).length > 0;
}

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
      footer: i === cuts.length - 1 ? `Blackboard row ${row.id}. Reply in #talk-to-claude or the Exec assistant thread and the exec assistant ships it.` : null,
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
  let missingAlert = false;
  const dateLabelFor = d => new Date(d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/Denver',
  });
  if (!row && isLastSlot() && !(await missingAlertSent())) {
    missingAlert = true;
    result = await sendDiscordEmbeds(formatMissingBrief(dateLabelFor(Date.now())), 'ops');
    if (!result.sent && !result.reason) result.reason = MISSING_REASON;
  } else if (!row) {
    result = { sent: false, reason: MISSING_REASON };
  } else if (await alreadyPosted(row.id)) {
    result = { sent: false, reason: 'already posted', skipped_duplicate: true };
  } else {
    result = await sendDiscordEmbeds(formatExecBrief(row, dateLabelFor(row.created_at)), 'exec');
  }
  await supabase.from('cron_job_logs').insert({
    job_name: 'discord-exec-brief',
    status: result.sent ? 'completed' : 'skipped',
    details: JSON.stringify({
      report_id: row ? row.id : null,
      sent: result.sent,
      channel: result.channel || (missingAlert ? 'ops' : 'exec'),
      fallback: result.fallback || false,
      messages: result.messages || 0,
      reason: result.reason || (missingAlert ? MISSING_REASON : null),
      missing_alert: missingAlert,
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
module.exports.formatMissingBrief = formatMissingBrief;
module.exports.isLastSlot = isLastSlot;
module.exports.runExecBrief = runExecBrief;
