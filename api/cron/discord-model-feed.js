/**
 * CRON: the model channel on Discord (owner redesign 2026-09-21).
 *
 * Two posters share this file:
 *
 *   discord-model-feed  (hourly)  every new model_weight_changes row and
 *                                 every new or amended directive since
 *                                 the last post, as embeds. The cursor
 *                                 lives in discord_feed_cursor so a retry
 *                                 never double posts and a missed hour
 *                                 catches up.
 *   discord-dial-board  (Mondays) the dial board as one embed: a field
 *                                 per sport with the multipliers and the
 *                                 dial moves of the last seven days, plus
 *                                 the bucket floors. Text, not pixels
 *                                 (owner: "no pixels first").
 *
 * No-op until a webhook is set (model channel, or the board webhook as
 * fallback; the cursor only advances after a real post). No LLM calls.
 * Read only apart from the cursor and cron_job_logs.
 *
 * Endpoints: POST /cron/discord-model-feed?secret=...
 *            POST /cron/discord-dial-board?secret=...
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { sendDiscordEmbeds, clip, BRAND_COLOR } = require('../../lib/services/discord-alerts.js');

const DIAL_COLOR = 0x1abc9c;
const DIRECTIVE_COLOR = 0x8e44ad;
const FEED_LIMIT = 20;

function compactJson(v, limit = 1000) {
  if (v == null) return '-';
  if (typeof v !== 'object') return clip(String(v), limit);
  const parts = Object.entries(v).map(([k, val]) => `${k}: ${typeof val === 'object' ? JSON.stringify(val) : val}`);
  return clip(parts.join('\n') || '-', limit);
}

function when(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' MT';
  } catch {
    return '';
  }
}

/** Pure: one embed per model_weight_changes row. */
function formatWeightChange(row) {
  return {
    title: clip(`🎛️ Dial moved · ${row.sport || '__all__'}`, 256),
    description: clip(row.component || '', 4096),
    color: DIAL_COLOR,
    fields: [
      { name: 'Before', value: compactJson(row.before), inline: true },
      { name: 'After', value: compactJson(row.after), inline: true },
      { name: 'Why', value: clip(row.reason || '-', 1024), inline: false },
    ],
    footer: { text: clip(`source ${row.source || 'unknown'} · ${when(row.changed_at)}`, 2048) },
  };
}

/** Pure: one embed per new or amended directive. */
function formatDirective(row, isNew) {
  const fields = [];
  if (row.status) fields.push({ name: 'Status', value: String(row.status), inline: true });
  if (row.decided_on) fields.push({ name: 'Decided', value: String(row.decided_on), inline: true });
  if (row.enforcement) fields.push({ name: 'Enforcement', value: clip(row.enforcement, 1024), inline: false });
  return {
    title: clip(`📜 Directive ${row.id} · ${isNew ? 'new' : 'amended'}`, 256),
    description: clip(row.directive || '', 4096),
    color: DIRECTIVE_COLOR,
    fields,
  };
}

function sportOfKey(key) {
  if (!key || key === '__global__') return null;
  return key.split(':')[0];
}

/**
 * Pure: the dial board embed. One field per sport that has a multiplier
 * or moved this week; a sport with every multiplier at 0 and no moves
 * (the shadow soccer family) stays out. The __all__ row is the
 * defaults. Values are clipped to Discord's field limit.
 */
function formatDialBoard({ multipliers = [], changes = [], bucketTargets = [], weekLabel }) {
  const bySport = new Map();
  const ensure = (s) => { if (!bySport.has(s)) bySport.set(s, { mult: [], moves: [] }); return bySport.get(s); };
  let globalLine = null;
  for (const m of multipliers) {
    if (m.key === '__global__') { globalLine = `__global__ ${Number(m.multiplier).toFixed(2)}`; continue; }
    const sport = sportOfKey(m.key);
    if (!sport) continue;
    const market = m.key.includes(':') ? m.key.split(':')[1] : 'sport';
    const val = Number(m.multiplier);
    ensure(sport).mult.push(`${market} ${val.toFixed(2)}${val === 0 ? ' (muted)' : ''}`);
  }
  for (const c of changes) {
    const sport = c.sport || '__all__';
    ensure(sport).moves.push(`• ${clip(c.component || 'change', 120)}${c.after && typeof c.after === 'object' ? ` → ${clip(compactJson(c.after, 200).replace(/\n/g, ', '), 200)}` : ''}`);
  }
  const fields = [];
  const order = [...bySport.keys()].sort((a, b) => (a === '__all__' ? -1 : b === '__all__' ? 1 : a.localeCompare(b)));
  for (const sport of order) {
    const { mult, moves } = bySport.get(sport);
    const allMuted = mult.length > 0 && mult.every(l => l.includes('(muted)'));
    if ((mult.length === 0 || allMuted) && moves.length === 0) continue;
    const lines = [];
    if (mult.length) lines.push(`Multipliers: ${mult.join(' · ')}`);
    lines.push(moves.length ? 'Moved this week:' : 'No dial moves this week.');
    lines.push(...moves);
    fields.push({ name: sport === '__all__' ? 'Every sport (defaults)' : sport, value: clip(lines.join('\n'), 1024), inline: false });
  }
  if (bucketTargets.length) {
    const floors = bucketTargets
      .filter(t => t.sport === '__all__')
      .sort((a, b) => Number(b.floor_pp) - Number(a.floor_pp))
      .map(t => `${t.band} ${Number(t.floor_pp).toFixed(0)}pp`);
    const overrides = bucketTargets.filter(t => t.sport !== '__all__').map(t => `${t.sport} ${t.band} ${Number(t.floor_pp).toFixed(0)}pp`);
    fields.push({ name: 'Bucket floors (pp over break even)', value: clip([floors.join(' · '), ...overrides].filter(Boolean).join('\n') || '-', 1024), inline: false });
  }
  return {
    title: clip(`🎛️ Dial board · ${weekLabel}`, 256),
    description: [globalLine ? `Fallback multiplier ${globalLine}.` : null, 'The tier is the raw claim times the multiplier minus the price rails (directive 25). Every dial move below carries its evidence row.'].filter(Boolean).join(' '),
    color: DIAL_COLOR,
    fields: fields.slice(0, 25),
    footer: { text: 'Dials move only through sport_dials plus a model_weight_changes row (directives 7, 8, 21, 25). Text on purpose: no pixels.' },
  };
}

async function readCursor(feed) {
  const { data } = await supabase.from('discord_feed_cursor').select('feed, last_seen').eq('feed', feed).maybeSingle();
  return data?.last_seen || null;
}

async function writeCursor(feed, lastSeen) {
  await supabase.from('discord_feed_cursor').upsert({ feed, last_seen: lastSeen, updated_at: new Date().toISOString() }, { onConflict: 'feed' });
}

async function runModelFeed() {
  const startTime = Date.now();
  const fallbackSince = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const sinceChanges = (await readCursor('weight_changes')) || fallbackSince;
  const sinceDirectives = (await readCursor('directives')) || fallbackSince;

  const { data: changes, error: chErr } = await supabase
    .from('model_weight_changes')
    .select('id, changed_at, sport, component, before, after, reason, source')
    .gt('changed_at', sinceChanges)
    .order('changed_at', { ascending: true })
    .limit(FEED_LIMIT);
  if (chErr) throw chErr;

  const { data: directives, error: dErr } = await supabase
    .from('directives')
    .select('id, directive, decided_on, status, enforcement, created_at, updated_at')
    .or(`created_at.gt.${sinceDirectives},updated_at.gt.${sinceDirectives}`)
    .order('id', { ascending: true })
    .limit(FEED_LIMIT);
  if (dErr) throw dErr;

  const embeds = [
    ...(changes || []).map(formatWeightChange),
    ...(directives || []).map(d => formatDirective(d, new Date(d.created_at) > new Date(sinceDirectives))),
  ];

  let result = { sent: false, reason: 'nothing new' };
  if (embeds.length) result = await sendDiscordEmbeds(embeds, 'model');

  // Advance the cursor only after a real post, so a missing webhook or an
  // outage replays the rows next hour instead of losing them.
  if (embeds.length && result.sent) {
    if (changes?.length) await writeCursor('weight_changes', changes[changes.length - 1].changed_at);
    if (directives?.length) {
      const last = directives.reduce((m, d) => {
        const t = Math.max(new Date(d.created_at).getTime(), d.updated_at ? new Date(d.updated_at).getTime() : 0);
        return t > m ? t : m;
      }, new Date(sinceDirectives).getTime());
      await writeCursor('directives', new Date(last).toISOString());
    }
  }

  await supabase.from('cron_job_logs').insert({
    job_name: 'discord-model-feed',
    status: embeds.length === 0 ? 'completed' : result.sent ? 'completed' : 'skipped',
    details: JSON.stringify({
      weight_changes: (changes || []).length,
      directives: (directives || []).length,
      sent: result.sent,
      channel: result.channel || null,
      fallback: result.fallback || false,
      reason: result.reason || null,
      duration_ms: Date.now() - startTime,
    }),
  });
}

async function runDialBoard() {
  const startTime = Date.now();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [multRes, chRes, tgtRes] = await Promise.all([
    supabase.from('edge_calibration').select('key, multiplier, source, updated_at').order('key'),
    supabase.from('model_weight_changes').select('changed_at, sport, component, after, source').gte('changed_at', since).order('changed_at', { ascending: true }),
    supabase.from('bucket_targets').select('sport, band, floor_pp').order('sport'),
  ]);
  const err = multRes.error || chRes.error || tgtRes.error;
  if (err) throw err;
  const weekLabel = `week of ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' })}`;
  const embed = formatDialBoard({ multipliers: multRes.data || [], changes: chRes.data || [], bucketTargets: tgtRes.data || [], weekLabel });
  const result = await sendDiscordEmbeds([embed], 'model');
  await supabase.from('cron_job_logs').insert({
    job_name: 'discord-dial-board',
    status: result.sent ? 'completed' : 'skipped',
    details: JSON.stringify({
      sports: (embed.fields || []).length,
      moves_this_week: (chRes.data || []).length,
      sent: result.sent,
      channel: result.channel || null,
      fallback: result.fallback || false,
      reason: result.reason || null,
      duration_ms: Date.now() - startTime,
    }),
  });
}

function guarded(run, label) {
  return function handler(req, res) {
    const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
    if (cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    res.status(202).json({ status: 'accepted', message: `${label} started` });
    run().catch(err => console.error(`${label} error:`, err.message));
  };
}

module.exports = {
  discordModelFeed: guarded(runModelFeed, 'Model feed post'),
  discordDialBoard: guarded(runDialBoard, 'Dial board post'),
  formatWeightChange,
  formatDirective,
  formatDialBoard,
  runModelFeed,
  runDialBoard,
};
