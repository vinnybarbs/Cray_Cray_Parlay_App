/**
 * CRON: NFL player prop reads, shadow first. Publishes nothing.
 *
 * Reads the synced props (player_props), builds a consensus per player
 * and market, prices it off the player's own game log
 * (nfl_player_game_stats) through lib/services/prop-edge.js with every
 * weight from the NFL_props dial board, and stores one row per prop in
 * prop_reads. ?mode=boxscore settles a read from the ESPN final box
 * score minutes after its game ends (owner 2026-10-16: "We can't go more
 * than a few hours without settling after a big game"). ?mode=grade
 * settles what is left against the nflverse stat lines once they land
 * (Tuesdays) and checks every box score grade against them. Grades never
 * re-flip: a disagreement is logged for the allow_regrade path, never
 * written. The weekly review judges the record;
 * nothing here reaches ai_suggestions, the digest, or alerts.
 *
 * Endpoints:
 *   POST /cron/analyze-nfl-props?secret=...            (read, default)
 *   POST /cron/analyze-nfl-props?secret=...&mode=grade (settle, nflverse)
 *   POST /cron/analyze-nfl-props?secret=...&mode=boxscore (settle, ESPN final)
 *   POST /cron/analyze-nfl-props?secret=...&mode=narrate (prop narration only)
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const propEdge = require('../../lib/services/prop-edge.js');
const { edgeTier } = require('../../lib/services/pick-grader.js');
const { teamAbbr, nameKey } = require('../../lib/services/nfl-inactives.js');
const { getWeatherForGames } = require('../../lib/services/weather-data.js');
const { narrateProps } = require('./narrate-nfl-props.js');
const liveStats = require('../../lib/services/live-prop-stats.js');

const SPORT = 'NFL';
const ODDS_SPORT = 'americanfootball_nfl';
const DIAL_SPORT = 'NFL_props';
const WINDOW_HOURS = 24 * 4;
// A week's stat file is in when this many player lines exist for it;
// a pending read whose player has none after that is a book void.
const WEEK_FILE_MIN_ROWS = 100;
const VOID_AFTER_HOURS = 24;

// ---------------------------------------------------------------------
// v2 shadow inputs (2026-09-14, owner: yards markets can become reliable
// with the right data). Every loader is fail soft: a missing input
// leaves its factor at 1 and the v2 read still prices.
// ---------------------------------------------------------------------

/** Opponent allowance table from this season and last, pooled per game. */
async function loadAllowance(season) {
  const rows = [];
  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('nfl_player_game_stats')
        .select('opponent, game_id, passing_yards, passing_tds, rushing_yards, receiving_yards, receptions')
        .in('season', [season, season - 1])
        .eq('season_type', 'REG')
        .order('id', { ascending: true })
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  } catch { /* fail soft: empty table, ratios stay 1 */ }
  return propEdge.allowanceTable(rows);
}

/** Player availability by name key: Sleeper status first, the week's official designation second. */
async function loadStatuses(season, week) {
  const byName = new Map();
  try {
    const { data } = await supabase.from('nfl_player_status').select('full_name, team, injury_status').not('injury_status', 'is', null);
    for (const r of data || []) byName.set(nameKey(r.full_name), { status: r.injury_status, team: r.team, source: 'sleeper' });
  } catch { /* optional */ }
  try {
    if (season != null && week != null) {
      const { data } = await supabase.from('nfl_injury_reports').select('full_name, team, report_status')
        .eq('season', season).eq('week', week).in('report_status', ['Out', 'Doubtful']);
      for (const r of data || []) {
        const k = nameKey(r.full_name);
        if (!byName.has(k)) byName.set(k, { status: r.report_status, team: r.team, source: 'nflverse' });
      }
    }
  } catch { /* optional */ }
  return byName;
}

/** Median spread and total per event from every book, keyed by home|away. */
async function loadGameLines(now, horizon) {
  const byGame = new Map();
  try {
    const { data } = await supabase
      .from('odds_cache')
      .select('home_team, away_team, market_type, outcomes')
      .eq('sport', ODDS_SPORT)
      .in('market_type', ['spreads', 'totals'])
      .gt('commence_time', now.toISOString())
      .lt('commence_time', horizon.toISOString());
    for (const r of data || []) {
      const k = `${r.home_team}|${r.away_team}`;
      if (!byGame.has(k)) byGame.set(k, { totals: [], homeSpreads: [] });
      const g = byGame.get(k);
      for (const o of r.outcomes || []) {
        if (r.market_type === 'totals' && o?.name === 'Over' && Number.isFinite(Number(o.point))) g.totals.push(Number(o.point));
        if (r.market_type === 'spreads' && o?.name === r.home_team && Number.isFinite(Number(o.point))) g.homeSpreads.push(Number(o.point));
      }
    }
  } catch { /* optional */ }
  const out = new Map();
  for (const [k, g] of byGame) {
    out.set(k, { total: propEdge.median(g.totals), homeSpread: propEdge.median(g.homeSpreads) });
  }
  return out;
}

/** Wind and roof per event, keyed by "away @ home". */
async function loadWeather(events) {
  const byGame = new Map();
  try {
    const { weather } = await getWeatherForGames(events.map(e => ({ home_team: e.home_team, away_team: e.away_team, game_date: e.commence_time })));
    for (const w of weather || []) byGame.set(w.game, { wind_mph: w.wind_mph, roof: w.roof });
  } catch { /* optional */ }
  return byGame;
}

async function loadDials() {
  const dials = { ...propEdge.DIAL_DEFAULTS };
  try {
    const { data } = await supabase.from('sport_dials').select('sport, dial, value').in('sport', ['__all__', DIAL_SPORT]);
    const rows = Array.isArray(data) ? data : [];
    for (const scope of ['__all__', DIAL_SPORT]) {
      for (const r of rows) {
        if (r.sport === scope && r.dial in dials && Number.isFinite(Number(r.value))) dials[r.dial] = Number(r.value);
      }
    }
  } catch { /* defaults */ }
  return dials;
}

// The grade pass logs under its own cron name so the ops check finds it
// where it expects it (2026-09-11: it looked for grade-nfl-props rows
// and called the job a silent witness while the row sat under
// analyze-nfl-props).
async function log(status, details, jobName = 'analyze-nfl-props') {
  try {
    await supabase.from('cron_job_logs').insert({ job_name: jobName, status, details: JSON.stringify(details) });
  } catch { /* best effort */ }
}

/**
 * One anytime TD read as a prop_reads row (over 0.5 touchdowns is yes),
 * or null with the reason counted in tally. The single usage model
 * fills both the v1 and the v2 columns so the v2 scorecards see it.
 */
function tdRow(meta, rows, history, redzone, redzoneLoaded, dials, tally) {
  if (!redzoneLoaded) { tally.no_usage_table++; return null; }
  const cons = propEdge.yesConsensus(rows);
  if (!cons || cons.books < Math.max(1, Number(dials.prop_min_books))) { tally.thin_books++; return null; }
  const games = (history.get(meta.player_key) || [])
    .filter(g => (Number(g.carries) || 0) + (Number(g.targets) || 0) > 0)
    .map(g => ({ ...g, ...(redzone.get(`${g.game_id}|${g.player_id}`) || {}) }));
  const baseline = propEdge.tdBaseline(games, dials);
  if (!baseline) { tally.no_history++; return null; }
  const read = propEdge.tdRead({ anchorYesProb: cons.prob, baseline }, dials);
  if (!read) return null;
  const wk = propEdge.nflWeekFor(meta.commence_time);
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const factors = { model: 'usage', lambda: Math.round(baseline.lambda * 1000) / 1000,
    recent_lambda: Math.round(baseline.recentLambda * 1000) / 1000, long_lambda: Math.round(baseline.longLambda * 1000) / 1000,
    anchor: 'median yes price, vig in' };
  return {
    sport: SPORT, event_id: meta.event_id, commence_time: meta.commence_time,
    home_team: meta.home_team, away_team: meta.away_team,
    season: wk ? wk.season : null, week: wk ? wk.week : null,
    market: meta.market, player_key: meta.player_key, player_name: meta.player_name,
    line: propEdge.TD_LINE, side: read.side,
    anchor_prob: r4(read.anchorProb), model_prob: r4(read.modelProb), damped_prob: r4(read.dampedProb),
    model_mean: Math.round(baseline.lambda * 1000) / 1000, model_sigma: null,
    games_used: baseline.games, confidence: Math.round(read.confidence * 1000) / 1000,
    edge_pp: read.edgePp, tier: edgeTier(read.edgePp), books: cons.books,
    consensus_over_price: cons.price, consensus_under_price: null,
    best_book: read.side === 'over' ? cons.best.book : null,
    best_line: propEdge.TD_LINE,
    best_price: read.side === 'over' ? cons.best.price : null,
    dials, factors,
    v2_mean: Math.round(baseline.lambda * 1000) / 1000, v2_prob: r4(read.dampedProb), v2_edge_pp: read.edgePp,
    v2_side: read.side, v2_tier: edgeTier(read.edgePp), v2_outcome: 'pending', v2_factors: factors,
    status: 'shadow', updated_at: new Date().toISOString(),
  };
}

async function runRead() {
  const started = Date.now();
  const summary = { props: 0, groups: 0, read: 0, no_history: 0, not_modeled: 0, no_consensus: 0, upserted: 0, errors: [] };
  const dials = await loadDials();
  const now = new Date();
  const horizon = new Date(now.getTime() + WINDOW_HOURS * 3600 * 1000);

  // A week of NFL props across 8 books is several thousand rows, past
  // the 1000 row default page, so page explicitly (the first live run
  // read 1000 of 5157 and priced 230 of the week's groups).
  const props = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('player_props')
      .select('event_id, commence_time, home_team, away_team, market, player_name, player_key, line, over_price, under_price, yes_price, bookmaker')
      .eq('sport', SPORT)
      .gt('commence_time', now.toISOString())
      .lt('commence_time', horizon.toISOString())
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    props.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  summary.props = props.length;
  summary.thin_books = 0;

  // Group by event, market, player.
  const groups = new Map();
  for (const p of props || []) {
    const k = `${p.event_id}|${p.market}|${p.player_key}`;
    if (!groups.has(k)) groups.set(k, { meta: p, rows: [] });
    groups.get(k).rows.push(p);
  }
  summary.groups = groups.size;

  // One history fetch per player.
  const playerKeys = [...new Set([...groups.values()].map(g => g.meta.player_key))];
  const history = new Map();
  for (let i = 0; i < playerKeys.length; i += 100) {
    const slice = playerKeys.slice(i, i + 100);
    const { data } = await supabase
      .from('nfl_player_game_stats')
      .select('player_key, player_id, game_id, season, week, season_type, team, passing_yards, passing_tds, rushing_yards, receiving_yards, receptions, carries, targets, rushing_tds, receiving_tds')
      .in('player_key', slice)
      .order('season', { ascending: false })
      .order('week', { ascending: false });
    for (const r of data || []) {
      if (!history.has(r.player_key)) history.set(r.player_key, []);
      history.get(r.player_key).push(r);
    }
  }

  // Anytime TD usage: red zone counts per game from nflverse play by
  // play (nfl_player_redzone), merged onto the same history rows. A
  // player with no red zone row for a game had no red zone usage, so
  // the merge defaults to zero, but an empty table means the sync has
  // not run and TD reads are skipped rather than priced on zeros.
  const tdKeys = new Set([...groups.values()].filter(g => g.meta.market === propEdge.TD_MARKET).map(g => g.meta.player_key));
  const redzone = new Map();
  let redzoneLoaded = false;
  if (tdKeys.size) {
    const ids = [...new Set([...tdKeys].flatMap(k => (history.get(k) || []).map(g => g.player_id)).filter(Boolean))];
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabase.from('nfl_player_redzone')
        .select('game_id, player_id, rz_carries, gl_carries, rz_targets, ez_targets')
        .in('player_id', ids.slice(i, i + 100));
      for (const r of data || []) redzone.set(`${r.game_id}|${r.player_id}`, r);
    }
    const { count } = await supabase.from('nfl_player_redzone').select('game_id', { count: 'exact', head: true });
    redzoneLoaded = (count || 0) > 0;
  }
  summary.td = { groups: tdKeys.size ? [...groups.values()].filter(g => g.meta.market === propEdge.TD_MARKET).length : 0, read: 0, no_usage_table: 0, no_history: 0, thin_books: 0 };

  // v2 inputs, one load each for the whole slate.
  const events = [...new Map([...groups.values()].map(g => [g.meta.event_id, g.meta])).values()];
  const firstWeek = events.length ? propEdge.nflWeekFor(events.map(e => e.commence_time).sort()[0]) : null;
  const seasonNow = firstWeek ? firstWeek.season : propEdge.nflWeekFor(now)?.season || now.getUTCFullYear();
  const [allowance, statuses, lines, weather] = await Promise.all([
    loadAllowance(seasonNow),
    loadStatuses(firstWeek?.season, firstWeek?.week),
    loadGameLines(now, horizon),
    loadWeather(events),
  ]);
  // Slate average implied points, the self normalizing scoring environment.
  const implied = [];
  for (const e of events) {
    const l = lines.get(`${e.home_team}|${e.away_team}`);
    if (!l || l.total == null || l.homeSpread == null) continue;
    implied.push(propEdge.impliedTeamPoints(l.total, l.homeSpread), propEdge.impliedTeamPoints(l.total, -l.homeSpread));
  }
  const slateAvg = implied.length ? implied.reduce((a, b) => a + b, 0) / implied.length : null;
  summary.v2 = { allowance_opponents: Object.keys(allowance.byOpponent).length, allowance_games: allowance.leagueGames,
    statuses: statuses.size, lines: lines.size, weather: weather.size, slate_avg_implied: slateAvg ? Math.round(slateAvg * 10) / 10 : null,
    read: 0, unavailable: 0, no_team: 0 };

  const out = [];
  for (const { meta, rows } of groups.values()) {
    if (meta.market === propEdge.TD_MARKET) {
      const td = tdRow(meta, rows, history, redzone, redzoneLoaded, dials, summary.td);
      if (td) { out.push(td); summary.td.read++; }
      continue;
    }
    if (!(meta.market in propEdge.STAT_COLUMN)) { summary.not_modeled++; continue; }
    const consensus = propEdge.consensusFromBooks(rows);
    if (!consensus) { summary.no_consensus++; continue; }
    if (consensus.books < Math.max(1, Number(dials.prop_min_books))) { summary.thin_books++; continue; }
    const baseline = propEdge.playerBaseline(history.get(meta.player_key) || [], meta.market, dials);
    if (!baseline) { summary.no_history++; continue; }
    const read = propEdge.propRead({
      line: consensus.line, anchorOverProb: consensus.overProb,
      mean: baseline.mean, sigma: baseline.sigma, games: baseline.games,
    }, dials);
    if (!read) { summary.no_consensus++; continue; }
    const wk = propEdge.nflWeekFor(meta.commence_time);

    // v2: the same baseline scaled by opponent allowance, the team's
    // implied points and the wind, skipped when the player is listed
    // out. Stored next to v1, graded next to v1, never published.
    const homeAbbr = teamAbbr(meta.home_team), awayAbbr = teamAbbr(meta.away_team);
    const statusRow = statuses.get(nameKey(meta.player_name)) || null;
    const lastTeam = (history.get(meta.player_key) || []).find(g => g.team)?.team || null;
    let team = [homeAbbr, awayAbbr].includes(lastTeam) ? lastTeam
      : [homeAbbr, awayAbbr].includes(statusRow?.team) ? statusRow.team : null;
    const opponent = team ? (team === homeAbbr ? awayAbbr : homeAbbr) : null;
    const line = lines.get(`${meta.home_team}|${meta.away_team}`) || null;
    const teamSpread = line && line.homeSpread != null ? (team === homeAbbr ? line.homeSpread : -line.homeSpread) : null;
    const teamImplied = team && line ? propEdge.impliedTeamPoints(line.total, teamSpread) : null;
    const wx = weather.get(`${meta.away_team} @ ${meta.home_team}`) || null;
    const opp = propEdge.allowanceRatio(allowance, opponent, meta.market);
    const v2 = propEdge.propReadV2({
      market: meta.market, line: consensus.line, anchorOverProb: consensus.overProb,
      mean: baseline.mean, sigma: baseline.sigma, games: baseline.games,
      oppRatio: opponent ? opp.ratio : 1,
      envRatio: teamImplied != null && slateAvg ? teamImplied / slateAvg : 1,
      windMph: wx?.wind_mph, roof: wx?.roof, status: statusRow?.status || null,
    }, dials);
    if (!team) summary.v2.no_team++;
    if (v2?.skipped) summary.v2.unavailable++; else if (v2) summary.v2.read++;
    const v2Cols = v2 && !v2.skipped ? {
      v2_mean: Math.round(v2.meanV2 * 100) / 100,
      v2_prob: Math.round(v2.dampedProb * 10000) / 10000,
      v2_edge_pp: v2.edgePp,
      v2_side: v2.side,
      v2_tier: edgeTier(v2.edgePp),
      v2_outcome: 'pending',
      v2_factors: { ...v2.factors, team, opponent, opp_games: opp.games, team_implied: teamImplied != null ? Math.round(teamImplied * 10) / 10 : null, status_source: statusRow?.source || null },
    } : {
      v2_mean: null, v2_prob: null, v2_edge_pp: null, v2_side: null, v2_tier: null, v2_outcome: null,
      v2_factors: { skipped: v2?.skipped || 'no_read', status: v2?.status || null, team, opponent },
    };

    out.push({
      ...v2Cols,
      sport: SPORT,
      event_id: meta.event_id,
      commence_time: meta.commence_time,
      home_team: meta.home_team,
      away_team: meta.away_team,
      season: wk ? wk.season : null,
      week: wk ? wk.week : null,
      market: meta.market,
      player_key: meta.player_key,
      player_name: meta.player_name,
      line: consensus.line,
      side: read.side,
      anchor_prob: Math.round(read.anchorProb * 10000) / 10000,
      model_prob: Math.round(read.modelProb * 10000) / 10000,
      damped_prob: Math.round(read.dampedProb * 10000) / 10000,
      model_mean: Math.round(baseline.mean * 100) / 100,
      model_sigma: Math.round(baseline.sigma * 100) / 100,
      games_used: baseline.games,
      confidence: Math.round(read.confidence * 1000) / 1000,
      edge_pp: read.edgePp,
      tier: edgeTier(read.edgePp),
      books: consensus.books,
      consensus_over_price: consensus.overPrice,
      consensus_under_price: consensus.underPrice,
      best_book: consensus.best[read.side].book,
      best_line: consensus.best[read.side].line,
      best_price: consensus.best[read.side].price,
      dials,
      factors: {
        recent_mean: Math.round(baseline.recentMean * 100) / 100,
        long_mean: Math.round(baseline.longMean * 100) / 100,
        books_at_line: consensus.atLine,
      },
      status: 'shadow',
      updated_at: new Date().toISOString(),
    });
    summary.read++;
  }

  for (let i = 0; i < out.length; i += 200) {
    const { error: upErr } = await supabase.from('prop_reads').upsert(out.slice(i, i + 200), { onConflict: 'event_id,market,player_key' });
    if (upErr) summary.errors.push(upErr.message); else summary.upserted += Math.min(200, out.length - i);
  }
  summary.tiers = out.reduce((acc, r) => { acc[r.tier] = (acc[r.tier] || 0) + 1; return acc; }, {});
  summary.dials = dials;
  summary.duration_ms = Date.now() - started;
  await log(summary.errors.length ? 'partial' : 'completed', summary);
  // The shown reads get their short narration right after the read
  // lands. Fail soft: a narration problem never fails the read.
  await runNarrate();
  return summary;
}

async function runNarrate() {
  try {
    const n = await narrateProps(supabase);
    await log(n.errors.length && !n.narrated ? 'partial' : 'completed', n, 'narrate-nfl-props');
    return n;
  } catch (err) {
    await log('failed', { error: err.message }, 'narrate-nfl-props');
    return null;
  }
}

// A game is checked for a final box score this long after kickoff, and
// for this many days back (a game ESPN never calls final waits for the
// nflverse file).
const BOX_MIN_HOURS = 2.5;
const BOX_LOOKBACK_DAYS = 4;

/**
 * The settlement for one read from a final box score line: the stat, the
 * v1 outcome and the v2 outcome, or null when the player has no line
 * (left pending, nflverse decides between a grade and a book void). Pure.
 */
function boxScoreGrade(read, players) {
  const statFor = liveStats.STAT_FOR[read.market];
  if (!statFor) return null;
  const line = liveStats.findPlayer(players, read.player_name);
  if (!line) return null;
  const actual = statFor(line);
  const outcome = propEdge.gradeRead(read.side, read.line, actual);
  if (!outcome) return null;
  const v2Outcome = read.v2_side ? propEdge.gradeRead(read.v2_side, read.line, actual) : null;
  return { actual, outcome, v2Outcome };
}

/**
 * Settle pending reads from the ESPN final box score. Runs with the close
 * capture every 15 minutes on game days and before the daily nflverse
 * pass, so a game settles minutes after it ends instead of on Tuesday.
 */
async function runBoxScoreGrade({ fetchFn = fetch } = {}) {
  const started = Date.now();
  const summary = { mode: 'boxscore', pending: 0, games: 0, games_final: 0, graded: 0, won: 0, lost: 0, push: 0, voided: 0, no_line: 0, errors: [] };
  const now = Date.now();
  const { data: pending, error } = await supabase
    .from('prop_reads')
    .select('id, market, player_key, player_name, line, side, v2_side, commence_time, home_team, away_team')
    .eq('actual_outcome', 'pending')
    .lt('commence_time', new Date(now - BOX_MIN_HOURS * 3600 * 1000).toISOString())
    .gt('commence_time', new Date(now - BOX_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString())
    .limit(5000);
  if (error) throw error;
  summary.pending = (pending || []).length;
  const byGame = new Map();
  for (const r of pending || []) {
    const k = liveStats.gameKey(r);
    if (!byGame.has(k)) byGame.set(k, []);
    byGame.get(k).push(r);
  }
  summary.games = byGame.size;
  for (const reads of byGame.values()) {
    const box = await liveStats.boxScoreFor(reads[0], { fetchFn });
    if (!box || !box.game.final) continue;
    summary.games_final++;
    const gradedAt = new Date().toISOString();
    const updates = [];
    for (const r of reads) {
      const g = boxScoreGrade(r, box.players);
      if (!g) {
        // No stat line and ESPN lists the player Out: the book voids the
        // prop, so settle it as void now instead of leaving it waiting
        // for Tuesday (owner 2026-10-18, Judkins). A missing line on a
        // player not listed Out stays pending for the nflverse pass.
        if (liveStats.isInactive(box.inactives, r.player_name)) {
          updates.push({ id: r.id, g: { outcome: 'void' }, cols: { actual_value: null, actual_outcome: 'void', v2_outcome: r.v2_side ? 'void' : null, graded_at: gradedAt, updated_at: gradedAt } });
        } else summary.no_line++;
        continue;
      }
      updates.push({ id: r.id, g, cols: { actual_value: g.actual, actual_outcome: g.outcome, v2_outcome: g.v2Outcome, graded_at: gradedAt, updated_at: gradedAt } });
    }
    for (let i = 0; i < updates.length; i += 20) {
      const results = await Promise.all(updates.slice(i, i + 20).map(u =>
        // Only a row still pending: a row the nflverse pass graded in the
        // meantime keeps its grade.
        supabase.from('prop_reads').update(u.cols).eq('id', u.id).eq('actual_outcome', 'pending')));
      results.forEach((res, j) => {
        if (res.error) { summary.errors.push(res.error.message); return; }
        const o = updates[i + j].g.outcome;
        if (o === 'void') summary.voided++; else { summary.graded++; summary[o]++; }
      });
    }
  }
  summary.duration_ms = Date.now() - started;
  // Quiet runs (nothing pending past kickoff) do not log, so the every
  // 15 minute cadence does not flood cron_job_logs.
  if (summary.pending > 0 || summary.errors.length) {
    await log(summary.errors.length ? 'partial' : 'completed', { ...summary, errors: summary.errors.slice(0, 5) }, 'grade-nfl-props-boxscore');
  }
  return summary;
}

/**
 * Box score grades against the nflverse stat file, the settlement truth.
 * Rows are graded reads with actual_value; stats maps
 * player_key|season|week to the nflverse line. Returns the reads whose
 * stat disagrees. Pure.
 */
function boxScoreMismatches(rows, stats) {
  const out = [];
  for (const r of rows || []) {
    const line = stats.get(`${r.player_key}|${r.season}|${r.week}`);
    if (!line || r.actual_value == null) continue;
    const truth = r.market === propEdge.TD_MARKET
      ? (Number(line.rushing_tds) || 0) + (Number(line.receiving_tds) || 0)
      : Number(line[propEdge.STAT_COLUMN[r.market]]);
    if (!Number.isFinite(truth) || truth === Number(r.actual_value)) continue;
    out.push({ id: r.id, player_key: r.player_key, market: r.market, line: r.line, box: Number(r.actual_value), nflverse: truth,
      outcome: r.actual_outcome, nflverse_outcome: propEdge.gradeRead(r.side, r.line, truth) });
  }
  return out;
}

async function runGrade() {
  const started = Date.now();
  const summary = { pending: 0, graded: 0, won: 0, lost: 0, push: 0, no_stat: 0, errors: [] };
  summary.voided = 0;
  summary.v2_graded = 0;
  const { data: pending, error } = await supabase
    .from('prop_reads')
    .select('id, player_key, season, week, market, line, side, commence_time, v2_side')
    .eq('actual_outcome', 'pending')
    .lt('commence_time', new Date(Date.now() - 4 * 3600 * 1000).toISOString())
    .not('season', 'is', null);
  if (error) throw error;
  summary.pending = (pending || []).length;
  if (summary.pending === 0) { await log('completed', { ...summary, duration_ms: Date.now() - started }, 'grade-nfl-props'); return summary; }

  const keys = [...new Set(pending.map(p => p.player_key))];
  const seasons = [...new Set(pending.map(p => p.season))];
  const stats = new Map();
  for (let i = 0; i < keys.length; i += 100) {
    const { data } = await supabase
      .from('nfl_player_game_stats')
      .select('player_key, season, week, passing_yards, passing_tds, rushing_yards, receiving_yards, receptions, rushing_tds, receiving_tds')
      .in('player_key', keys.slice(i, i + 100))
      .in('season', seasons);
    for (const r of data || []) stats.set(`${r.player_key}|${r.season}|${r.week}`, r);
  }
  // Which (season, week) files have landed: a week with a real stat
  // file has hundreds of player lines. A pending read older than a day
  // whose player has no line in a landed week is a book void, not a
  // pick that waits forever (13 such rows after week 1, 2026-09-14).
  const landed = new Set();
  for (const wk of [...new Set(pending.map(p => `${p.season}|${p.week}`))]) {
    const [season, week] = wk.split('|').map(Number);
    const { count } = await supabase.from('nfl_player_game_stats').select('id', { count: 'exact', head: true }).eq('season', season).eq('week', week);
    if ((count || 0) >= WEEK_FILE_MIN_ROWS) landed.add(wk);
  }
  const voidBefore = Date.now() - VOID_AFTER_HOURS * 3600 * 1000;
  for (const p of pending) {
    const row = stats.get(`${p.player_key}|${p.season}|${p.week}`);
    if (!row) {
      if (landed.has(`${p.season}|${p.week}`) && new Date(p.commence_time).getTime() < voidBefore) {
        const { error: vErr } = await supabase.from('prop_reads')
          .update({ actual_outcome: 'void', v2_outcome: p.v2_side ? 'void' : null, graded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', p.id);
        if (vErr) summary.errors.push(vErr.message); else summary.voided++;
      } else summary.no_stat++;
      continue;
    }
    const actual = p.market === propEdge.TD_MARKET
      ? (Number(row.rushing_tds) || 0) + (Number(row.receiving_tds) || 0)
      : row[propEdge.STAT_COLUMN[p.market]];
    const outcome = propEdge.gradeRead(p.side, p.line, actual);
    if (!outcome) { summary.no_stat++; continue; }
    const v2Outcome = p.v2_side ? propEdge.gradeRead(p.v2_side, p.line, actual) : null;
    const { error: upErr } = await supabase.from('prop_reads')
      .update({ actual_value: actual, actual_outcome: outcome, v2_outcome: v2Outcome, graded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', p.id);
    if (upErr) { summary.errors.push(upErr.message); continue; }
    summary.graded++;
    summary[outcome]++;
    if (v2Outcome) summary.v2_graded++;
  }
  // Check the last ten days of box score grades against the stat file.
  // A disagreement is logged, never written: grades do not re-flip, a
  // regrade goes through allow_regrade.
  try {
    const since = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    const { data: done } = await supabase.from('prop_reads')
      .select('id, player_key, season, week, market, line, side, actual_value, actual_outcome')
      .in('actual_outcome', ['won', 'lost', 'push'])
      .gte('graded_at', since)
      .not('season', 'is', null)
      .limit(5000);
    const rows = done || [];
    const checkStats = new Map();
    const checkKeys = [...new Set(rows.map(r => r.player_key))];
    const checkSeasons = [...new Set(rows.map(r => r.season))];
    for (let i = 0; i < checkKeys.length; i += 100) {
      const { data } = await supabase
        .from('nfl_player_game_stats')
        .select('player_key, season, week, passing_yards, passing_tds, rushing_yards, receiving_yards, receptions, rushing_tds, receiving_tds')
        .in('player_key', checkKeys.slice(i, i + 100))
        .in('season', checkSeasons);
      for (const r of data || []) checkStats.set(`${r.player_key}|${r.season}|${r.week}`, r);
    }
    const mismatches = boxScoreMismatches(rows, checkStats);
    summary.reconciled = rows.length;
    summary.box_mismatches = mismatches.length;
    summary.box_outcome_mismatches = mismatches.filter(m => m.nflverse_outcome && m.nflverse_outcome !== m.outcome).slice(0, 25);
  } catch (err) {
    summary.errors.push(`reconcile: ${err.message}`);
  }
  summary.duration_ms = Date.now() - started;
  await log(summary.errors.length ? 'partial' : 'completed', summary, 'grade-nfl-props');
  return summary;
}

async function analyzeNflProps(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const mode = ['grade', 'narrate', 'boxscore'].includes(req.query.mode) ? req.query.mode : 'read';
  res.status(202).json({ status: 'accepted', message: `NFL props ${mode} started` });
  (async () => {
    try {
      // The daily grade settles from box scores first, so a game that
      // ended after the last close capture run still settles by morning.
      if (mode === 'grade') { await runBoxScoreGrade().catch(e => log('failed', { mode: 'boxscore', error: e.message }, 'grade-nfl-props-boxscore')); await runGrade(); }
      else if (mode === 'boxscore') await runBoxScoreGrade();
      else if (mode === 'narrate') await runNarrate();
      else await runRead();
    } catch (err) {
      console.error('analyze-nfl-props error:', err.message);
      await log('failed', { mode, error: err.message }, mode === 'grade' ? 'grade-nfl-props' : 'analyze-nfl-props');
    }
  })();
}

module.exports = analyzeNflProps;
module.exports.runRead = runRead;
module.exports.runGrade = runGrade;
module.exports.runBoxScoreGrade = runBoxScoreGrade;
module.exports.boxScoreGrade = boxScoreGrade;
module.exports.boxScoreMismatches = boxScoreMismatches;
module.exports.runNarrate = runNarrate;
module.exports.tdRow = tdRow;
