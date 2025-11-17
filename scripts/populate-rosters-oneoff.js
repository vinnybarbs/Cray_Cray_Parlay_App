#!/usr/bin/env node
/*
  scripts/populate-rosters-oneoff.js

  One-off Node script to fetch rosters for teams in the `teams` table and upsert
  into `players` and `rosters` via Supabase REST using the service role key.

  Usage:
    set -o allexport; source .env.local; set +o allexport
    node scripts/populate-rosters-oneoff.js --sport NFL --season 2024

  Notes:
  - Uses global fetch (Node 18+).
  - Be mindful of rate limits; this script pauses between ESPN requests.
*/

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
const SPORT = (argv.sport || 'NFL').toUpperCase();
const SEASON = argv.season || String(new Date().getFullYear());
const PAUSE_MS = Number(argv.pause_ms || 300); // small pause between requests

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
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

async function supabasePost(path, body, opts) {
  const qp = opts?.on_conflict ? `?on_conflict=${encodeURIComponent(opts.on_conflict)}` : '';
  const url = `${SUPABASE_URL}/rest/v1/${path}${qp}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(Array.isArray(body) ? body : [body])
  });
  if (!res.ok) throw new Error(`Supabase POST failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabaseRpc(fnName, body) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fnName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  // PostgREST/Supabase RPC may return 204 No Content for void functions
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Supabase RPC failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// filesystem helpers for saving payloads when requested
const fs = require('fs');
const path = require('path');


async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchRoster(espnTeamId) {
  const path = SPORT_MAP[SPORT];
  // Try multiple endpoint variations and parse any of ESPN's roster shapes
  const base = `https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${espnTeamId}/roster`;
  const tries = [base, `${base}?season=${encodeURIComponent(SEASON)}`];

  for (const tryUrl of tries) {
    try {
      const res = await fetch(tryUrl, { headers: { 'User-Agent': 'Cray_Cray_Roster/1.0' } });
      if (!res.ok) {
        console.warn('ESPN roster fetch non-OK', res.status, tryUrl);
        continue;
      }
      const j = await res.json();

      // ESPN returns a few shapes:
      // - j.athletes = [ { id, fullName, ... }, ... ]
      // - j.athletes = [ { position: 'offense', items: [ {...}, ... ] }, ... ]
      // - j.team.roster = similar grouping
      let raw = j?.athletes ?? j?.roster ?? j?.team?.roster ?? [];

      // normalize grouped shapes: flatten any position groups with .items arrays
      let flat = [];
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (entry && Array.isArray(entry.items) && entry.items.length > 0) {
            flat.push(...entry.items);
          } else if (entry && Array.isArray(entry.athletes) && entry.athletes.length > 0) {
            flat.push(...entry.athletes);
          } else {
            // entry might already be an athlete object
            flat.push(entry);
          }
        }
      } else if (raw && typeof raw === 'object') {
        // object shaped, try to collect nested arrays
        for (const v of Object.values(raw)) {
          if (Array.isArray(v)) flat.push(...v);
        }
      }

      // Filter and map to the minimal player object
      const players = flat.map(a => {
        const player = a?.athlete || a || {};
        const id = player.id ?? player.uid ?? player.pid ?? player.slug ?? null;
        if (!id) return null;
        return {
          player_id: String(id),
          espn_id: player.id ?? null,
          player_name: player.fullName || player.displayName || player.name || null,
          sport: SPORT,
          name: player.fullName || player.displayName || player.name || null,
          position: (a?.position && a.position.abbreviation) || player.position || null,
          current_team_id: String(espnTeamId),
          provider_ids: { espn: player.id }
        };
      }).filter(Boolean);

      // If we found players, return them immediately
      if (players.length > 0) {
        console.log(`ESPN roster fetch at ${tryUrl} returned ${players.length} players`);
        return players;
      }
      // otherwise try next URL
      console.log(`ESPN roster fetch at ${tryUrl} returned 0 players, trying next variation if any`);
    } catch (err) {
      console.warn('ESPN roster fetch error for', tryUrl, err && err.message ? err.message : err);
    }
  }

  // nothing found
  return [];
}

async function main() {
  console.log(`Populate rosters for sport=${SPORT} season=${SEASON}`);
  // allow targeting a single team via --team or multiple via --teams CSV
  const teamsRaw = await supabaseGet(`teams?select=team_id,espn_id,provider_ids&sport=eq.${encodeURIComponent(SPORT)}`);
  let teams = teamsRaw || [];
  const requestedTeamsCsv = argv.teams || argv.team || null;
  if (requestedTeamsCsv) {
    const requested = String(requestedTeamsCsv).split(',').map(s => s.trim()).filter(Boolean);
    const requestedSet = new Set(requested);
    const before = teams.length;
    teams = teams.filter(t => requestedSet.has(String(t.team_id)));
    const missing = requested.filter(r => !teams.find(t => String(t.team_id) === r));
    if (missing.length > 0) console.warn('Requested teams not found in DB:', missing.join(','));
    console.log(`Processing ${teams.length} of ${before} teams for ${SPORT} (requested ${requested.length})`);
  } else {
    console.log(`Found ${teams.length} teams for ${SPORT}`);
  }

  let totalPlayers = 0;
  let totalRosters = 0;

  // decide mode: dry-run logs payloads and skips DB writes
  const DRY_RUN = !!argv['dry-run'] || !!argv.dryrun || !!argv.dry;
  // save payloads to disk when requested (--save-payloads or --save)
  const SAVE_PAYLOADS = !!argv['save-payloads'] || !!argv.save || !!argv['save_payloads'];
  const SAVE_DIR = argv['save-dir'] || argv['save_dir'] || 'tmp/roster_payloads';

  for (const t of teams) {
    const espnId = t.espn_id || (t.provider_ids && t.provider_ids.espn);
    if (!espnId) { console.warn('Skipping team missing espn id:', t.team_id); continue; }
    try {
      console.log(`Fetching roster for team ${t.team_id} (espn_id=${espnId})`);
      const roster = await fetchRoster(espnId);

      // Build payloads for server-side atomic upsert via rosters_bulk_upsert(payload jsonb)
      const playersPayload = roster.map(p => ({ sport: SPORT, player_id: p.player_id, player_name: p.player_name, name: p.player_name, position: p.position, current_team_id: p.current_team_id, provider_ids: p.provider_ids, espn_id: p.espn_id, last_updated: new Date().toISOString() }));
      const rostersPayload = roster.map(p => ({ sport: SPORT, season: SEASON, team_id: t.team_id, player_id: p.player_id, active: true, provider_ids: p.provider_ids, last_updated: new Date().toISOString() }));

      const rpcPayload = { players: playersPayload, rosters: rostersPayload };

      // Optionally save the full payload to disk for inspection
      if (SAVE_PAYLOADS) {
        try {
          fs.mkdirSync(SAVE_DIR, { recursive: true });
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          const fileName = `rosters_${SPORT}_team-${t.team_id}_${ts}.json`;
          const filePath = path.join(SAVE_DIR, fileName);
          fs.writeFileSync(filePath, JSON.stringify(rpcPayload, null, 2), 'utf8');
          console.log('Saved payload to', filePath);
        } catch (fsErr) {
          console.warn('Failed to save payload for team', t.team_id, fsErr && fsErr.message ? fsErr.message : fsErr);
        }
      }

      if (DRY_RUN) {
        console.log(`Dry run: would call rosters_bulk_upsert for team ${t.team_id} with payload sizes: players=${playersPayload.length} rosters=${rostersPayload.length}`);
        // Log a trimmed payload to avoid massive console output for large rosters
        const sample = {
          players: playersPayload.slice(0,10),
          rosters: rostersPayload.slice(0,10),
          totalPlayers: playersPayload.length,
          totalRosters: rostersPayload.length
        };
        console.log(JSON.stringify(sample, null, 2));
      } else {
        try {
          // Call the RPC endpoint once per team with the full payload
          const rpcRes = await supabaseRpc('rosters_bulk_upsert', { payload: rpcPayload });

          // Normalize different possible PostgREST response shapes into a single summary object
          let summary = null;
          if (rpcRes == null) {
            // void functions may return 204 No Content; in that case we have no summary
            console.log('RPC returned no content for team', t.team_id);
          } else if (Array.isArray(rpcRes) && rpcRes.length > 0) {
            // RPC may return [{ <fn_name>: { ... } }] or [{ ... }]
            if (rpcRes[0] && rpcRes[0].rosters_bulk_upsert) summary = rpcRes[0].rosters_bulk_upsert;
            else summary = rpcRes[0];
          } else if (typeof rpcRes === 'object') {
            // Could be { rosters_bulk_upsert: {...} } or {...}
            if (rpcRes.rosters_bulk_upsert) summary = rpcRes.rosters_bulk_upsert;
            else summary = rpcRes;
          } else {
            summary = rpcRes;
          }

          const playersProcessed = (summary && (summary.players_touched ?? summary.players_inserted ?? playersPayload.length)) || playersPayload.length;
          const rostersProcessed = (summary && ((summary.rosters_inserted ?? 0) + (summary.rosters_updated ?? 0))) || rostersPayload.length;

          totalPlayers += playersProcessed;
          totalRosters += rostersProcessed;

          if (summary) {
            console.log(`Team ${t.team_id} roster processed: players_touched=${summary.players_touched || 0} players_inserted=${summary.players_inserted || 0} players_updated=${summary.players_updated || 0} rosters_inserted=${summary.rosters_inserted || 0} rosters_updated=${summary.rosters_updated || 0}`);
          } else {
            console.log(`Team ${t.team_id} roster processed: ${playersProcessed} players (RPC)`);
          }
        } catch (e) {
          console.warn('RPC rosters_bulk_upsert failed for team', t.team_id, e.message || (e && e.toString && e.toString()));
        }
      }

      await sleep(PAUSE_MS);
    } catch (err) {
      console.warn('Failed roster for team', t.team_id, err.message || err);
      await sleep(PAUSE_MS * 2);
    }
  }

  console.log(`Done. Total players touched: ${totalPlayers}, roster rows upserted: ${totalRosters}`);
}

main().catch(e => { console.error('Fatal', e.message || e); process.exit(1); });
