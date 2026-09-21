/**
 * Discord posting: three channels, embeds, no links.
 *
 * Owner redesign 2026-09-21. Every alert used to end with a bare site
 * link and Discord unfurled the site's preview card under each one,
 * crowding the channel. Now every post is a compact embed (a colored
 * card we control, one color per tier) with no link at all, and the
 * feed is split by cadence across three webhooks:
 *
 *   board     DISCORD_WEBHOOK_URL            morning board, tier entry alerts
 *   receipts  DISCORD_WEBHOOK_RECEIPTS_URL   nightly settled picks and the public record
 *   model     DISCORD_WEBHOOK_MODEL_URL      dial moves, directives, the Monday dial board
 *
 * A channel without its own webhook falls back to the board webhook so
 * the feed works from day one on one channel and separates the moment
 * the owner pastes the other two. No webhook at all means every call
 * is a silent no-op. Fail-soft: a Discord outage never breaks a cron.
 *
 * Tier alerts fire the FIRST time a pick reaches Strong Play or Sharp
 * Take, published straight there or promoted into it (owner 2026-08-22:
 * never on the way down, never twice for the same pick).
 */

'use strict';

const CHANNEL_ENV = {
  board: 'DISCORD_WEBHOOK_URL',
  receipts: 'DISCORD_WEBHOOK_RECEIPTS_URL',
  model: 'DISCORD_WEBHOOK_MODEL_URL',
};

// Discord's embed limits.
const LIMITS = { title: 256, description: 4096, fieldName: 256, fieldValue: 1024, footer: 2048, fields: 25, embedsPerMessage: 10 };

// One color per tier, brand orange for everything else.
const TIER_COLOR = {
  'Sharp Take': 0xf5a623,
  'Strong Play': 0x2ecc71,
  'Play': 0x3498db,
  'Lean': 0x95a5a6,
  'Leg': 0x9b59b6,
  'Trap': 0xe74c3c,
};
const BRAND_COLOR = 0xf5a623;

const ALERT_TIERS = new Set(['Sharp Take', 'Strong Play']);
const LADDER_RANK = { 'Lean': 0, 'Play': 1, 'Strong Play': 2, 'Sharp Take': 3 };
const TIER_EMOJI = { 'Sharp Take': '🦅', 'Strong Play': '📈' };

function webhookFor(channel = 'board') {
  const own = process.env[CHANNEL_ENV[channel] || CHANNEL_ENV.board];
  if (own) return { url: own, fallback: false };
  const board = process.env[CHANNEL_ENV.board];
  if (board) return { url: board, fallback: channel !== 'board' };
  return { url: null, fallback: false };
}

function clip(text, limit) {
  const s = String(text ?? '');
  return s.length <= limit ? s : `${s.slice(0, limit - 1)}…`;
}

/**
 * Pure gate: alert on the pick's first-ever entry into an alert tier,
 * reached from below or published there fresh. existingHistory is the
 * row's tier_history BEFORE this revision.
 */
function shouldAlertTierEntry(newTier, previousTier, existingHistory) {
  if (!ALERT_TIERS.has(newTier)) return false;
  if (previousTier === newTier) return false;
  if (previousTier != null && (LADDER_RANK[previousTier] ?? -1) > (LADDER_RANK[newTier] ?? -1)) {
    return false;
  }
  if (Array.isArray(existingHistory) && existingHistory.some(h => h && h.tier === newTier)) {
    return false;
  }
  return true;
}

function kickoffMt(gameDate) {
  if (!gameDate) return null;
  try {
    return new Date(gameDate).toLocaleString('en-US', {
      timeZone: 'America/Denver', weekday: 'short', hour: 'numeric', minute: '2-digit',
    }) + ' MT';
  } catch {
    return null;
  }
}

/** Pure formatter: the tier alert as one embed. No link. */
function formatTierAlert({ tier, pick, sport, homeTeam, awayTeam, gameDate, edgePp, previousTier }) {
  const matchup = homeTeam && awayTeam ? `${awayTeam} @ ${homeTeam}` : null;
  const edge = edgePp != null ? `Edge ${edgePp}pp` : null;
  const path = previousTier ? `promoted from ${previousTier}` : `published straight to ${tier}`;
  const lines = [
    [sport, matchup, kickoffMt(gameDate)].filter(Boolean).join(' · '),
    [edge, path].filter(Boolean).join(' · '),
  ].filter(Boolean);
  return {
    title: clip(`${TIER_EMOJI[tier] || '🦅'} ${tier} · ${pick}`, LIMITS.title),
    description: clip(lines.join('\n'), LIMITS.description),
    color: TIER_COLOR[tier] || BRAND_COLOR,
  };
}

/**
 * Build one embed per chunk of lines so a long section never truncates
 * mid pick. The first chunk carries the title, later chunks continue it.
 */
function embedsFromLines(title, lines, { color = BRAND_COLOR, footer = null, limit = 4000 } = {}) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const line of lines) {
    const l = String(line);
    if (current.length && size + l.length + 1 > limit) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(l);
    size += l.length + 1;
  }
  if (current.length || chunks.length === 0) chunks.push(current);
  return chunks.map((chunk, i) => {
    const e = {
      title: clip(i === 0 ? title : `${title} (continued)`, LIMITS.title),
      description: clip(chunk.join('\n'), LIMITS.description),
      color,
    };
    if (footer && i === chunks.length - 1) e.footer = { text: clip(footer, LIMITS.footer) };
    return e;
  });
}

/** Flattens embeds to plain text: what a reader sees, for tests and logs. */
function embedText(embeds) {
  return (embeds || []).map(e => [
    e.title, e.description,
    ...(e.fields || []).map(f => `${f.name}: ${f.value}`),
    e.footer?.text,
  ].filter(Boolean).join('\n')).join('\n\n');
}

/**
 * Discord caps a message at 2000 characters. Split long content on line
 * boundaries so a full board never truncates mid-pick.
 */
function splitDiscordContent(content, limit = 1900) {
  const chunks = [];
  let current = '';
  for (const line of String(content).split('\n')) {
    if (current && current.length + line.length + 1 > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

/** Posts plain content to a channel, chunking as needed. Resolves always. */
async function sendDiscordMessage(content, channel = 'board') {
  const { url, fallback } = webhookFor(channel);
  if (!url) return { sent: false, reason: 'no webhook configured', channel };
  try {
    const chunks = splitDiscordContent(content);
    let ok = true;
    let status = null;
    for (const chunk of chunks) {
      const res = await postJson(url, { content: chunk });
      ok = ok && res.ok;
      status = res.status;
    }
    return { sent: ok, status, messages: chunks.length, channel, fallback };
  } catch (e) {
    return { sent: false, reason: e.message, channel };
  }
}

/**
 * Posts embeds to a channel, ten per message. Every embed is clipped to
 * Discord's limits so a long board never 400s. Resolves always.
 */
async function sendDiscordEmbeds(embeds, channel = 'board') {
  const { url, fallback } = webhookFor(channel);
  if (!url) return { sent: false, reason: 'no webhook configured', channel };
  const list = (Array.isArray(embeds) ? embeds : [embeds]).filter(Boolean).map(sanitizeEmbed);
  if (list.length === 0) return { sent: false, reason: 'nothing to post', channel };
  try {
    let ok = true;
    let status = null;
    let messages = 0;
    for (let i = 0; i < list.length; i += LIMITS.embedsPerMessage) {
      const res = await postJson(url, { embeds: list.slice(i, i + LIMITS.embedsPerMessage) });
      ok = ok && res.ok;
      status = res.status;
      messages++;
    }
    return { sent: ok, status, messages, embeds: list.length, channel, fallback };
  } catch (e) {
    return { sent: false, reason: e.message, channel };
  }
}

function sanitizeEmbed(e) {
  const out = { color: Number.isFinite(e.color) ? e.color : BRAND_COLOR };
  if (e.title) out.title = clip(e.title, LIMITS.title);
  if (e.description) out.description = clip(e.description, LIMITS.description);
  if (Array.isArray(e.fields) && e.fields.length) {
    out.fields = e.fields.slice(0, LIMITS.fields).map(f => ({
      name: clip(f.name || '​', LIMITS.fieldName),
      value: clip(f.value || '​', LIMITS.fieldValue),
      inline: Boolean(f.inline),
    }));
  }
  if (e.footer?.text) out.footer = { text: clip(e.footer.text, LIMITS.footer) };
  if (e.timestamp) out.timestamp = e.timestamp;
  return out;
}

/** Posts a tier-entry alert to the board channel. Resolves always. */
async function sendTierAlert(details) {
  return sendDiscordEmbeds([formatTierAlert(details)], 'board');
}

module.exports = {
  shouldAlertTierEntry,
  formatTierAlert,
  sendTierAlert,
  sendDiscordMessage,
  sendDiscordEmbeds,
  splitDiscordContent,
  embedsFromLines,
  embedText,
  webhookFor,
  clip,
  TIER_COLOR,
  BRAND_COLOR,
  LIMITS,
};
