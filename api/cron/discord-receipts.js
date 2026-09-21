/**
 * CRON: nightly receipts to Discord (owner redesign 2026-09-21).
 *
 * One post each morning, before the board, with yesterday's settled
 * picks by tier (the receipts: what hit, what missed, Sharp Takes called
 * out) and the public record over the rolling windows. The record card
 * reads ONLY mv_public_record, per the hard rule that every public
 * number comes from that view. The pick list is the ledger's own rows,
 * the same rows the digest shows settled.
 *
 * No-op until a webhook is set (receipts channel, or the board webhook
 * as fallback). No LLM calls. Never touches the record.
 *
 * Endpoint: POST /cron/discord-receipts?secret=...
 * Schedule: daily 13:30 UTC (7:30 AM MT) via pg_cron.
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { sendDiscordEmbeds, embedsFromLines, clip, TIER_COLOR, BRAND_COLOR } = require('../../lib/services/discord-alerts.js');
const { siteDay, siteDayOffset } = require('../../shared/site-day.js');

const TIER_ORDER = ['Sharp Take', 'Strong Play', 'Play', 'Lean', 'Trap', 'Leg'];
const MARK = { won: '✅', lost: '❌', push: '➖' };
const WINDOWS = [['last_3d', 'Last 3 days'], ['last_7d', 'Last 7 days'], ['last_30d', 'Last 30 days']];

function matchupOf(row) {
  return row.away_team && row.home_team ? `${row.away_team} @ ${row.home_team}` : null;
}

function units(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}u`;
}

function recordLine(r) {
  if (!r) return 'no rows';
  const u = units(r.roi_units);
  return `${r.won}-${r.lost}${Number(r.push) > 0 ? `-${r.push}` : ''}${u ? ` · ${u}` : ''}`;
}

function receiptLine(row) {
  const mark = MARK[row.actual_outcome] || '•';
  const parts = [];
  if (row.tier === 'Trap') parts.push(`Fade ${row.pick}`);
  else parts.push(row.pick);
  parts.push(matchupOf(row), row.sport);
  if (row.edge_pp != null && row.tier !== 'Leg' && row.tier !== 'Trap') parts.push(`${row.edge_pp}pp`);
  const lead = row.tier === 'Sharp Take' && row.actual_outcome === 'won' ? '🦅 ' : '';
  return `${mark} ${lead}${parts.filter(Boolean).join(' · ')}`;
}

/**
 * Pure formatter. rows: yesterday's settled ledger rows. record: the
 * mv_public_record rows for the three windows (overall and tier).
 */
function formatReceipts(rows, record, dateLabel) {
  const embeds = [];
  const byTier = new Map();
  for (const r of rows || []) {
    const key = r.tier || 'Lean';
    if (!byTier.has(key)) byTier.set(key, []);
    byTier.get(key).push(r);
  }
  const settled = (rows || []).length;
  const header = {
    title: `🧾 Receipts · ${dateLabel}`,
    description: settled
      ? `${settled} settled read${settled === 1 ? '' : 's'}. Picks then traps and legs, biggest claim first.`
      : `No settled picks for ${dateLabel}.`,
    color: BRAND_COLOR,
  };
  embeds.push(header);
  for (const tier of TIER_ORDER) {
    const group = byTier.get(tier);
    if (!group?.length) continue;
    const won = group.filter(r => r.actual_outcome === 'won').length;
    const lost = group.filter(r => r.actual_outcome === 'lost').length;
    const sorted = tier === 'Leg'
      ? group.sort((a, b) => (b.model_prob ?? 0) - (a.model_prob ?? 0))
      : group.sort((a, b) => (b.edge_pp ?? 0) - (a.edge_pp ?? 0));
    const title = tier === 'Trap' ? `Traps · fades that held ${won}, fades that broke ${lost}`
      : tier === 'Leg' ? `Legs · ${won} hit, ${lost} missed`
        : `${tier}${group.length > 1 ? 's' : ''} · ${won}-${lost}`;
    embeds.push(...embedsFromLines(title, sorted.map(receiptLine), { color: TIER_COLOR[tier] }));
  }

  const overall = new Map();
  const tiers = new Map();
  for (const r of record || []) {
    if (r.dimension_type === 'overall') overall.set(r.period_bucket, r);
    if (r.dimension_type === 'tier') tiers.set(`${r.period_bucket}|${r.dimension_value}`, r);
  }
  const fields = WINDOWS.map(([key, label]) => ({ name: label, value: recordLine(overall.get(key)), inline: true }));
  const tierLines = ['Sharp Take', 'Strong Play', 'Play', 'Lean'].map(t => {
    const r = tiers.get(`last_7d|${t}`);
    return `${t} ${r ? recordLine(r) : '0-0'}`;
  });
  fields.push({ name: 'By tier, last 7 days', value: clip(tierLines.join('\n'), 1024), inline: false });
  embeds.push({
    title: 'Record · the public ledger',
    color: BRAND_COLOR,
    fields,
    footer: { text: 'Every number on this card is mv_public_record, the same source as the site.' },
  });
  return embeds;
}

async function runReceipts() {
  const startTime = Date.now();
  const yesterday = siteDayOffset(-1);
  const windowStart = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const windowEnd = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const { data: fetched, error } = await supabase
    .from('ai_suggestions')
    .select('sport, home_team, away_team, pick, edge_pp, tier, game_date, model_prob, actual_outcome')
    .like('session_id', 'auto_digest%')
    .in('actual_outcome', ['won', 'lost', 'push'])
    .is('voided_at', null)
    .gte('game_date', windowStart)
    .lt('game_date', windowEnd)
    .order('game_date', { ascending: true });
  if (error) throw error;
  const rows = (fetched || []).filter(r => siteDay(r.game_date) === yesterday);

  const { data: record, error: recErr } = await supabase
    .from('mv_public_record')
    .select('period_bucket, dimension_type, dimension_value, won, lost, push, roi_units')
    .in('period_bucket', ['last_3d', 'last_7d', 'last_30d'])
    .in('dimension_type', ['overall', 'tier']);
  if (recErr) throw recErr;

  const dateLabel = new Date(`${yesterday}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });
  const result = await sendDiscordEmbeds(formatReceipts(rows, record || [], dateLabel), 'receipts');

  await supabase.from('cron_job_logs').insert({
    job_name: 'discord-receipts',
    status: result.sent ? 'completed' : 'skipped',
    details: JSON.stringify({
      day: yesterday,
      settled_rows: rows.length,
      sent: result.sent,
      channel: result.channel,
      fallback: result.fallback || false,
      messages: result.messages || 0,
      reason: result.reason || null,
      duration_ms: Date.now() - startTime,
    }),
  });
}

async function discordReceipts(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.status(202).json({ status: 'accepted', message: 'Receipts post started' });
  runReceipts().catch(err => console.error('Receipts error:', err.message));
}

module.exports = discordReceipts;
module.exports.formatReceipts = formatReceipts;
module.exports.runReceipts = runReceipts;
