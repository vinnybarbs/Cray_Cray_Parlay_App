/**
 * Short narration for the NFL prop reads the site shows (owner
 * 2026-10-12: the prop card's explanation expands into a few sentences
 * in the same voice as the game research). The math already picked the
 * side. The model only explains it from the numbers we hand it.
 *
 * Runs at the end of every analyze-nfl-props read, and on its own via
 *   POST /cron/analyze-nfl-props?secret=...&mode=narrate
 *
 * Only reads the site shows get narrated (api/props.js showable), only
 * games that have not started, and only when the read has no narration
 * yet or its side or line moved since the text was written. Cost is
 * logged to cron_job_logs as narrate-nfl-props for the monthly audit.
 */

'use strict';

const { getClient: getClaude, MODELS, WRITING_STYLE, extractJson } = require('../../lib/services/claude.js');
const { showable, describe, attachHistory } = require('../props.js');

// Most reads a single run narrates. A Sunday slate shows about 250, so
// the twice daily read clears a full slate within a day.
const MAX_PER_RUN = 120;
const CONCURRENCY = 4;
// Standard Sonnet rates per million tokens, for the cost log.
const RATE_IN = 3;
const RATE_OUT = 15;

const MARKET_WORDS = {
  player_receptions: 'receptions',
  player_reception_yds: 'receiving yards',
  player_rush_yds: 'rushing yards',
  player_pass_yds: 'passing yards',
  player_pass_tds: 'passing TDs',
  player_anytime_td: 'touchdowns (rushing plus receiving)',
};

const round1 = (x) => Math.round(Number(x) * 10) / 10;

/** Does this read need (new) narration? Pure. */
function needsNarration(r) {
  if (!showable(r)) return false;
  if (!r.narration || !r.narration_detail) return true;
  if (r.narration_side !== r.v2_side) return true;
  return Number(r.narration_line) !== Number(r.line);
}

/**
 * The facts block for one read: only numbers we actually hold, so the
 * model has nothing to invent from. Pure.
 */
function factLines(r, history, redzone) {
  const f = r.v2_factors || {};
  const base = r.factors || {};
  const td = r.market === 'player_anytime_td';
  const sideWord = td ? 'to score' : r.v2_side;
  const lines = [];
  lines.push(`PROP: ${describe(r)}. Our side: ${sideWord}${td ? '' : ` ${Number(r.line)}`}.`);
  lines.push(`GAME: ${r.away_team} at ${r.home_team}. Player's team: ${f.team || 'unknown'}, opponent: ${f.opponent || 'unknown'}.`);
  const price = r.v2_side === 'over' ? r.consensus_over_price : r.consensus_under_price;
  if (price != null) lines.push(`PRICE on our side: ${Number(price) > 0 ? '+' : ''}${Number(price)}.`);
  if (!td && r.v2_mean != null) lines.push(`OUR PROJECTION: ${round1(r.v2_mean)} ${MARKET_WORDS[r.market]}.`);
  if (base.long_mean != null && base.recent_mean != null) {
    lines.push(`AVERAGES: ${round1(base.long_mean)} per game over the player's longer sample, ${round1(base.recent_mean)} per game recently.`);
  }
  if (history && history.games && history.games.length > 0) {
    const games = history.games.map(g => `${g.value}${g.opponent ? ` vs ${g.opponent}` : ''}`).join(', ');
    // Spell out both directions. "Cleared under 4.5 in 3" read to the
    // model as "cleared 4.5 in 3" and the Darnold under (2026-10-13) was
    // sold on a log that went over 7 times in 10.
    const n = history.games.length;
    const overs = history.games.filter(g => g.value > Number(r.line)).length;
    const unders = history.games.filter(g => g.value < Number(r.line)).length;
    const verdict = td
      ? `Scored in ${history.hits} of them.`
      : `Went OVER ${Number(r.line)} in ${overs} of ${n} and UNDER in ${unders} of ${n}. Our side (${r.v2_side}) hit in ${history.hits} of ${n}.`;
    lines.push(`LAST ${n} GAMES, oldest first: ${games}. ${verdict}`);
    if (history.hits * 2 < n) lines.push('NOTE: the recent log mostly went AGAINST our side. Say so plainly and lean on the other facts. Do not present the log as support.');
  }
  if (f.opp_ratio != null && f.opp_games >= 4) {
    const pct = Math.round((Number(f.opp_ratio) - 1) * 100);
    if (Math.abs(pct) >= 3) lines.push(`MATCHUP: ${f.opponent} allows ${Math.abs(pct)} percent ${pct > 0 ? 'more' : 'fewer'} ${MARKET_WORDS[r.market]} than an average defense.`);
  }
  if (f.team_implied != null) lines.push(`GAME SCRIPT: the betting market expects the player's team to score about ${round1(f.team_implied)} points.`);
  if (f.wind_mph != null && Number(f.wind_mph) >= 12) lines.push(`WEATHER: wind around ${Math.round(Number(f.wind_mph))} mph.`);
  if (f.status) lines.push(`INJURY STATUS: ${f.status}.`);
  if (redzone && redzone.games > 0) {
    const parts = [];
    if (redzone.rz_carries > 0) parts.push(`${redzone.rz_carries} red zone carries${redzone.team_rz_carries > 0 ? ` of the team's ${redzone.team_rz_carries}` : ''}`);
    if (redzone.rz_targets > 0) parts.push(`${redzone.rz_targets} red zone targets${redzone.team_rz_targets > 0 ? ` of the team's ${redzone.team_rz_targets}` : ''}`);
    if (redzone.gl_carries > 0) parts.push(`${redzone.gl_carries} goal line carries`);
    if (parts.length > 0) lines.push(`RED ZONE, last ${redzone.games} games: ${parts.join(', ')}.`);
  }
  return lines;
}

/** The full prompt for one read. Pure. */
function buildPrompt(r, history, redzone) {
  return `You write the "why" under a player prop on TrapHawk, a sports betting research app. The math already picked the side. Explain it to a casual bettor in plain words, using only the facts below.

${factLines(r, history, redzone).join('\n')}

Write two things:
1. "narration": 2 or 3 short sentences, under 60 words total. Lead with the strongest reason, usually the recent games against this line or the matchup.
2. "detail": the longer read behind a "Read more" button, two short paragraphs, 110 to 170 words total. Paragraph one: the player's role and recent form, walking through the game log and any red zone usage. Paragraph two: this game, the matchup, game script and weather where listed, then one honest sentence on what would make this read miss.

RULES:
- Cite specific numbers from the facts. NEVER invent a number, stat, injury, role, coach decision or trend that is not listed above.
- Do not mention probabilities, edges, percentages of confidence, models or "our projection". Talk about the player and the game.
- Do not tell the reader to bet, and do not mention any sportsbook.
- Count and list game values exactly as given. Do not describe where we are in the season (no "late season" or "early season").
- ${WRITING_STYLE}

Respond in exactly this JSON format, no markdown, paragraphs in "detail" separated by a blank line:
{"narration": "...", "detail": "..."}`;
}

async function loadCandidates(supabase) {
  const { data, error } = await supabase.from('prop_reads')
    .select('id, market, player_key, player_name, line, v2_side, v2_edge_pp, v2_mean, v2_factors, factors, consensus_over_price, consensus_under_price, home_team, away_team, commence_time, narration, narration_detail, narration_side, narration_line')
    .gt('commence_time', new Date().toISOString())
    .gte('v2_edge_pp', 4)
    .order('v2_edge_pp', { ascending: false })
    .limit(800);
  if (error) throw error;
  return (data || []).filter(needsNarration).slice(0, MAX_PER_RUN);
}

async function loadHistory(supabase, rows) {
  const keys = [...new Set(rows.map(r => r.player_key).filter(Boolean))];
  if (keys.length === 0) return new Map();
  const { data, error } = await supabase.from('nfl_player_game_stats')
    .select('player_key, season, week, team, opponent, receptions, receiving_yards, rushing_yards, passing_yards, passing_tds, rushing_tds, receiving_tds')
    .in('player_key', keys)
    .order('season', { ascending: false }).order('week', { ascending: false })
    .limit(keys.length * 25);
  if (error) return new Map();
  // attachHistory works on the API's slim shape.
  const slimmed = rows.map(r => ({ id: r.id, playerKey: r.player_key, market: r.market, side: r.v2_side, line: r.line != null ? Number(r.line) : null }));
  return new Map(attachHistory(slimmed, data || []).map(p => [p.id, p.history]));
}

async function narrateOne(claude, r, history, redzone) {
  const data = await claude.messages.create({
    model: MODELS.NARRATION,
    max_tokens: 900,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: buildPrompt(r, history, redzone) }],
  });
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  const parsed = extractJson(text);
  const narration = parsed && typeof parsed.narration === 'string' ? parsed.narration.trim() : null;
  const detail = parsed && typeof parsed.detail === 'string' ? parsed.detail.trim() : null;
  return { narration, detail, usage: data.usage || {} };
}

/**
 * Red zone usage over each player's last REDZONE_GAMES games, keyed by
 * player_key. Fail soft: an empty map only drops the line from the facts.
 */
const REDZONE_GAMES = 4;
async function loadRedzone(supabase, rows) {
  const keys = [...new Set(rows.map(r => r.player_key).filter(Boolean))];
  if (keys.length === 0) return new Map();
  const { data: ids, error } = await supabase.from('nfl_player_game_stats')
    .select('player_key, player_id').in('player_key', keys).not('player_id', 'is', null).limit(keys.length * 25);
  if (error || !ids) return new Map();
  const keyById = new Map(ids.map(x => [x.player_id, x.player_key]));
  if (keyById.size === 0) return new Map();
  const { data: rz, error: rzErr } = await supabase.from('nfl_player_redzone')
    .select('player_id, season, week, rz_carries, gl_carries, rz_targets, team_rz_carries, team_rz_targets')
    .in('player_id', [...keyById.keys()])
    .order('season', { ascending: false }).order('week', { ascending: false })
    .limit(keyById.size * REDZONE_GAMES * 2);
  if (rzErr || !rz) return new Map();
  return summarizeRedzone(rz, keyById);
}

/** Sum the last REDZONE_GAMES rows per player. Rows newest first. Pure. */
function summarizeRedzone(rows, keyById) {
  const out = new Map();
  for (const g of rows) {
    const key = keyById.get(g.player_id);
    if (!key) continue;
    const acc = out.get(key) || { games: 0, rz_carries: 0, gl_carries: 0, rz_targets: 0, team_rz_carries: 0, team_rz_targets: 0 };
    if (acc.games >= REDZONE_GAMES) continue;
    acc.games++;
    for (const k of ['rz_carries', 'gl_carries', 'rz_targets', 'team_rz_carries', 'team_rz_targets']) acc[k] += Number(g[k]) || 0;
    out.set(key, acc);
  }
  return out;
}

/**
 * Narrate every shown upcoming read that needs it. Fail soft per read.
 * Returns a summary that the caller logs.
 */
async function narrateProps(supabase) {
  const started = Date.now();
  const summary = { candidates: 0, narrated: 0, failed: 0, input_tokens: 0, output_tokens: 0, est_cost_usd: 0, errors: [] };
  const claude = getClaude();
  if (!claude) { summary.errors.push('Server missing ANTHROPIC_API_KEY'); return summary; }

  const rows = await loadCandidates(supabase);
  summary.candidates = rows.length;
  if (rows.length === 0) return summary;
  const history = await loadHistory(supabase, rows);
  const redzone = await loadRedzone(supabase, rows).catch(() => new Map());

  let next = 0;
  async function worker() {
    while (next < rows.length) {
      const r = rows[next++];
      try {
        const { narration, detail, usage } = await narrateOne(claude, r, history.get(r.id), redzone.get(r.player_key));
        summary.input_tokens += usage.input_tokens || 0;
        summary.output_tokens += usage.output_tokens || 0;
        if (!narration) throw new Error('unparseable narration');
        const { error } = await supabase.from('prop_reads').update({
          narration,
          narration_detail: detail,
          narration_side: r.v2_side,
          narration_line: r.line,
          narration_model: MODELS.NARRATION,
          narrated_at: new Date().toISOString(),
        }).eq('id', r.id);
        if (error) throw error;
        summary.narrated++;
      } catch (err) {
        summary.failed++;
        if (summary.errors.length < 5) summary.errors.push(`${r.id}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  summary.est_cost_usd = Math.round(((summary.input_tokens * RATE_IN + summary.output_tokens * RATE_OUT) / 1e6) * 10000) / 10000;
  summary.model = MODELS.NARRATION;
  summary.duration_ms = Date.now() - started;
  return summary;
}

module.exports = { narrateProps, needsNarration, buildPrompt, factLines, summarizeRedzone, MAX_PER_RUN };
