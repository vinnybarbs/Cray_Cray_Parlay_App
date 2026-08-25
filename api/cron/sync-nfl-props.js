/**
 * CRON: Sync NFL player props from The Odds API.
 *
 * Props live on PER-EVENT endpoints, not the bulk odds feed, and each
 * call bills credits per market and region, so this job is deliberately
 * frugal: a bounded event window, one region, a fixed core market list,
 * and the API's own credit headers logged on every run so the spend is
 * auditable from cron_job_logs.
 *
 * Core markets (the launch five): passing yards and TDs, rushing yards,
 * receiving yards, receptions, plus anytime TD. Over/Under markets carry
 * the player in outcome.description with a point line; anytime TD is a
 * yes-style price. Both shapes are handled defensively and the first raw
 * market of each run is logged verbatim, which doubles as the live
 * format probe for a sandbox that cannot reach the API.
 *
 * Schedule: twice daily during preseason. Endpoint:
 * POST /cron/sync-nfl-props?secret=...&days=3&sport=americanfootball_nfl
 */

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { playerKey } = require('../../lib/services/tennis-data.js');

const BASE = 'https://api.the-odds-api.com/v4';
const CORE_MARKETS = [
  'player_pass_yds', 'player_pass_tds', 'player_rush_yds',
  'player_reception_yds', 'player_receptions', 'player_anytime_td',
].join(',');
const DEFAULT_DAYS = 3;
const MAX_DAYS = 8;
const MAX_EVENTS_PER_RUN = 20; // credit ceiling: events x 6 markets x 1 region

async function fetchJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  return {
    ok: res.ok,
    status: res.status,
    body,
    remaining: res.headers.get('x-requests-remaining'),
    used: res.headers.get('x-requests-used'),
    last: res.headers.get('x-requests-last'),
  };
}

function sportLabel(sportKey) {
  return sportKey === 'americanfootball_ncaaf' ? 'NCAAF' : 'NFL';
}

// Preseason NFL lives under its own Odds API sport key, so the default run
// sweeps both. NCAAF joined the default sweep 2026-08-25 with the opener
// days out; college props post for the marquee games and the preseason
// weeks proved books post nothing for exhibition NFL (every 200 came back
// with zero markets and zero billed credits). Out of season an extra key
// costs one events list call that returns empty. Explicit ?sport= still
// targets a single key. MAX_EVENTS_PER_RUN bounds the credit spend.
const DEFAULT_SPORT_KEYS = ['americanfootball_nfl', 'americanfootball_nfl_preseason', 'americanfootball_ncaaf'];

async function runSync({ days, sportKey }) {
  const startTime = Date.now();
  const apiKey = process.env.ODDS_API_KEY;
  const summary = {
    sport_key: sportKey, days, events_in_window: 0, events_fetched: 0,
    rows_upserted: 0, markets_seen: {}, credits: {}, errors: [], sample: null,
  };

  try {
    if (!apiKey) throw new Error('ODDS_API_KEY not set');

    const evRes = await fetchJson(`${BASE}/sports/${sportKey}/events?apiKey=${apiKey}`);
    if (!evRes.ok) throw new Error(`events endpoint ${evRes.status}`);
    const horizon = Date.now() + days * 24 * 3600 * 1000;
    const events = (evRes.body || [])
      .filter(e => e?.id && e.commence_time && new Date(e.commence_time).getTime() < horizon
        && new Date(e.commence_time).getTime() > Date.now() - 6 * 3600 * 1000)
      .slice(0, MAX_EVENTS_PER_RUN);
    summary.events_in_window = events.length;

    for (const event of events) {
      const url = `${BASE}/sports/${sportKey}/events/${event.id}/odds`
        + `?apiKey=${apiKey}&regions=us&oddsFormat=american&markets=${CORE_MARKETS}`;
      const res = await fetchJson(url);
      summary.credits = { remaining: res.remaining, used: res.used, last_call_cost: res.last };
      if (!res.ok) {
        // 404/422 just means the books have not posted props for this
        // event yet, normal early in preseason weeks.
        if (res.status !== 404 && res.status !== 422) {
          summary.errors.push(`event ${event.id}: ${res.status}`);
        }
        continue;
      }
      summary.events_fetched++;

      const now = new Date().toISOString();
      // Collate per (market, player, book): Over/Under arrive as separate
      // outcomes and must land on one row.
      const rows = new Map();
      for (const book of (res.body?.bookmakers || [])) {
        for (const market of (book.markets || [])) {
          summary.markets_seen[market.key] = (summary.markets_seen[market.key] || 0) + 1;
          if (!summary.sample && (market.outcomes || []).length > 0) {
            summary.sample = { market: market.key, bookmaker: book.key, outcomes: market.outcomes.slice(0, 2) };
          }
          for (const o of (market.outcomes || [])) {
            const player = o.description || (o.name !== 'Over' && o.name !== 'Under' && o.name !== 'Yes' && o.name !== 'No' ? o.name : null);
            if (!player) continue;
            const key = `${market.key}|${playerKey(player)}|${book.key}`;
            const row = rows.get(key) || {
              sport: sportLabel(sportKey),
              event_id: event.id,
              commence_time: event.commence_time,
              home_team: event.home_team || null,
              away_team: event.away_team || null,
              market: market.key,
              player_name: player,
              player_key: playerKey(player),
              bookmaker: book.key,
              line: null, over_price: null, under_price: null, yes_price: null,
              last_updated: now,
            };
            if (o.name === 'Over') { row.over_price = o.price; row.line = o.point ?? row.line; }
            else if (o.name === 'Under') { row.under_price = o.price; row.line = o.point ?? row.line; }
            else { row.yes_price = o.price; if (o.point != null) row.line = o.point; }
            rows.set(key, row);
          }
        }
      }

      if (rows.size > 0) {
        const { error } = await supabase.from('player_props')
          .upsert([...rows.values()], { onConflict: 'event_id,market,player_key,bookmaker' });
        if (error) summary.errors.push(`upsert ${event.id}: ${error.message}`);
        else summary.rows_upserted += rows.size;
      }
      await new Promise(r => setTimeout(r, 200));
    }

    await supabase.from('cron_job_logs').insert({
      job_name: 'sync-nfl-props',
      status: summary.errors.length === 0 ? 'completed' : 'partial',
      details: JSON.stringify({ ...summary, errors: summary.errors.slice(0, 5), duration_ms: Date.now() - startTime }),
    });
  } catch (error) {
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: 'sync-nfl-props', status: 'failed',
        details: JSON.stringify({ error: error.message, sport_key: sportKey }),
      });
    } catch { /* best-effort */ }
  }
}

async function syncNflProps(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const days = Math.min(MAX_DAYS, Math.max(1, parseInt(req.query.days, 10) || DEFAULT_DAYS));
  const sportKeys = ['americanfootball_ncaaf', 'americanfootball_nfl', 'americanfootball_nfl_preseason']
    .includes(req.query.sport) ? [req.query.sport] : DEFAULT_SPORT_KEYS;
  res.status(202).json({ status: 'accepted', message: `Props sync started (${sportKeys.join(', ')}, ${days} days)` });
  (async () => {
    for (const sportKey of sportKeys) await runSync({ days, sportKey });
  })().catch(err => console.error('Props sync error:', err.message));
}

module.exports = syncNflProps;
