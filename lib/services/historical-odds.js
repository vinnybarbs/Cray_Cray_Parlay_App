/**
 * Historical closing prices from The Odds API historical endpoints.
 *
 * Owner 2026-10-13, after the plan went to 5M credits a month: backfill
 * history, soccer closes first (so the goal model replays against
 * thousands of closes instead of 254), then NFL prop history, then multi
 * season closes for the dial search.
 *
 * How a window is backfilled:
 *   1. Walk /v4/historical/sports/{sport}/events every EVENT_STEP_DAYS
 *      (1 credit a call, free when empty) and collect every event whose
 *      kickoff falls inside the window.
 *   2. For each distinct kickoff time T, take one /v4/historical/sports/
 *      {sport}/odds snapshot at T minus one minute, filtered to games
 *      starting at T. Snapshots are 5 minutes apart, so this is the last
 *      quote before kickoff: the close. Cost is 10 per market per region,
 *      however many games share T.
 *
 * Rows land in historical_closing_lines, never in closing_lines (which is
 * the live capture that CLV on real picks reads).
 *
 * Player props (a job whose markets are all player_ keys) live on the
 * per event endpoint instead: one /v4/historical/sports/{sport}/events/
 * {id}/odds snapshot per game, one minute before kickoff, at 10 credits
 * per market returned. Rows land in historical_prop_closes, one per
 * (game, market, player, book) with Over and Under on one row, the same
 * shape as player_props, plus the nflverse season and week so the
 * historical_prop_results view can grade them against
 * nfl_player_game_stats. Prop history starts 2023-05-03.
 *
 * Pure helpers are exported for tests. IO takes a fetch and a supabase
 * client so tests can stub both.
 */

const { playerKey } = require('./tennis-data.js');
const { nflWeekFor } = require('./prop-edge.js');

const BASE = 'https://api.the-odds-api.com/v4/historical/sports';
const BOOKMAKERS = 'draftkings,fanduel,betmgm,caesars,betrivers,fanatics';
const EVENT_STEP_DAYS = 3;
const CLOSE_OFFSET_MS = 60 * 1000;

function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Dates to sample the events list at, so every kickoff in the window is seen. */
function eventSampleDates(windowStart, windowEnd, stepDays = EVENT_STEP_DAYS) {
  const out = [];
  const start = new Date(`${windowStart}T00:00:00Z`).getTime() - stepDays * 86400000;
  const end = new Date(`${windowEnd}T00:00:00Z`).getTime();
  for (let t = start; t <= end; t += stepDays * 86400000) out.push(iso(t));
  return out;
}

/** Unique events inside [windowStart, windowEnd), grouped by kickoff. */
function groupByKickoff(events, windowStart, windowEnd, nowMs = Date.now()) {
  const lo = new Date(`${windowStart}T00:00:00Z`).getTime();
  // A kickoff not yet past has no historical close; the live capture
  // (closing_lines) owns it.
  const hi = Math.min(new Date(`${windowEnd}T00:00:00Z`).getTime(), nowMs - 10 * 60 * 1000);
  const seen = new Map();
  for (const e of events || []) {
    if (!e || !e.id || !e.commence_time) continue;
    const t = new Date(e.commence_time).getTime();
    if (!(t >= lo && t < hi)) continue;
    seen.set(e.id, e);
  }
  const groups = new Map();
  for (const e of seen.values()) {
    const k = new Date(e.commence_time).toISOString();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  return groups;
}

/** Rows for historical_closing_lines from one snapshot, games at kickoff only. */
function rowsFromSnapshot(sport, snapshot, kickoffIso) {
  // Keyed by the table's primary key: a snapshot can list one game or one
  // market twice (UCL February 2025 did), and Postgres refuses an upsert
  // batch that touches the same row twice. The later entry wins.
  const rows = new Map();
  const want = new Date(kickoffIso).getTime();
  for (const g of (snapshot && snapshot.data) || []) {
    if (!g || new Date(g.commence_time).getTime() !== want) continue;
    for (const b of g.bookmakers || []) {
      for (const m of b.markets || []) {
        if (!Array.isArray(m.outcomes) || m.outcomes.length === 0) continue;
        rows.set(`${g.id}|${b.key}|${m.key}`, {
          sport,
          external_game_id: g.id,
          commence_time: g.commence_time,
          home_team: g.home_team,
          away_team: g.away_team,
          bookmaker: b.key,
          market_type: m.key,
          outcomes: m.outcomes,
          snapshot_at: snapshot.timestamp || null,
          quote_updated_at: m.last_update || b.last_update || null,
        });
      }
    }
  }
  return [...rows.values()];
}

async function getJson(fetchFn, url, credits, { missingOk = false } = {}) {
  const res = await fetchFn(url);
  const used = res.headers && res.headers.get && res.headers.get('x-requests-last');
  if (used != null && credits) credits.total += Number(used) || 0;
  if (missingOk && (res.status === 404 || res.status === 422)) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.replace(/apiKey=[^&]+/, 'apiKey=***')}`);
  return res.json();
}

/**
 * Backfill one window for one sport. Returns counts and credits spent
 * (from the x-requests-last header).
 */
/** True when every market of a job is a player prop (per event endpoint). */
function isPropMarkets(markets) {
  const list = String(markets || '').split(',').filter(Boolean);
  return list.length > 0 && list.every((m) => m.startsWith('player_'));
}

const SPORT_LABEL = { americanfootball_nfl: 'NFL', americanfootball_ncaaf: 'NCAAF', basketball_nba: 'NBA' };

/**
 * Rows for historical_prop_closes from one per event snapshot. Over and
 * Under arrive as separate outcomes and land on one row per (market,
 * player, book), the same collation as sync-nfl-props. Pure.
 */
function propRowsFromEventSnapshot(sport, snapshot) {
  const g = snapshot && snapshot.data;
  if (!g || !g.id) return [];
  const wk = sport === 'americanfootball_nfl' ? nflWeekFor(g.commence_time) : null;
  const rows = new Map();
  for (const b of g.bookmakers || []) {
    for (const m of b.markets || []) {
      for (const o of m.outcomes || []) {
        const named = o.name !== 'Over' && o.name !== 'Under' && o.name !== 'Yes' && o.name !== 'No';
        const player = o.description || (named ? o.name : null);
        const key = playerKey(player);
        if (!key) continue;
        const k = `${m.key}|${key}|${b.key}`;
        const row = rows.get(k) || {
          sport: SPORT_LABEL[sport] || sport,
          event_id: g.id,
          commence_time: g.commence_time,
          home_team: g.home_team || null,
          away_team: g.away_team || null,
          season: wk ? wk.season : null,
          week: wk ? wk.week : null,
          market: m.key,
          player_name: player,
          player_key: key,
          bookmaker: b.key,
          line: null, over_price: null, under_price: null, yes_price: null,
          snapshot_at: snapshot.timestamp || null,
          quote_updated_at: m.last_update || b.last_update || null,
        };
        if (o.name === 'Over') { row.over_price = o.price; row.line = o.point ?? row.line; }
        else if (o.name === 'Under') { row.under_price = o.price; row.line = o.point ?? row.line; }
        else if (o.name !== 'No') { row.yes_price = o.price; if (o.point != null) row.line = o.point; }
        rows.set(k, row);
      }
    }
  }
  return [...rows.values()];
}

async function sampleEvents(fetchFn, apiKey, sport, windowStart, windowEnd, credits) {
  const events = [];
  for (const date of eventSampleDates(windowStart, windowEnd)) {
    if (new Date(date).getTime() > Date.now()) break;
    const url = `${BASE}/${sport}/events?apiKey=${apiKey}&date=${date}`;
    const body = await getJson(fetchFn, url, credits);
    events.push(...((body && body.data) || []));
  }
  return groupByKickoff(events, windowStart, windowEnd);
}

/**
 * Backfill one window of player prop closes: one per event snapshot a
 * minute before each kickoff. A game the books never priced (404 or 422,
 * or no bookmakers) is skipped.
 */
async function backfillPropsWindow({ fetchFn, supabase, apiKey, sport, markets, windowStart, windowEnd }) {
  const credits = { total: 0 };
  const groups = await sampleEvents(fetchFn, apiKey, sport, windowStart, windowEnd, credits);
  let rowsWritten = 0;
  let gamesWithClose = 0;
  let events = 0;
  for (const [kickoff, list] of groups) {
    const at = iso(new Date(kickoff).getTime() - CLOSE_OFFSET_MS);
    for (const e of list) {
      events += 1;
      const url = `${BASE}/${sport}/events/${e.id}/odds?apiKey=${apiKey}&date=${at}&markets=${markets}`
        + `&bookmakers=${BOOKMAKERS}&oddsFormat=american`;
      const snap = await getJson(fetchFn, url, credits, { missingOk: true });
      const rows = propRowsFromEventSnapshot(sport, snap);
      if (rows.length === 0) continue;
      gamesWithClose += 1;
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase
          .from('historical_prop_closes')
          .upsert(rows.slice(i, i + 500), { onConflict: 'event_id,market,player_key,bookmaker' });
        if (error) throw new Error(`historical_prop_closes: ${error.message}`);
      }
      rowsWritten += rows.length;
    }
  }
  return { events, kickoffs: groups.size, gamesWithClose, rowsWritten, credits: credits.total };
}

async function backfillWindow({ fetchFn, supabase, apiKey, sport, markets, windowStart, windowEnd }) {
  const credits = { total: 0 };
  const groups = await sampleEvents(fetchFn, apiKey, sport, windowStart, windowEnd, credits);

  let rowsWritten = 0;
  let gamesWithClose = 0;
  for (const kickoff of groups.keys()) {
    const at = iso(new Date(kickoff).getTime() - CLOSE_OFFSET_MS);
    const k = iso(new Date(kickoff).getTime());
    const url = `${BASE}/${sport}/odds?apiKey=${apiKey}&date=${at}&markets=${markets}`
      + `&bookmakers=${BOOKMAKERS}&oddsFormat=american&commenceTimeFrom=${k}&commenceTimeTo=${k}`;
    const snap = await getJson(fetchFn, url, credits);
    const rows = rowsFromSnapshot(sport, snap, kickoff);
    if (rows.length === 0) continue;
    gamesWithClose += new Set(rows.map((r) => r.external_game_id)).size;
    const { error } = await supabase
      .from('historical_closing_lines')
      .upsert(rows, { onConflict: 'external_game_id,bookmaker,market_type' });
    if (error) throw new Error(`historical_closing_lines: ${error.message}`);
    rowsWritten += rows.length;
  }
  return { events: [...groups.values()].reduce((s, g) => s + g.length, 0), kickoffs: groups.size, gamesWithClose, rowsWritten, credits: credits.total };
}

module.exports = {
  BOOKMAKERS,
  EVENT_STEP_DAYS,
  eventSampleDates,
  groupByKickoff,
  rowsFromSnapshot,
  backfillWindow,
  isPropMarkets,
  propRowsFromEventSnapshot,
  backfillPropsWindow,
};
