/**
 * CRON: Morning board post to Discord.
 *
 * One message each morning with everything live on today's board,
 * grouped by tier plus Legs and Traps, and a link back to the site for
 * the research and grades. The copy says the board revises until lock,
 * and the Sharp Take promotion alerts cover the intraday changes, so
 * together the channel is: full picture in the morning, pings when the
 * money tier moves.
 *
 * No-op until DISCORD_WEBHOOK_URL is set. No LLM calls.
 *
 * Endpoint: POST /cron/discord-morning-board?secret=...
 * Schedule: daily 14:00 UTC (8:00 AM MT) via pg_cron.
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { sendDiscordMessage } = require('../../lib/services/discord-alerts.js');
const { siteDay } = require('../../shared/site-day.js');

const SITE_URL = 'https://traphawk.io';
const TIER_ORDER = ['Sharp Take', 'Strong Play', 'Play', 'Lean'];
const FOOTER = `Tiers revise with prices until lock, and promotions into Strong Play or Sharp Take ping here as they happen. All the research and full grades: ${SITE_URL}`;

function gameTimeMt(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit',
    }) + ' MT';
  } catch {
    return null;
  }
}

function pickLine(row) {
  const parts = [row.pick, row.sport];
  if (row.edge_pp != null) parts.push(`${row.edge_pp}pp`);
  const t = gameTimeMt(row.game_date);
  if (t) parts.push(t);
  return `• ${parts.filter(Boolean).join(' · ')}`;
}

/** Pure formatter so the message shape is testable. */
function formatMorningBoard(rows, dateLabel) {
  const lines = [`🦅 **TrapHawk board · ${dateLabel}**`];
  const byTier = new Map();
  for (const r of rows || []) {
    const key = r.tier || 'Lean';
    if (!byTier.has(key)) byTier.set(key, []);
    byTier.get(key).push(r);
  }
  let anything = false;
  for (const tier of TIER_ORDER) {
    const group = byTier.get(tier);
    if (!group?.length) continue;
    anything = true;
    lines.push('', `**${tier}${group.length > 1 ? 's' : ''}**`);
    for (const r of group.sort((a, b) => (b.edge_pp ?? 0) - (a.edge_pp ?? 0))) lines.push(pickLine(r));
  }
  const legs = byTier.get('Leg') || [];
  if (legs.length) {
    anything = true;
    lines.push('', '**Legs · high hit rate, thin payout, parlay material**');
    for (const r of legs.sort((a, b) => (b.model_prob ?? 0) - (a.model_prob ?? 0))) {
      const prob = r.model_prob != null ? `${Math.round(r.model_prob * 100)}% to hit` : null;
      lines.push(`• ${[r.pick, r.sport, prob, gameTimeMt(r.game_date)].filter(Boolean).join(' · ')}`);
    }
  }
  const traps = byTier.get('Trap') || [];
  if (traps.length) {
    anything = true;
    lines.push('', '**Traps · the advice is to fade these sides**');
    for (const r of traps.sort((a, b) => (a.edge_pp ?? 0) - (b.edge_pp ?? 0))) lines.push(pickLine(r));
  }
  if (!anything) {
    lines.push('', 'Quiet board so far. Sweeps run all day and promotions ping here when a Strong Play or Sharp Take lands.');
  }
  lines.push('', FOOTER);
  return lines.join('\n');
}

async function runMorningBoard() {
  const startTime = Date.now();
  const today = siteDay();
  // Wide UTC window, then an exact Denver-day filter via siteDay: a
  // hardcoded offset would silently shift the board day at the DST
  // change (the same class of bug as the 2026-08-08 Africa-time incident).
  const windowStart = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const windowEnd = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  const { data: fetched, error } = await supabase
    .from('ai_suggestions')
    .select('sport, pick, edge_pp, tier, game_date, model_prob')
    .like('session_id', 'auto_digest%')
    .eq('actual_outcome', 'pending')
    .is('voided_at', null)
    .gte('game_date', windowStart)
    .lt('game_date', windowEnd)
    .order('game_date', { ascending: true });
  if (error) throw error;
  const rows = (fetched || []).filter(r => siteDay(r.game_date) === today);

  const dateLabel = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });
  const result = await sendDiscordMessage(formatMorningBoard(rows || [], dateLabel));

  await supabase.from('cron_job_logs').insert({
    job_name: 'discord-morning-board',
    status: result.sent ? 'completed' : 'skipped',
    details: JSON.stringify({
      board_rows: (rows || []).length,
      sent: result.sent,
      messages: result.messages || 0,
      reason: result.reason || null,
      duration_ms: Date.now() - startTime,
    }),
  });
}

async function discordMorningBoard(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.status(202).json({ status: 'accepted', message: 'Morning board post started' });
  runMorningBoard().catch(err => console.error('Morning board error:', err.message));
}

module.exports = discordMorningBoard;
module.exports.formatMorningBoard = formatMorningBoard;
