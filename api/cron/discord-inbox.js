/**
 * CRON: the owner's Discord inbox (owner 2026-10-14: "my private one
 * with you or exec assistant so I can reply back").
 *
 * Every webhook post is send only. This is the one read path: a Discord
 * bot polls ONE private channel (#talk-to-claude on the HQ server) over
 * the REST API every ten minutes, keeps only messages written by the
 * owner's own Discord account, stores each in owner_inbox, and reacts
 * with 👀 so the owner sees it was received. The exec assistant reads
 * owner_inbox rows with status new at the start of every run, treats
 * them like a reply in its thread, and marks them handled.
 *
 * No gateway connection and no new dependency: plain REST on the
 * existing pg_cron to Railway pattern. No-op until all three variables
 * are set:
 *   DISCORD_BOT_TOKEN          the bot's token (Railway only, never the repo)
 *   DISCORD_INBOX_CHANNEL_ID   the #talk-to-claude channel id
 *   DISCORD_OWNER_USER_ID      the owner's Discord user id; every other author is ignored
 *
 * Logs a cron_job_logs row (discord-inbox) only when it stored something
 * or failed, so the ten minute cadence does not flood the log.
 *
 * Endpoint: POST /cron/discord-inbox?secret=...
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');

const API = 'https://discord.com/api/v10';
const FIRST_RUN_LOOKBACK_HOURS = 24;
const RECEIVED_EMOJI = encodeURIComponent('👀');

function config(env = process.env) {
  const token = env.DISCORD_BOT_TOKEN;
  const channelId = env.DISCORD_INBOX_CHANNEL_ID;
  const ownerId = env.DISCORD_OWNER_USER_ID;
  if (!token || !channelId || !ownerId) return null;
  return { token, channelId, ownerId };
}

/** Discord ids are snowflakes: the leading bits are a millisecond timestamp. */
function snowflakeTime(id) {
  try {
    return new Date(Number((BigInt(id) >> 22n) + 1420070400000n));
  } catch {
    return null;
  }
}

/**
 * Pure: the owner's new messages from a Discord messages response, oldest
 * first, as owner_inbox rows. Bots, webhooks, other people and empty
 * messages are dropped. On a first run (no cursor) anything older than a
 * day is dropped so the inbox starts fresh instead of replaying history.
 */
function ownerRows(messages, { ownerId, channelId, cursor = null, now = Date.now() }) {
  const floor = cursor ? null : now - FIRST_RUN_LOOKBACK_HOURS * 3600 * 1000;
  return (messages || [])
    .filter(m => m && m.author && String(m.author.id) === String(ownerId) && !m.author.bot && !m.webhook_id)
    .filter(m => String(m.content || '').trim() || (m.attachments || []).length)
    .filter(m => floor == null || new Date(m.timestamp).getTime() >= floor)
    .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
    .map(m => ({
      discord_message_id: String(m.id),
      channel_id: String(channelId),
      author_id: String(m.author.id),
      body: String(m.content || '').trim(),
      attachments: (m.attachments || []).map(a => ({ filename: a.filename, url: a.url, content_type: a.content_type || null })),
      reply_to: m.message_reference?.message_id ? String(m.message_reference.message_id) : null,
      posted_at: m.timestamp || snowflakeTime(m.id)?.toISOString() || new Date(now).toISOString(),
    }));
}

async function discordGet(path, token) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bot ${token}` } });
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* unreadable */ }
    throw new Error(`Discord ${res.status} on GET ${path.split('?')[0]}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function react(cfg, messageId) {
  try {
    const res = await fetch(`${API}/channels/${cfg.channelId}/messages/${messageId}/reactions/${RECEIVED_EMOJI}/@me`, {
      method: 'PUT',
      headers: { Authorization: `Bot ${cfg.token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function lastStoredId(channelId) {
  const { data, error } = await supabase
    .from('owner_inbox')
    .select('discord_message_id, posted_at')
    .eq('channel_id', channelId)
    .order('posted_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.discord_message_id || null;
}

async function runInbox() {
  const cfg = config();
  if (!cfg) return { stored: 0, reason: 'not configured' };
  const startTime = Date.now();
  let stored = 0;
  let reacted = 0;
  try {
    const cursor = await lastStoredId(cfg.channelId);
    const query = cursor ? `after=${cursor}&limit=50` : 'limit=50';
    const messages = await discordGet(`/channels/${cfg.channelId}/messages?${query}`, cfg.token);
    const rows = ownerRows(messages, { ownerId: cfg.ownerId, channelId: cfg.channelId, cursor });
    if (rows.length) {
      const { error } = await supabase.from('owner_inbox').upsert(rows, { onConflict: 'discord_message_id', ignoreDuplicates: true });
      if (error) throw error;
      stored = rows.length;
      for (const r of rows) if (await react(cfg, r.discord_message_id)) reacted += 1;
      await supabase.from('cron_job_logs').insert({
        job_name: 'discord-inbox',
        status: 'completed',
        details: JSON.stringify({ stored, reacted, duration_ms: Date.now() - startTime }),
      });
    }
    return { stored, reacted };
  } catch (e) {
    await supabase.from('cron_job_logs').insert({
      job_name: 'discord-inbox',
      status: 'failed',
      details: JSON.stringify({ stored, error: e.message, duration_ms: Date.now() - startTime }),
    });
    return { stored, error: e.message };
  }
}

async function discordInbox(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.status(202).json({ status: 'accepted', message: 'Discord inbox poll started' });
  runInbox().catch(err => console.error('Discord inbox error:', err.message));
}

module.exports = discordInbox;
module.exports.ownerRows = ownerRows;
module.exports.config = config;
module.exports.snowflakeTime = snowflakeTime;
module.exports.runInbox = runInbox;
