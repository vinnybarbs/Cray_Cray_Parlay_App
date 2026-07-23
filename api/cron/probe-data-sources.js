/**
 * Daily probe across every (source, sport) endpoint we depend on.
 *
 * For each probe we record:
 *   - whether the endpoint returned (status: ok / empty / error)
 *   - the top-level JSON keys (so we can detect when ESPN renames a field)
 *   - how many events/matches/fights were returned
 *   - elapsed time
 *
 * Anomaly detection lives in the admin dashboard reading data_source_health:
 * any (source, sport) with no 'ok' row in the last 24h is flagged red.
 *
 * This is our insurance against ESPN silently changing shape. The last time
 * ESPN added new soccer status types (STATUS_FULL_TIME, etc) we missed every
 * EPL/MLS game for weeks before noticing. The probe would have caught it
 * because events_seen would have stayed flat or dropped to zero.
 *
 * POST /cron/probe-data-sources?secret=...
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../../shared/logger');

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE = 'http://sports.core.api.espn.com/v2/sports';

const ESPN_PROBES = [
  { sport: 'NBA',    url: `${SITE}/basketball/nba/scoreboard` },
  { sport: 'NHL',    url: `${SITE}/hockey/nhl/scoreboard` },
  { sport: 'MLB',    url: `${SITE}/baseball/mlb/scoreboard` },
  { sport: 'NFL',    url: `${SITE}/football/nfl/scoreboard` },
  { sport: 'NCAAB',  url: `${SITE}/basketball/mens-college-basketball/scoreboard?groups=50&limit=200` },
  { sport: 'NCAAF',  url: `${SITE}/football/college-football/scoreboard?groups=50&limit=200` },
  { sport: 'EPL',    url: `${SITE}/soccer/eng.1/scoreboard` },
  { sport: 'MLS',    url: `${SITE}/soccer/usa.1/scoreboard` },
  { sport: 'Tennis', url: `${SITE}/tennis/atp/scoreboard` },
  { sport: 'UFC',    url: `${SITE}/mma/ufc/scoreboard` },
];

// Shape assertions per source. If any required key is missing the probe is
// flagged 'shape_mismatch' even when the call returned 200. That's the
// silent-break case we care about most.
const ESPN_REQUIRED_KEYS = ['events'];
const ODDS_API_REQUIRED_KEYS = ['id', 'sport_key', 'home_team', 'away_team', 'commence_time'];

async function probeEspnSite(sport, url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { status: 'error', error: `HTTP ${res.status}`, duration_ms: Date.now() - t0 };
    }
    const data = await res.json();
    const sampleKeys = Object.keys(data);
    const missing = ESPN_REQUIRED_KEYS.filter(k => !sampleKeys.includes(k));
    if (missing.length) {
      return {
        status: 'shape_mismatch',
        error: `Missing keys: ${missing.join(',')}`,
        sample_keys: sampleKeys,
        duration_ms: Date.now() - t0,
      };
    }
    return {
      status: 'ok',
      events_seen: (data.events || []).length,
      sample_keys: sampleKeys.slice(0, 15),
      duration_ms: Date.now() - t0,
    };
  } catch (err) {
    return { status: 'error', error: err.message, duration_ms: Date.now() - t0 };
  }
}

async function probeEspnCoreUfc() {
  // Validate the core API drill-down still works. We don't have a known recent
  // event ID without a scoreboard call, so we walk scoreboard -> first event ->
  // competitions list. If competitions endpoint returns count > 1 we're good
  // (a fight card has many competitions).
  const t0 = Date.now();
  try {
    const sbRes = await fetch(`${SITE}/mma/ufc/scoreboard`);
    if (!sbRes.ok) return { status: 'error', error: `Scoreboard HTTP ${sbRes.status}`, duration_ms: Date.now() - t0 };
    const sbData = await sbRes.json();
    const eventId = (sbData.events || [])[0]?.id;
    if (!eventId) return { status: 'empty', sample_keys: Object.keys(sbData), duration_ms: Date.now() - t0 };

    const cRes = await fetch(`${CORE}/mma/leagues/ufc/events/${eventId}/competitions?limit=50`);
    if (!cRes.ok) return { status: 'error', error: `Core HTTP ${cRes.status}`, duration_ms: Date.now() - t0 };
    const cData = await cRes.json();
    const sampleKeys = Object.keys(cData);
    if (!sampleKeys.includes('items')) {
      return { status: 'shape_mismatch', error: 'Missing items[]', sample_keys: sampleKeys, duration_ms: Date.now() - t0 };
    }
    return {
      status: 'ok',
      events_seen: (cData.items || []).length,
      sample_keys: sampleKeys,
      duration_ms: Date.now() - t0,
    };
  } catch (err) {
    return { status: 'error', error: err.message, duration_ms: Date.now() - t0 };
  }
}

async function probeOddsApi(supabase) {
  // Don't burn an Odds API call. Instead read odds_cache freshness as a proxy.
  // If the hourly cron is writing, the source is alive.
  const t0 = Date.now();
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('odds_cache')
      .select('*', { count: 'exact', head: true })
      .gt('commence_time', oneHourAgo);
    if (error) return { status: 'error', error: error.message, duration_ms: Date.now() - t0 };
    return {
      status: (count || 0) > 0 ? 'ok' : 'empty',
      events_seen: count || 0,
      sample_keys: ['proxied_via_odds_cache_freshness'],
      duration_ms: Date.now() - t0,
    };
  } catch (err) {
    return { status: 'error', error: err.message, duration_ms: Date.now() - t0 };
  }
}

async function probeOddsApiScoresCache(supabase) {
  const t0 = Date.now();
  try {
    const { count, error } = await supabase
      .from('odds_api_scores')
      .select('*', { count: 'exact', head: true })
      .gt('fetched_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if (error) return { status: 'error', error: error.message, duration_ms: Date.now() - t0 };
    return {
      status: (count || 0) > 0 ? 'ok' : 'empty',
      events_seen: count || 0,
      sample_keys: ['proxied_via_odds_api_scores_writes'],
      duration_ms: Date.now() - t0,
    };
  } catch (err) {
    return { status: 'error', error: err.message, duration_ms: Date.now() - t0 };
  }
}

async function probeDataSources(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const rows = [];

  for (const probe of ESPN_PROBES) {
    const result = await probeEspnSite(probe.sport, probe.url);
    rows.push({ source: 'espn', sport: probe.sport, endpoint: probe.url, ...result });
  }

  rows.push({
    source: 'espn_core',
    sport: 'UFC',
    endpoint: `${CORE}/mma/leagues/ufc/events/<id>/competitions`,
    ...(await probeEspnCoreUfc()),
  });

  rows.push({
    source: 'odds_api',
    sport: 'ALL',
    endpoint: 'odds_cache freshness',
    ...(await probeOddsApi(supabase)),
  });

  rows.push({
    source: 'odds_api_scores',
    sport: 'ALL',
    endpoint: 'odds_api_scores write rate',
    ...(await probeOddsApiScoresCache(supabase)),
  });

  const { error } = await supabase.from('data_source_health').insert(rows);
  if (error) {
    logger.error('Failed to write data_source_health rows', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }

  const summary = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  logger.info('Data source probe complete', { summary });

  return res.json({
    success: true,
    probed: rows.length,
    summary,
    rows: rows.map(r => ({ source: r.source, sport: r.sport, status: r.status, events_seen: r.events_seen, error: r.error_msg || r.error })),
  });
}

module.exports = probeDataSources;
