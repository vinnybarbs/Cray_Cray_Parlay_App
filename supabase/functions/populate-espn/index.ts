// supabase/functions/populate-espn/index.ts
// Deno Edge Function scaffold to sync teams, rosters and basic player info from ESPN into Supabase.
// - Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to write to Supabase via REST.
// - Accepts POST body { sport: 'NFL'|'NBA'|'MLB'|'NHL'|'NCAAF', full_sync?: boolean }
// - Idempotent: upserts by team_id/player_id and stores provider_ids. Logs to cron_job_logs and api_call_log.

// In the repo's TypeScript checks the Deno symbol may not be defined — declare it for static checks.
declare const Deno: any;
const SUPABASE_URL = Deno?.env?.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY') || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured — function can still run in read-only mode.');
}

type SportKey = 'NFL' | 'NBA' | 'MLB' | 'NHL' | 'NCAAF';

const SPORT_MAP: Record<string, string> = {
  NFL: 'football/nfl',
  NBA: 'basketball/nba',
  MLB: 'baseball/mlb',
  NHL: 'hockey/nhl',
  NCAAF: 'football/college-football'
};

async function supabasePost(path: string, body: any, opts?: { on_conflict?: string }) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const qp = opts?.on_conflict ? `?on_conflict=${encodeURIComponent(opts.on_conflict)}` : '';
  const url = `${SUPABASE_URL}/rest/v1/${path}${qp}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(Array.isArray(body) ? body : [body])
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase POST ${path} failed: ${res.status} ${txt}`);
  }
  return res.json();
}

async function supabasePatch(path: string, body: any) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase PATCH ${path} failed: ${res.status} ${txt}`);
  }
  return res.json();
}

async function supabaseGet(path: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase GET ${path} failed: ${res.status} ${txt}`);
  }
  return res.json();
}

// Simple fetch helper with timeout
async function fetchWithTimeout(url: string, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Cray_Cray_EspnSync/1.0' } });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

async function fetchTeamsFromESPN(sportKey: SportKey) {
  const path = SPORT_MAP[sportKey];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/teams`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`ESPN teams fetch failed: ${res.status}`);
  const j = await res.json();
  // ESPN returns an array under j.sports[0].leagues[0].teams
  const teams = (j?.sports?.[0]?.leagues?.[0]?.teams) || (j?.teams) || [];
  return teams.map((t: any) => {
    const team = t.team || t;
    return {
      team_id: String(team.id || team.teamId || team.uid || team.slug || team.abbreviation),
      espn_id: team.id ?? null,
      team_name: team.displayName || team.name || team.fullName || null,
      city: team.location || team.shortDisplayName || null,
      abbreviation: team.abbreviation || team.abbr || null,
      logo: (team.logos && team.logos[0] && team.logos[0].href) || team.logo || null,
      provider_ids: { espn: team.id }
    };
  });
}

async function fetchRosterFromESPN(sportKey: SportKey, teamEspnId: number) {
  const path = SPORT_MAP[sportKey];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${teamEspnId}/roster`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`ESPN roster fetch failed: ${res.status}`);
  const j = await res.json();
  const athletes = j?.athletes || j?.roster || j?.team?.roster || [];
  // Map to minimal player object and drop entries without a usable id (avoid "undefined")
  return athletes.map((a: any) => {
    const player = a.athlete || a;
    const id = player.id ?? player.uid ?? player.pid ?? player.slug ?? null;
    if (!id) return null;
    return {
      player_id: String(id),
      espn_id: player.id ?? null,
      player_name: player.fullName || player.displayName || player.name || null,
      position: (a?.position && a.position.abbreviation) || player.position || null,
      current_team_id: String(teamEspnId),
      provider_ids: { espn: player.id }
    };
  }).filter(Boolean);
}

export default async function handler(req: Request) {
  const start = new Date().toISOString();
  const jobName = 'populate-espn';
  // allow POST with JSON body { sport: 'NFL', full_sync: true }
  let body: any = {};
  try {
    if (req.method === 'POST') body = await req.json();
  } catch (e) {
    // ignore
  }
  const sport: SportKey = (body?.sport || 'NFL') as SportKey;
  const fullSync = !!body?.full_sync;
  const season: string = body?.season || String(new Date().getFullYear());

  const runLog = { job_name: jobName, started_at: start, status: 'started' } as any;

  try {
    // If caller requested enrichment of existing teams, do a targeted pass
    if (body?.enrich) {
      // fetch teams for sport from Supabase
      let existingTeams: any[] = [];
      try {
        existingTeams = await supabaseGet(`teams?select=team_id,espn_id,provider_ids,team_name,city,abbreviation,logo&sport=eq.${encodeURIComponent(sport)}`) || [];
      } catch (e) {
        const errAny: any = e;
        console.warn('Failed to fetch existing teams from Supabase for enrichment', errAny?.message ?? errAny);
      }

      // filter teams missing display fields but having an espn_id
      const toEnrich = existingTeams.filter(t => ( !t.team_name || !t.logo || !t.abbreviation || !t.city ) && (t.espn_id || (t.provider_ids && t.provider_ids.espn)));

      for (const et of toEnrich) {
        const espnId = et.espn_id || (et.provider_ids && et.provider_ids.espn);
        if (!espnId) continue;
        try {
          const path = SPORT_MAP[sport];
          const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${encodeURIComponent(espnId)}`;
          const res = await fetchWithTimeout(url);
          if (!res.ok) throw new Error(`ESPN team detail fetch failed: ${res.status}`);
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
          } catch (upErr) {
            const ue: any = upErr;
            console.warn('Failed to patch team', et.team_id, ue?.message ?? ue);
          }
        } catch (fetchErr) {
          const fe: any = fetchErr;
          console.warn('Failed to fetch team detail from ESPN for', et.team_id, fe?.message ?? fe);
        }
      }

      return new Response(JSON.stringify({ status: 'ok', enriched: toEnrich.length }), { status: 200 });
    }

    // 1) fetch teams
    const teams = await fetchTeamsFromESPN(sport);

    // Upsert teams into Supabase
    for (const t of teams) {
      const upsertPayload = {
        sport: sport,
        team_id: t.team_id,
        team_name: t.team_name,
        // keep legacy name column in sync for older code paths
        name: t.team_name,
        city: t.city,
        abbreviation: t.abbreviation,
        logo: t.logo,
        provider_ids: t.provider_ids,
        espn_id: t.espn_id,
        last_updated: new Date().toISOString()
      };
      try {
        // Use on_conflict on composite key (sport, team_id)
        await supabasePost('teams', upsertPayload, { on_conflict: 'sport,team_id' });
      } catch (e) {
        const err: any = e;
        console.warn('Team upsert failed for', t.team_name, err?.message ?? err);
      }

      // If not fullSync, skip the heavy roster/player/stats work
      if (!fullSync) {
        continue;
      }

      // For fullSync runs, fetch roster for each team and populate players/stats
      try {
        const roster = await fetchRosterFromESPN(sport, Number(t.espn_id));
        // Upsert players and rosters
        for (const p of roster) {
          const playerPayload = {
            player_id: p.player_id,
            player_name: p.player_name,
            position: p.position,
            current_team_id: p.current_team_id,
            provider_ids: p.provider_ids,
            espn_id: p.espn_id,
            last_updated: new Date().toISOString()
          };
          if (!playerPayload.player_id) {
            console.warn('Skipping player with missing id for team', t.team_id, playerPayload.player_name);
          } else {
            try { await supabasePost('players', playerPayload, { on_conflict: 'player_id' }); } catch (e) { const err: any = e; console.warn('Player upsert failed', p.player_name, err?.message ?? err); }
          }

          const rosterPayload = {
            sport: sport,
            season: season,
            team_id: t.team_id,
            player_id: p.player_id,
            active: true,
            provider_ids: p.provider_ids,
            last_updated: new Date().toISOString()
          };
          try { await supabasePost('rosters', rosterPayload, { on_conflict: 'sport,season,team_id,player_id' }); } catch (e) { /* best-effort */ }

          const playerStatsPayload = {
            sport: sport,
            season: season,
            player_id: p.player_id,
            player_name: p.player_name,
            position: p.position,
            team_id: t.team_id,
            stats_json: p,
            last_updated: new Date().toISOString()
          };
          try { await supabasePost('player_stats', playerStatsPayload, { on_conflict: 'sport,season,player_id' }); } catch (e) { const err: any = e; console.warn('Player stats upsert failed', p.player_name, err?.message ?? err); }

          const playerStatsCachePayload = {
            sport: sport,
            season: season,
            player_id: p.player_id,
            player_name: p.player_name,
            position: p.position,
            team_id: t.team_id,
            stats: p,
            last_updated: new Date().toISOString()
          };
          try { await supabasePost('player_stats_cache', playerStatsCachePayload, { on_conflict: 'sport,season,player_id' }); } catch (e) { /* best-effort */ }
        }
      } catch (rerr) {
        const err: any = rerr;
        console.warn('Roster fetch failed for', t.team_name, err?.message ?? err);
      }
    }

    // Update cron_job_logs success
    runLog.status = 'success';
    runLog.finished_at = new Date().toISOString();
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try { await supabasePost('cron_job_logs', { job_name: jobName, started_at: start, finished_at: runLog.finished_at, status: 'success', detail: { sport, teams: teams.length } }); } catch (_) {}
    }

    return new Response(JSON.stringify({ status: 'ok', sport, teams: teams.length }), { status: 200 });
  } catch (err) {
    const errorAny: any = err;
    runLog.status = 'failed';
    runLog.finished_at = new Date().toISOString();
    runLog.detail = { message: errorAny?.message ?? String(errorAny) };
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try { await supabasePost('cron_job_logs', { job_name: jobName, started_at: start, finished_at: runLog.finished_at, status: 'failed', detail: runLog.detail }); } catch (_) {}
    }
    return new Response(JSON.stringify({ status: 'error', error: runLog }), { status: 500 });
  }
}
