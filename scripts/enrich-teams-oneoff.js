#!/usr/bin/env node
/*
  scripts/enrich-teams-oneoff.js

  One-off Node script to enrich teams in the `teams` table by fetching ESPN team details
  and PATCHing rows via Supabase REST using the service role key.

  Usage (example):
    SUPABASE_URL=https://your.supabase.url SUPABASE_SERVICE_ROLE_KEY=your_key node scripts/enrich-teams-oneoff.js --sport NFL

  Notes:
  - Requires Node 18+ (fetch available globally) or use node --experimental-fetch on older versions.
  - Safe: this script PATCHes rows by team_id; it won't create duplicates.
*/

// Minimal arg parsing to avoid adding dependencies. Supports: --sport NFL
function parseArgs() {
  const raw = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = raw[i+1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

const argv = parseArgs();
const sport = (argv.sport || 'NFL').toUpperCase();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const SPORT_MAP = {
  NFL: 'football/nfl',
  NBA: 'basketball/nba',
  MLB: 'baseball/mlb',
  NHL: 'hockey/nhl',
  NCAAF: 'football/college-football'
};

async function supabaseGet(path) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY } });
  if (!res.ok) throw new Error(`Supabase GET failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabasePatch(path, body) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Supabase PATCH failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchWithTimeout(url, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Cray_Cray_Enrich/1.0' } });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

async function enrich() {
  console.log('Enrichment started for sport:', sport);
  // fetch teams for sport from Supabase
  const q = `teams?select=team_id,espn_id,provider_ids,team_name,city,abbreviation,logo&sport=eq.${encodeURIComponent(sport)}`;
  let teams = [];
  try {
    teams = await supabaseGet(q);
  } catch (e) {
    console.error('Failed to fetch teams from Supabase:', e.message || e);
    process.exit(1);
  }

  const toEnrich = teams.filter(t => (!t.team_name || !t.logo || !t.abbreviation || !t.city) && (t.espn_id || (t.provider_ids && t.provider_ids.espn)));
  console.log(`Found ${teams.length} teams for ${sport}, ${toEnrich.length} need enrichment.`);

  let success = 0;
  for (const et of toEnrich) {
    const espnId = et.espn_id || (et.provider_ids && et.provider_ids.espn);
    if (!espnId) continue;
    try {
      const path = SPORT_MAP[sport];
      const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${encodeURIComponent(espnId)}`;
      const res = await fetchWithTimeout(url, 10000);
      if (!res.ok) throw new Error(`ESPN fetch ${res.status}`);
      const j = await res.json();
      const teamObj = j?.team || j?.teams?.[0] || j;
      const updated = {
        team_name: teamObj?.displayName || teamObj?.name || teamObj?.fullName || null,
        name: teamObj?.displayName || teamObj?.name || teamObj?.fullName || null,
        city: teamObj?.location || teamObj?.shortDisplayName || null,
        abbreviation: teamObj?.abbreviation || null,
        logo: (teamObj?.logos && teamObj.logos[0] && teamObj.logos[0].href) || teamObj?.logo || null,
        provider_ids: { ...(et.provider_ids || {}), espn: teamObj?.id || espnId },
        espn_id: teamObj?.id || espnId,
        last_updated: new Date().toISOString()
      };
      try {
        await supabasePatch(`teams?team_id=eq.${encodeURIComponent(et.team_id)}`, updated);
        console.log('Enriched team', et.team_id);
        success += 1;
      } catch (upErr) {
        console.warn('Failed to patch team', et.team_id, upErr.message || upErr);
      }
    } catch (fetchErr) {
      console.warn('Failed to fetch team detail from ESPN for', et.team_id, fetchErr.message || fetchErr);
    }
  }

  console.log(`Enrichment complete. ${success}/${toEnrich.length} teams updated.`);
}

enrich().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
