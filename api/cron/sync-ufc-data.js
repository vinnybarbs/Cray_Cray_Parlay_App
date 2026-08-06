/**
 * CRON: Sync UFC Data from ESPN
 *
 * Fills ufc_fighters (career records) and ufc_fight_results (completed
 * fights) from the same ESPN hosts espn-results.js already settles UFC
 * picks against. Without this, every UFC analysis said records and
 * recent form were unavailable and leaned on the moneyline alone.
 *
 * Per run:
 *   - Completed fights from the trailing ?days=N days of scoreboards
 *     (default 3, capped at 30 so a manual backfill can seed history;
 *     self-backfills 30 when the results table is empty)
 *   - Upcoming events in the next 10 days, so every fighter on a booked
 *     card gets a career record row BEFORE the analysis runs
 *   - Career records for every athlete seen, via the core API records ref
 *
 * Schedule: minute 35, every 4 hours (20 min before pre-analyze-UFC at :55)
 * Endpoint: POST /cron/sync-ufc-data?days=3
 */

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { playerKey } = require('../../lib/services/tennis-data.js');
const { recordFromRecordsPayload } = require('../../lib/services/ufc-data.js');

const SITE_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE_BASE = 'http://sports.core.api.espn.com/v2/sports';

const DEFAULT_DAYS = 3;
const MAX_DAYS = 30;
const UPCOMING_DAYS = 10;

// The odds feed (mma_mixed_martial_arts) prices every promotion, but this
// sync originally scanned only ESPN's ufc league, which left PFL cards
// (Goltsov, 8/5) and prospect cards (8/6) with no fighter data. ESPN
// serves each promotion under its own league slug, so sweep them all. An
// unknown or eventless league returns an error or empty scoreboard and
// costs one cheap fetch per day slot.
const MMA_LEAGUES = ['ufc', 'pfl', 'bellator', 'lfa'];

function yyyymmdd(date) {
  return date.toISOString().split('T')[0].replace(/-/g, '');
}

function isoDate(date) {
  return date.toISOString().split('T')[0];
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

/**
 * All fights for one event via the core API, with athlete json attached.
 * athleteCache dedupes athlete fetches across events within a run.
 *
 * A fight whose OTHER athlete fails to resolve used to be dropped
 * entirely, which is how Darren Elkins got a record row while his
 * late-booked opponent never got one (2026-08-06). Now every resolved
 * athlete is returned in `athletes` for upserting, and only the results
 * path still requires a complete pair.
 */
async function getEventFights(eventId, athleteCache, league = 'ufc') {
  const data = await fetchJson(`${CORE_BASE}/mma/leagues/${league}/events/${eventId}/competitions?limit=50`);
  const fights = [];
  const athletes = [];
  for (const comp of (data.items || [])) {
    const competitors = comp.competitors || [];
    if (competitors.length !== 2) continue;
    const pair = [];
    for (const c of competitors) {
      const refUrl = c.athlete?.$ref;
      if (!refUrl) continue;
      let athlete = athleteCache.get(refUrl);
      if (!athlete) {
        try {
          athlete = await fetchJson(refUrl);
          athleteCache.set(refUrl, athlete);
        } catch { athlete = null; }
      }
      if (!athlete?.displayName) continue;
      athletes.push(athlete);
      pair.push({ athlete, winner: c.winner === true });
    }
    if (pair.length === 2) fights.push(pair);
  }
  return { fights, athletes };
}

async function upsertFighter({ name, record, espnId }, summary) {
  const key = playerKey(name);
  if (!key) return;
  // Never overwrite a stored record with null: a flaky records fetch on a
  // later run must not blank a fighter we already know. Omitted columns
  // are left untouched on conflict.
  const row = {
    fighter_key: key,
    fighter_name: name,
    updated_at: new Date().toISOString(),
  };
  if (record) row.record = record;
  if (espnId != null) row.espn_id = String(espnId);
  const { error } = await supabase.from('ufc_fighters').upsert(row, { onConflict: 'fighter_key' });
  if (error) summary.errors.push(`fighter ${name}: ${error.message}`);
  else summary.fighters++;
}

async function upsertCoreAthlete(athlete, summary) {
  let record = null;
  const recordsRef = athlete.records?.$ref;
  if (recordsRef) {
    try {
      record = recordFromRecordsPayload(await fetchJson(recordsRef));
    } catch { /* record stays null, name row still lands */ }
  }
  if (!record) summary.records_missing.push(athlete.displayName);
  await upsertFighter({ name: athlete.displayName, record, espnId: athlete.id }, summary);
}

/**
 * The site scoreboard already carries competitor names and records inline
 * (competitors[].records[].summary), no core-API refs needed. Harvest them
 * first so a card whose core event lookup fails, or whose athletes are
 * brand-new prospects with flaky refs (Contender Series debuts), still
 * gets record rows before analysis runs.
 */
async function harvestScoreboardFighters(event, syncedAthletes, summary) {
  for (const comp of (event.competitions || [])) {
    for (const c of (comp.competitors || [])) {
      const name = c.athlete?.displayName || c.athlete?.fullName || null;
      if (!name) continue;
      const dedupe = `sb:${name}`;
      if (syncedAthletes.has(dedupe)) continue;
      syncedAthletes.add(dedupe);
      const record = (Array.isArray(c.records) && c.records[0]?.summary)
        || c.displayRecord || c.athlete?.record || null;
      await upsertFighter({ name, record, espnId: c.athlete?.id }, summary);
    }
  }
}

async function runSync(days) {
  const startTime = Date.now();
  const summary = { fighters: 0, fights: 0, events: 0, errors: [], records_missing: [] };
  const athleteCache = new Map();
  const syncedAthletes = new Set();

  try {
    if (days < MAX_DAYS) {
      const { count } = await supabase
        .from('ufc_fight_results')
        .select('id', { count: 'exact', head: true });
      if (count === 0) {
        console.log(`  🥊 Empty results table, backfilling ${MAX_DAYS} days`);
        days = MAX_DAYS;
      }
    }
    console.log(`\n🥊 CRON: Syncing UFC data (${days} days back, ${UPCOMING_DAYS} ahead)...`);

    // One pass over past (results + fighters) and future (fighters only)
    // scoreboard dates. Non-event days return empty and cost one fetch.
    for (let offset = -days; offset <= UPCOMING_DAYS; offset++) {
      const date = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
      let events;
      try {
        const sb = await fetchJson(`${SITE_BASE}/mma/ufc/scoreboard?dates=${yyyymmdd(date)}`);
        events = sb.events || [];
      } catch { continue; }
      if (events.length === 0) continue;

      for (const event of events) {
        if (!event?.id) continue;
        summary.events++;

        // Inline scoreboard data first: works even when the core event
        // lookup below fails, and covers late replacements.
        try {
          await harvestScoreboardFighters(event, syncedAthletes, summary);
        } catch (err) {
          summary.errors.push(`scoreboard harvest ${event.id}: ${err.message}`);
        }

        let fights;
        try {
          ({ fights } = await (async () => {
            const r = await getEventFights(event.id, athleteCache);
            for (const athlete of r.athletes) {
              const dedupe = athlete.$ref || athlete.id || athlete.displayName;
              if (syncedAthletes.has(dedupe)) continue;
              syncedAthletes.add(dedupe);
              await upsertCoreAthlete(athlete, summary);
            }
            return r;
          })());
        } catch (err) {
          summary.errors.push(`event ${event.id}: ${err.message}`);
          continue;
        }

        for (const pair of fights) {

          // Store the result only for completed past fights.
          const winner = pair.find(p => p.winner);
          const loser = pair.find(p => !p.winner);
          if (offset <= 0 && winner && loser) {
            const row = {
              event: event.name || event.shortName || null,
              fight_date: isoDate(date),
              winner_name: winner.athlete.displayName,
              winner_key: playerKey(winner.athlete.displayName),
              loser_name: loser.athlete.displayName,
              loser_key: playerKey(loser.athlete.displayName),
              source: 'espn',
            };
            if (row.winner_key && row.loser_key && row.winner_key !== row.loser_key) {
              const { error } = await supabase
                .from('ufc_fight_results')
                .upsert(row, { onConflict: 'fight_date,winner_key,loser_key' });
              if (error) summary.errors.push(`fight ${row.winner_key}/${row.loser_key}: ${error.message}`);
              else summary.fights++;
            }
          }
        }
      }
      await new Promise(r => setTimeout(r, 250));
    }

    await supabase.from('cron_job_logs').insert({
      job_name: 'sync-ufc-data',
      status: summary.errors.length === 0 ? 'completed' : 'partial',
      details: JSON.stringify({
        days,
        events: summary.events,
        fighters_upserted: summary.fighters,
        fights_upserted: summary.fights,
        records_missing: summary.records_missing.slice(0, 10),
        errors: summary.errors.slice(0, 5),
        duration_ms: Date.now() - startTime,
      }),
    });
    console.log(`✅ UFC sync complete: ${summary.events} events, ${summary.fighters} fighters, ${summary.fights} fights in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  } catch (error) {
    console.error('❌ UFC sync failed:', error.message);
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: 'sync-ufc-data',
        status: 'failed',
        details: JSON.stringify({ error: error.message }),
      });
    } catch (e) { /* don't block on logging */ }
  }
}

async function syncUfcData(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const days = Math.min(MAX_DAYS, Math.max(1, parseInt(req.query.days, 10) || DEFAULT_DAYS));
  res.status(202).json({ status: 'accepted', message: `UFC sync started (${days} days of results)` });
  runSync(days).catch(err => console.error('❌ UFC sync background error:', err.message));
}

module.exports = syncUfcData;
