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
 * Pure helpers are exported for tests. IO takes a fetch and a supabase
 * client so tests can stub both.
 */

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
  const rows = [];
  const want = new Date(kickoffIso).getTime();
  for (const g of (snapshot && snapshot.data) || []) {
    if (!g || new Date(g.commence_time).getTime() !== want) continue;
    for (const b of g.bookmakers || []) {
      for (const m of b.markets || []) {
        if (!Array.isArray(m.outcomes) || m.outcomes.length === 0) continue;
        rows.push({
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
  return rows;
}

async function getJson(fetchFn, url, credits) {
  const res = await fetchFn(url);
  const used = res.headers && res.headers.get && res.headers.get('x-requests-last');
  if (used != null && credits) credits.total += Number(used) || 0;
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.replace(/apiKey=[^&]+/, 'apiKey=***')}`);
  return res.json();
}

/**
 * Backfill one window for one sport. Returns counts and credits spent
 * (from the x-requests-last header).
 */
async function backfillWindow({ fetchFn, supabase, apiKey, sport, markets, windowStart, windowEnd }) {
  const credits = { total: 0 };
  const events = [];
  for (const date of eventSampleDates(windowStart, windowEnd)) {
    if (new Date(date).getTime() > Date.now()) break;
    const url = `${BASE}/${sport}/events?apiKey=${apiKey}&date=${date}`;
    const body = await getJson(fetchFn, url, credits);
    events.push(...((body && body.data) || []));
  }
  const groups = groupByKickoff(events, windowStart, windowEnd);

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
};
