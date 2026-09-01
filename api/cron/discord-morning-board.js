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

// Every line carries the matchup. A total reads as "Over 7.5" with no
// game attached, which the owner flagged as useless in the channel
// (2026-09-01, the first band-aware totals morning), and even for team
// picks the opponent is the context a reader wants.
function matchupOf(row) {
  return row.away_team && row.home_team ? `${row.away_team} @ ${row.home_team}` : null;
}

function pickLine(row) {
  const parts = [row.pick, matchupOf(row), row.sport];
  if (row.edge_pp != null) parts.push(`${row.edge_pp}pp`);
  const t = gameTimeMt(row.game_date);
  if (t) parts.push(t);
  return `• ${parts.filter(Boolean).join(' · ')}`;
}

/** Pure formatter so the message shape is testable. */
function formatMorningBoard(rows, dateLabel, gimmes = []) {
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
    lines.push('', '**Legs · the gimmes, 65% or better to hit, parlay material**');
    for (const r of legs.sort((a, b) => (b.model_prob ?? 0) - (a.model_prob ?? 0))) {
      const prob = r.model_prob != null ? `${Math.round(r.model_prob * 100)}% to hit` : null;
      lines.push(`• ${[r.pick, matchupOf(r), r.sport, prob, gameTimeMt(r.game_date)].filter(Boolean).join(' · ')}`);
    }
  }
  // Owner call 2026-08-25: on a day with no bet-signal tier, say so
  // plainly and hand the channel the day's high percenters. These are
  // PRESENTATION ONLY: board reads where a heavy market favorite has the
  // model's agreement. They are not picks, never published, never graded.
  const hasBetSignal = (byTier.get('Sharp Take')?.length || 0) > 0
    || (byTier.get('Strong Play')?.length || 0) > 0;
  if (!hasBetSignal && (gimmes || []).length) {
    anything = true;
    lines.push('', 'No Sharp Take edge on the board today. These are not plays, but the market prices them as the day’s highest percenters and the model agrees with the price:');
    for (const g of gimmes) {
      const pct = `${Math.round(g.implied * 100)}% implied`;
      lines.push(`• ${[g.pick, matchupOf(g), g.sport, pct, gameTimeMt(g.game_date)].filter(Boolean).join(' · ')}`);
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

// Shadow sports never reach the record, so they never reach this list.
const NON_PUBLISHED_SPORTS = new Set(['NFL', 'NCAAF', 'EPL', 'MLS', 'Soccer', 'World Cup', 'Champions League', 'Copa America', 'Euros']);

function fairImplied(ml) {
  const n = Number(ml);
  if (!Number.isFinite(n) || n === 0) return null;
  const raw = n < 0 ? -n / (-n + 100) : 100 / (n + 100);
  // Same flat two-way devig approximation the shadow grader uses.
  return raw / 1.04;
}

/**
 * The day's high percenters for the no-edge message: board reads where a
 * heavy market favorite (60% or better fair implied) has the model at or
 * above the price. Presentation only, never published, never graded.
 * Games already carrying any published row are excluded so this never
 * duplicates a pick, leg, or trap the message already shows.
 */
async function fetchGimmes(publishedRows, today, windowStart, windowEnd) {
  try {
    const { data, error } = await supabase
      .from('game_analysis')
      .select('sport, home_team, away_team, game_date, calc_home_prob, calc_away_prob, moneyline_home, moneyline_away')
      .gte('game_date', windowStart)
      .lt('game_date', windowEnd);
    if (error || !Array.isArray(data)) return [];

    const covered = new Set((publishedRows || []).map(r => `${r.home_team}|${r.away_team}`));
    const gimmes = [];
    for (const g of data) {
      if (siteDay(g.game_date) !== today) continue;
      if (NON_PUBLISHED_SPORTS.has(g.sport)) continue;
      if (covered.has(`${g.home_team}|${g.away_team}`)) continue;
      if (new Date(g.game_date) <= new Date()) continue;
      const homeImp = fairImplied(g.moneyline_home);
      const awayImp = fairImplied(g.moneyline_away);
      if (homeImp == null || awayImp == null) continue;
      const homeSide = homeImp >= awayImp;
      const implied = homeSide ? homeImp : awayImp;
      const model = homeSide ? Number(g.calc_home_prob) : Number(g.calc_away_prob);
      const ml = homeSide ? g.moneyline_home : g.moneyline_away;
      if (implied < 0.60 || !Number.isFinite(model) || model < implied) continue;
      gimmes.push({
        pick: `${homeSide ? g.home_team : g.away_team} ML ${ml > 0 ? `+${ml}` : ml}`,
        sport: g.sport,
        implied,
        game_date: g.game_date,
        home_team: g.home_team,
        away_team: g.away_team,
      });
    }
    return gimmes.sort((a, b) => b.implied - a.implied).slice(0, 5);
  } catch {
    return [];
  }
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
    .select('sport, home_team, away_team, pick, edge_pp, tier, game_date, model_prob')
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
  const gimmes = await fetchGimmes(rows, today, windowStart, windowEnd);
  const result = await sendDiscordMessage(formatMorningBoard(rows || [], dateLabel, gimmes));

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
