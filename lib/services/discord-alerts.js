/**
 * Sharp Take alerts to Discord.
 *
 * One webhook, one message per pick, fired the FIRST time a pick reaches
 * Sharp Take: published straight there in a sweep, or promoted into it
 * during the day. Never on the way down (owner call 2026-08-22: a
 * demotion after the bet is placed is unusable news), and never twice
 * for the same pick even if its tier oscillates, which tier_history
 * makes checkable.
 *
 * Configured entirely by the DISCORD_WEBHOOK_URL env var on Railway.
 * Unset means every call is a silent no-op, so this ships dark and goes
 * live the moment the owner pastes a webhook. Fail-soft: a Discord
 * outage must never break the publish path.
 */

'use strict';

const SITE_URL = 'https://traphawk.io/#/digest';

/**
 * Pure gate: alert only on the pick's first entry into Sharp Take.
 * existingHistory is the row's tier_history BEFORE this revision.
 */
function shouldAlertSharpTake(newTier, previousTier, existingHistory) {
  if (newTier !== 'Sharp Take') return false;
  if (previousTier === 'Sharp Take') return false;
  if (Array.isArray(existingHistory) && existingHistory.some(h => h && h.tier === 'Sharp Take')) {
    return false;
  }
  return true;
}

/** Pure formatter: the Discord message content. */
function formatSharpTakeAlert({ pick, sport, homeTeam, awayTeam, gameDate, edgePp, previousTier }) {
  const lines = [`🦅 **Sharp Take** · ${pick}`];
  const kickoff = gameDate
    ? new Date(gameDate).toLocaleString('en-US', {
        timeZone: 'America/Denver', weekday: 'short', hour: 'numeric', minute: '2-digit',
      }) + ' MT'
    : null;
  const matchup = homeTeam && awayTeam ? `${awayTeam} @ ${homeTeam}` : null;
  lines.push([sport, matchup, kickoff].filter(Boolean).join(' · '));
  const edge = edgePp != null ? `Edge ${edgePp}pp` : null;
  const path = previousTier
    ? `promoted from ${previousTier}`
    : 'published straight to Sharp Take';
  lines.push([edge, path].filter(Boolean).join(' · '));
  lines.push(SITE_URL);
  return lines.join('\n');
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

/** Posts content to the webhook, chunking as needed. Resolves always. */
async function sendDiscordMessage(content) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return { sent: false, reason: 'no webhook configured' };
  try {
    const chunks = splitDiscordContent(content);
    let ok = true;
    let status = null;
    for (const chunk of chunks) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: chunk }),
      });
      ok = ok && res.ok;
      status = res.status;
    }
    return { sent: ok, status, messages: chunks.length };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

/** Posts a Sharp Take alert. Resolves always; never throws. */
async function sendSharpTakeAlert(details) {
  return sendDiscordMessage(formatSharpTakeAlert(details));
}

module.exports = {
  shouldAlertSharpTake,
  formatSharpTakeAlert,
  sendSharpTakeAlert,
  sendDiscordMessage,
  splitDiscordContent,
};
