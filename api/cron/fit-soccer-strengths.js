/**
 * CRON: fit the soccer goal model (owner 2026-10-13: "Do goal model").
 *
 * POST /cron/fit-soccer-strengths?secret=...   daily, before pre-analyze
 *   &deep=1   re-walk the full history window for every competition
 *
 * 1. History: finished matches from ESPN scoreboards into
 *    soccer_match_history. A competition with too little history gets the
 *    full HISTORY_DAYS walk, otherwise only the last few days. This table
 *    is separate from game_results on purpose: game_results feeds grading,
 *    and a deep backfill there would hand old pending rows new results.
 * 2. Fit: one fit per pool (lib/services/soccer-strengths.js), written to
 *    soccer_team_strengths (current ratings) and soccer_model_fits.
 * 3. Replay: walk forward over every soccer match with a stored closing
 *    three way price and score the goal model against the devigged close
 *    (log loss and Brier per blend weight), stored on the fit row. This is
 *    the evidence any goal_model_weight move needs.
 *
 * Responds 202 at once and runs in the background (a deep walk is a few
 * thousand ESPN requests). Outcome lands in cron_job_logs. No Odds API
 * credits and no model calls.
 */

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { fetchScoreboard, SPORT_PATHS } = require('./backfill-game-results.js');
const { sportDayCompact, sportDayISO, daysAgo } = require('../../lib/services/sport-day.js');
const { fromOddsCacheRows } = require('../../lib/services/edge-models/soccer-1x2.js');
const ss = require('../../lib/services/soccer-strengths.js');

const CODES = ['EPL', 'MLS', 'UCL', 'UEL', 'LALIGA', 'SERIEA', 'BUNDESLIGA', 'LIGUE1'];
// Back to August 2024, two full European seasons, to line up with the
// historical closing prices (historical_closing_lines) the replay scores.
const HISTORY_DAYS = 820;
const RECENT_DAYS = 5;
// A competition whose oldest stored match is younger than this many days
// gets the deep walk (the summer break means the oldest match can sit
// weeks inside the window).
const DEEP_IF_OLDEST_WITHIN_DAYS = HISTORY_DAYS - 90;
const PARALLEL_DAYS = 6;

// Odds API slug to display sport, for the closing price replay.
const SLUG_TO_SPORT = {
  soccer_epl: 'EPL',
  soccer_usa_mls: 'MLS',
  soccer_uefa_champs_league: 'Champions League',
  soccer_uefa_europa_league: 'Europa League',
  soccer_spain_la_liga: 'La Liga',
  soccer_italy_serie_a: 'Serie A',
  soccer_germany_bundesliga: 'Bundesliga',
  soccer_france_ligue_one: 'Ligue 1',
};
const STORED = {
  EPL: 'EPL', MLS: 'MLS', UCL: 'Champions League', UEL: 'Europa League',
  LALIGA: 'La Liga', SERIEA: 'Serie A', BUNDESLIGA: 'Bundesliga', LIGUE1: 'Ligue 1',
};

async function pageAll(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

async function ingestHistory({ deep }) {
  const summary = {};
  const errors = [];
  for (const code of CODES) {
    const competition = STORED[code];
    const { count } = await supabase
      .from('soccer_match_history')
      .select('espn_event_id', { count: 'exact', head: true })
      .eq('competition', competition);
    const { data: oldest } = await supabase
      .from('soccer_match_history')
      .select('match_date')
      .eq('competition', competition)
      .order('match_date', { ascending: true })
      .limit(1);
    const oldestDate = oldest && oldest[0] ? oldest[0].match_date : null;
    const thin = !oldestDate
      || (Date.now() - new Date(`${oldestDate}T00:00:00Z`).getTime()) / 86400000 < DEEP_IF_OLDEST_WITHIN_DAYS;
    const days = deep || thin ? HISTORY_DAYS : RECENT_DAYS;
    let found = 0;
    let written = 0;
    for (let d = 0; d < days; d += PARALLEL_DAYS) {
      const batch = [];
      for (let k = d; k < Math.min(d + PARALLEL_DAYS, days); k++) {
        batch.push(fetchScoreboard(code, SPORT_PATHS[code], sportDayCompact(daysAgo(k)), errors));
      }
      const games = (await Promise.all(batch)).flat();
      found += games.length;
      if (games.length === 0) continue;
      const rows = games.map((g) => ({
        espn_event_id: g.espn_event_id,
        competition,
        match_date: g.date,
        home_team_id: g.home_team_id,
        home_team_name: g.home_team_name,
        away_team_id: g.away_team_id,
        away_team_name: g.away_team_name,
        home_goals: g.home_score,
        away_goals: g.away_score,
        espn_status: g.metadata && g.metadata.espn_status,
      }));
      const { error } = await supabase.from('soccer_match_history').upsert(rows, { onConflict: 'espn_event_id' });
      if (error) errors.push(`${code} upsert: ${error.message}`);
      else written += rows.length;
    }
    summary[competition] = { stored_before: count || 0, days, found, written };
  }
  return { summary, errors };
}

function toMatch(r) {
  return {
    date: r.match_date,
    competition: r.competition,
    homeId: r.home_team_id,
    awayId: r.away_team_id,
    homeName: r.home_team_name,
    awayName: r.away_team_name,
    // Shootout scores are not goals: ESPN's score after penalties counts
    // only the 120 minutes, which is what the model wants.
    homeGoals: r.home_goals,
    awayGoals: r.away_goals,
  };
}

/**
 * Closing three way prices joined to finished matches, by team key and
 * a date within one day (ESPN dates are US Eastern days).
 */
async function loadPriced(history, aliases) {
  // Historical snapshots first, live captures after, so a game held in
  // both keeps the live close (the later write per book wins below).
  const historical = await pageAll(() => supabase
    .from('historical_closing_lines')
    .select('sport, external_game_id, commence_time, home_team, away_team, bookmaker, market_type, outcomes')
    .in('sport', Object.keys(SLUG_TO_SPORT))
    .eq('market_type', 'h2h')
    .order('commence_time', { ascending: true }));
  const live = await pageAll(() => supabase
    .from('closing_lines')
    .select('sport, external_game_id, commence_time, home_team, away_team, bookmaker, market_type, outcomes, captured_at')
    .in('sport', Object.keys(SLUG_TO_SPORT))
    .eq('market_type', 'h2h')
    .order('captured_at', { ascending: true }));
  const closes = [...historical, ...live];
  // Latest capture per game and book.
  const games = new Map();
  for (const c of closes) {
    let g = games.get(c.external_game_id);
    if (!g) {
      g = { sport: SLUG_TO_SPORT[c.sport], commence: c.commence_time, home: c.home_team, away: c.away_team, byBook: new Map() };
      games.set(c.external_game_id, g);
    }
    g.byBook.set(c.bookmaker, c);
  }
  const index = new Map();
  for (const m of history) {
    const key = `${m.competition}|${ss.soccerTeamKey(m.homeName, aliases)}|${ss.soccerTeamKey(m.awayName, aliases)}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(m);
  }
  const priced = [];
  let unmatched = 0;
  for (const g of games.values()) {
    const key = `${g.sport}|${ss.soccerTeamKey(g.home, aliases)}|${ss.soccerTeamKey(g.away, aliases)}`;
    const day = String(g.commence).slice(0, 10);
    const hit = (index.get(key) || []).find((m) => Math.abs(new Date(m.date) - new Date(day)) <= 86400000);
    if (!hit) { unmatched++; continue; }
    const books = fromOddsCacheRows([...g.byBook.values()], g.home, g.away);
    if (books.length === 0) { unmatched++; continue; }
    priced.push({
      date: hit.date,
      competition: g.sport,
      home: hit.homeName,
      away: hit.awayName,
      homeGoals: hit.homeGoals,
      awayGoals: hit.awayGoals,
      books,
    });
  }
  return { priced, unmatched, closingGames: games.size };
}

async function run({ deep }) {
  const started = Date.now();
  const ingest = await ingestHistory({ deep });

  const { data: aliasRows } = await supabase.from('soccer_team_aliases').select('alias_key, canonical_key');
  const aliases = new Map((aliasRows || []).map((a) => [a.alias_key, a.canonical_key]));

  const historyRows = await pageAll(() => supabase
    .from('soccer_match_history')
    .select('competition, match_date, home_team_id, home_team_name, away_team_id, away_team_name, home_goals, away_goals')
    .order('match_date', { ascending: true }));
  const history = historyRows.map(toMatch);

  const { priced, unmatched, closingGames } = await loadPriced(history, aliases);
  const fittedAt = new Date().toISOString();
  // Match dates are US Eastern days, so the fit's as of day is too.
  const today = sportDayISO();
  const pools = {};

  for (const [pool, sports] of Object.entries(ss.POOLS)) {
    const matches = history.filter((m) => sports.includes(m.competition));
    const fit = ss.fitStrengths(matches, { asOf: today });
    if (!fit) { pools[pool] = { skipped: 'no history' }; continue; }

    const poolPriced = priced.filter((p) => sports.includes(p.competition));
    const replay = ss.walkForward(matches, poolPriced, { aliases });
    const byCompetition = {};
    for (const comp of sports) {
      const items = replay.items.filter((i) => i.competition === comp);
      if (items.length) byCompetition[comp] = ss.scorePredictions(items, [0, 0.2, 0.35, 1]);
    }
    const evaluation = { overall: replay.scores, by_competition: byCompetition, n: replay.n, unpriced: replay.unpriced, weeks: replay.weeks };

    const { error: fitErr } = await supabase.from('soccer_model_fits').insert({
      pool,
      fitted_at: fittedAt,
      n_matches: fit.nMatches,
      n_teams: fit.teams.length,
      rho: fit.rho,
      half_life_days: fit.halfLifeDays,
      ridge: fit.ridge,
      competitions: fit.competitions,
      evaluation,
    });
    if (fitErr) throw new Error(`soccer_model_fits: ${fitErr.message}`);

    const rows = fit.teams.map((t) => ({
      pool,
      espn_team_id: String(t.id),
      team_name: t.name,
      team_key: ss.soccerTeamKey(t.name, aliases),
      attack: +t.attack.toFixed(5),
      defense: +t.defense.toFixed(5),
      games_weighted: +t.games.toFixed(2),
      competitions: t.competitions,
      fitted_at: fittedAt,
    }));
    const { error: upErr } = await supabase.from('soccer_team_strengths').upsert(rows, { onConflict: 'pool,espn_team_id' });
    if (upErr) throw new Error(`soccer_team_strengths: ${upErr.message}`);
    // Clubs that dropped out of the fit window leave the current table.
    await supabase.from('soccer_team_strengths').delete().eq('pool', pool).lt('fitted_at', fittedAt);

    pools[pool] = { matches: fit.nMatches, teams: fit.teams.length, rho: fit.rho, replay_n: replay.n, log_loss: { market: replay.scores['0'].logLoss, blend_02: replay.scores['0.2'].logLoss, model: replay.scores['1'].logLoss } };
  }

  const details = { deep: !!deep, ingest: ingest.summary, errors: ingest.errors.slice(0, 20), error_count: ingest.errors.length, closing_games: closingGames, priced: priced.length, unmatched, pools, duration_ms: Date.now() - started };
  const httpFailures = ingest.errors.filter((e) => / HTTP \d+$/.test(e)).length;
  await supabase.from('cron_job_logs').insert({
    job_name: 'fit-soccer-strengths',
    status: httpFailures > 0 ? 'partial' : 'completed',
    details: JSON.stringify(details),
  });
  console.log('⚽ fit-soccer-strengths', JSON.stringify(details));
  return details;
}

async function fitSoccerStrengths(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const deep = req.query.deep === '1';
  res.status(202).json({ accepted: true, deep });
  run({ deep }).catch(async (err) => {
    console.error('❌ fit-soccer-strengths failed:', err.message);
    await supabase.from('cron_job_logs').insert({
      job_name: 'fit-soccer-strengths',
      status: 'failed',
      details: JSON.stringify({ error: err.message }),
    });
  });
}

module.exports = fitSoccerStrengths;
module.exports.run = run;
