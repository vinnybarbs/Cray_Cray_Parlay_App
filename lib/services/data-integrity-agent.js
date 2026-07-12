/**
 * Data-integrity agent — Claude-powered coordinator + web-search sub-agents.
 *
 * Why this exists: the July 2026 records incident. The model graded the
 * 48-45 White Sox as a 9-11 team and the public tile published it. The data
 * pipeline had the truth in a different column, and nothing cross-checked.
 * This agent is the cross-check, plus coverage for the two chronically thin
 * inputs: injuries and weather.
 *
 * Sub-agents (each one Claude API call with the server-side web_search tool):
 *   1. records-verifier — samples today's teams, verifies our standings
 *      records against official/reputable sources, reports mismatches.
 *   2. injury-scout    — per-slate sweep of injury reports for teams with
 *      games on the board; returns structured player/status rows.
 *   3. weather-scout   — forecast for today's outdoor games; returns
 *      structured wind/temp/precip rows (totals-relevant).
 *
 * Results land in agent_intel (backend-only, RLS). Findings that indicate a
 * data problem (record mismatches) also log to cron_job_logs so the admin
 * dashboard surfaces them. pre-analyze-games injects fresh intel into the
 * narration context; the math edge is untouched until a signal earns its way
 * in through the weekly calibration.
 *
 * Model: claude-opus-4-8 with adaptive thinking (default on the API when
 * thinking is set to adaptive) and the web_search_20260209 server tool.
 * Requires ANTHROPIC_API_KEY. Fails soft: no key, no run, pipeline unharmed.
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');

// Model split by how much judgment each role needs. The injury scout makes
// real relevance/recency calls against messy web content, so it gets the top
// model. Records and weather are mechanical lookups — Sonnet handles them at
// near-Opus quality for 40% of the price.
const MODEL_JUDGMENT = 'claude-opus-4-8';
const MODEL_LOOKUP = 'claude-sonnet-5';
const MAX_GAMES = 14;          // per run — cost control
const MAX_PAUSE_RESUMES = 6;   // pause_turn continuation cap

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  // 20-min request timeout (ms). The SDK default is 10 min, which the
  // records verifier exceeded on 2026-07-11 (8 web searches in one turn) —
  // the run died with "Request timed out" and mismatches=0 meant "absence",
  // not "verified clean".
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 20 * 60 * 1000 });
}

/**
 * One sub-agent call: web search enabled, JSON-only output, pause_turn
 * continuation handled. Returns the parsed JSON object or throws.
 */
async function runSubAgent(client, { label, system, user, maxSearches = 6, effort = 'medium', model = MODEL_LOOKUP }) {
  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches }];
  let messages = [{ role: 'user', content: user }];
  let response = null;

  const callOnce = async (msgs) => {
    let resp = null;
    for (let attempt = 0; attempt <= MAX_PAUSE_RESUMES; attempt++) {
      resp = await client.messages.create({
        model,
        max_tokens: 12000,
        system,
        thinking: { type: 'adaptive' },
        output_config: { effort },
        tools,
        messages: msgs,
      });
      if (resp.stop_reason !== 'pause_turn') break;
      // Server-side tool loop paused — resend with the partial turn appended
      // and the API resumes where it left off.
      msgs = [
        { role: 'user', content: user },
        { role: 'assistant', content: resp.content },
      ];
    }
    return resp;
  };

  const extractJson = (resp) => {
    const text = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  };

  response = await callOnce(messages);
  if (response.stop_reason === 'refusal') {
    throw new Error(`${label}: request refused`);
  }

  let parsed = extractJson(response);
  if (parsed === null) {
    // First production run: the injury scout finished a long web-search turn
    // with prose and no JSON. One nudge turn fixes it far more often than not.
    const nudged = await callOnce([
      { role: 'user', content: user },
      { role: 'assistant', content: response.content },
      { role: 'user', content: 'Now output ONLY the JSON object described in the instructions — nothing else.' },
    ]);
    parsed = extractJson(nudged);
  }
  if (parsed === null) {
    throw new Error(`${label}: no JSON object in response`);
  }
  return parsed;
}

// Every sub-agent gets explicit date grounding. The first production run
// (2026-07-11) flagged correct mid-2026 records as "stale" because the
// model anchored on 2025 as the current season and compared against
// completed-season summary pages. Agents need a calendar.
function dateContext() {
  const now = new Date();
  const season = now.getFullYear();
  return `Today's date is ${now.toDateString()}. The ${season} seasons are IN PROGRESS — mid-season records are expected and normal. Verify against CURRENT ${season} standings and reports only. A page showing a final record for a completed prior season (e.g. ${season - 1}) is the WRONG page — do not compare against it.`;
}

const JSON_RULES = `Your final message must END with a single JSON object — no markdown fences, no prose after the closing brace. If you could not verify something, omit it rather than guessing. Include a source URL or site name for every item you report.`;

async function verifyRecords(client, games) {
  const teams = games.slice(0, 8).map((g) => ({
    matchup: `${g.away_team} @ ${g.home_team}`,
    our_records: { [g.home_team]: g.home_record, [g.away_team]: g.away_record },
  }));
  const system = `You are a sports data auditor. ${dateContext()} Verify win-loss records against official or first-rate sources showing LIVE current-season standings (league official sites, ESPN standings pages). Records move daily. Sanity-check plausibility: a mid-season record's games played should roughly match the calendar position of the season. ${JSON_RULES}`;
  const user = `Here are the season records our database will display today. Verify each team's record with web search and report every mismatch.

${JSON.stringify(teams, null, 2)}

Return: {"checked": <int>, "mismatches": [{"team": str, "ours": "W-L", "actual": "W-L", "source": str}]}. An off-by-one from a game that ended within the last 12 hours is still a mismatch — report it with a note field.`;
  return runSubAgent(client, { label: 'records-verifier', system, user, maxSearches: 8 });
}

async function scoutInjuries(client, games) {
  const slate = games.map((g) => `${g.away_team} @ ${g.home_team} (${g.sport})`).join('\n');
  const system = `You are an injury-report scout for a sports analytics product. ${dateContext()} Find CURRENT injury and lineup news for the teams below from reputable sources (official team sites, league injury reports, ESPN, Rotowire, beat reporters). Ignore stale reports from prior weeks or seasons. ${JSON_RULES}`;
  const user = `Games on today's board:

${slate}

Search for today's injury reports covering these teams. Return: {"injuries": [{"team": str, "player": str, "status": "out"|"doubtful"|"questionable"|"day-to-day"|"returning", "note": str, "source": str}]}. Include notable RETURNS from injury too — a star coming back moves lines as much as one sitting out. Skip minor-league and irrelevant depth pieces.`;
  return runSubAgent(client, { label: 'injury-scout', system, user, maxSearches: 10, effort: 'high', model: MODEL_JUDGMENT });
}

async function scoutWeather(client, games) {
  const slate = games.map((g) => {
    const t = g.game_date ? new Date(g.game_date).toISOString() : 'today';
    return `${g.away_team} @ ${g.home_team} (${g.sport}, ${t})`;
  }).join('\n');
  const system = `You are a game-day weather scout for a sports analytics product. ${dateContext()} Forecast conditions at the HOME team's stadium at game time. Note retractable/closed roofs — weather is irrelevant indoors. Wind direction relative to the field matters for baseball totals (blowing out, blowing in, cross). Most MLB parks are outdoor: an empty result for a full summer slate is almost certainly wrong — search harder before returning empty. ${JSON_RULES}`;
  const user = `Games on today's board:

${slate}

For each OUTDOOR game, search the forecast at the stadium for game time. Return: {"weather": [{"game": "Away @ Home", "stadium": str, "roof": "none"|"open"|"closed"|"dome", "temp_f": num, "wind_mph": num, "wind_effect": "out"|"in"|"cross"|"calm"|"unknown", "precip_chance_pct": num, "note": str, "source": str}]}. Skip domes and closed roofs entirely (or mark roof accordingly with no forecast).`;
  return runSubAgent(client, { label: 'weather-scout', system, user, maxSearches: 10 });
}

/**
 * Coordinator. Pulls the current board, fans out the sub-agents, persists
 * everything to agent_intel, and logs a summary (plus any record-mismatch
 * findings) to cron_job_logs.
 */
async function runDataIntegritySweep(supabase) {
  const log = async (status, details) => {
    try {
      await supabase.from('cron_job_logs').insert({ job_name: 'data_integrity_sweep', status, details });
    } catch { /* best-effort */ }
  };

  const client = getClient();
  if (!client) {
    await log('skipped', { reason: 'ANTHROPIC_API_KEY not set' });
    return { skipped: true, reason: 'ANTHROPIC_API_KEY not set' };
  }

  const from = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const to = new Date(Date.now() + 36 * 3600 * 1000).toISOString();
  const { data: games, error } = await supabase
    .from('game_analysis')
    .select('game_key, sport, home_team, away_team, game_date, home_record, away_record, edges')
    .gte('game_date', from)
    .lte('game_date', to)
    .not('edges', 'is', null)
    .order('game_date', { ascending: true })
    .limit(MAX_GAMES);

  if (error) throw new Error(`board query failed: ${error.message}`);
  if (!games || games.length === 0) {
    await log('skipped', { reason: 'no games with edges in window' });
    return { skipped: true, reason: 'no games with edges in window' };
  }

  const runId = new Date().toISOString();
  await log('started', { run_id: runId, games_on_board: games.length });
  const results = await Promise.allSettled([
    verifyRecords(client, games),
    scoutInjuries(client, games),
    scoutWeather(client, games),
  ]);
  const [recordsR, injuriesR, weatherR] = results;

  const rows = [];
  const gameByMatchup = new Map(games.map((g) => [`${g.away_team} @ ${g.home_team}`, g]));
  const teamToGame = new Map();
  for (const g of games) {
    teamToGame.set(g.home_team.toLowerCase(), g);
    teamToGame.set(g.away_team.toLowerCase(), g);
  }

  if (recordsR.status === 'fulfilled') {
    for (const m of recordsR.value.mismatches || []) {
      const g = teamToGame.get((m.team || '').toLowerCase());
      rows.push({
        run_id: runId, kind: 'record_mismatch', severity: 'high',
        game_key: g?.game_key ?? null, team: m.team, payload: m,
      });
    }
    rows.push({
      run_id: runId, kind: 'record_check_summary', severity: 'info',
      game_key: null, team: null,
      payload: { checked: recordsR.value.checked ?? null, mismatches: (recordsR.value.mismatches || []).length },
    });
  }

  if (injuriesR.status === 'fulfilled') {
    for (const inj of injuriesR.value.injuries || []) {
      const g = teamToGame.get((inj.team || '').toLowerCase());
      rows.push({
        run_id: runId, kind: 'injury', severity: 'info',
        game_key: g?.game_key ?? null, team: inj.team, payload: inj,
      });
    }
  }

  if (weatherR.status === 'fulfilled') {
    for (const w of weatherR.value.weather || []) {
      const g = gameByMatchup.get(w.game) ?? null;
      rows.push({
        run_id: runId, kind: 'weather', severity: 'info',
        game_key: g?.game_key ?? null, team: null, payload: w,
      });
    }
  }

  for (const r of results) {
    if (r.status === 'rejected') {
      rows.push({
        run_id: runId, kind: 'agent_error', severity: 'high',
        game_key: null, team: null, payload: { error: String(r.reason?.message || r.reason) },
      });
    }
  }

  if (rows.length > 0) {
    const { error: insErr } = await supabase.from('agent_intel').insert(rows);
    if (insErr) throw new Error(`agent_intel insert failed: ${insErr.message}`);
  }

  const summary = {
    run_id: runId,
    games_on_board: games.length,
    record_mismatches: rows.filter((r) => r.kind === 'record_mismatch').length,
    injuries_found: rows.filter((r) => r.kind === 'injury').length,
    weather_rows: rows.filter((r) => r.kind === 'weather').length,
    agent_errors: rows.filter((r) => r.kind === 'agent_error').length,
  };

  try {
    await supabase.from('cron_job_logs').insert({
      job_name: 'data_integrity_sweep',
      status: summary.record_mismatches > 0 || summary.agent_errors > 0 ? 'warning' : 'success',
      details: summary,
    });
  } catch { /* logging is best-effort */ }

  return summary;
}

/**
 * Fresh intel for one matchup, formatted for the analysis prompt. Returns ''
 * when there is nothing recent — callers can append unconditionally.
 */
async function getIntelContext(supabase, homeTeam, awayTeam) {
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from('agent_intel')
      .select('kind, team, payload')
      .gte('created_at', since)
      .or(`team.eq.${homeTeam},team.eq.${awayTeam},payload->>game.eq.${awayTeam} @ ${homeTeam}`)
      .in('kind', ['injury', 'weather', 'record_mismatch'])
      .limit(20);
    if (!data || data.length === 0) return '';

    const lines = [];
    for (const row of data) {
      const p = row.payload || {};
      if (row.kind === 'injury') {
        lines.push(`INJURY: ${p.team} — ${p.player} (${p.status}) ${p.note || ''} [${p.source || 'agent'}]`);
      } else if (row.kind === 'weather') {
        if (p.roof === 'closed' || p.roof === 'dome') continue;
        lines.push(`WEATHER: ${p.stadium || 'stadium'} — ${p.temp_f ?? '?'}F, wind ${p.wind_mph ?? '?'}mph ${p.wind_effect || ''}, precip ${p.precip_chance_pct ?? '?'}% ${p.note || ''}`);
      } else if (row.kind === 'record_mismatch') {
        lines.push(`DATA WARNING: our record for ${row.team} (${p.ours}) disagrees with ${p.source || 'sources'} (${p.actual}) — treat record-based claims cautiously.`);
      }
    }
    if (lines.length === 0) return '';
    return `\nVERIFIED INTEL (web-checked today by the data agent):\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

module.exports = { runDataIntegritySweep, getIntelContext };
