/**
 * CRON: Sync Standings from ESPN
 * Fetches current standings for all sports from ESPN public API
 * Populates standings table (via teams foreign key) for accurate W-L records
 *
 * Schedule: Every 6 hours
 * Endpoint: POST /cron/sync-standings
 */

const { supabase } = require('../../lib/middleware/supabaseAuth.js');

const ESPN_STANDINGS = 'https://site.web.api.espn.com/apis/v2/sports';

const SPORT_CONFIGS = {
  NBA:   { path: 'basketball/nba',                        season: () => currentSeason('NBA') },
  NHL:   { path: 'hockey/nhl',                            season: () => currentSeason('NHL') },
  MLB:   { path: 'baseball/mlb',                          season: () => new Date().getFullYear() },
  NFL:   { path: 'football/nfl',                          season: () => currentSeason('NFL') },
  NCAAB: { path: 'basketball/mens-college-basketball',    season: () => currentSeason('NCAAB'), groups: 50 },
  NCAAF: { path: 'football/college-football',             season: () => currentSeason('NCAAF'), groups: 80 },
  EPL:   { path: 'soccer/eng.1',                          season: () => currentSeason('EPL') },
  MLS:   { path: 'soccer/usa.1',                          season: () => new Date().getFullYear() }
};

/**
 * Determine the current season year for sports that span two calendar years.
 * NBA/NHL/NCAAB/NCAAF: season starts in fall, so Aug-Dec = this year, Jan-Jul = last year.
 * MLB/EPL: season = calendar year.
 */
function currentSeason(sport) {
  // Use current year for all sports. The current_standings view filters
  // WHERE season = EXTRACT(YEAR FROM CURRENT_DATE), so we must match.
  return new Date().getFullYear();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch standings from ESPN for a given sport
 */
async function fetchESPNStandings(sport, config, seasonOverride = null) {
  // The college configs declare a group id (80 = FBS football, 50 = D1
  // basketball) that was never sent, so the bare endpoint returned a
  // partial field (88 of ~134 FBS teams on the 2026-08-28 first NCAAF
  // sync). Harmless for sports without a group. If ESPN ignores the
  // param the result is unchanged, so this can only widen coverage.
  // A season override pulls a past season's final table (the prior
  // season record shown on a 0-0 tile, 2026-09-12); ESPN takes ?season=.
  const params = [];
  if (config.groups) params.push(`group=${config.groups}`);
  if (seasonOverride) params.push(`season=${seasonOverride}`);
  const url = `${ESPN_STANDINGS}/${config.path}/standings${params.length ? '?' + params.join('&') : ''}`;
  console.log(`  Fetching ${sport}: ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  ⚠️ ${sport} returned ${res.status}`);
    return [];
  }

  const data = await res.json();
  const teams = [];

  for (const group of (data.children || [])) {
    const conference = group.name || null; // "Eastern Conference", "American League", etc.

    for (const entry of (group.standings?.entries || [])) {
      const team = entry.team;
      if (!team?.displayName) continue;

      // Build stats map
      const stats = {};
      for (const s of (entry.stats || [])) {
        stats[s.name] = s.displayValue || s.value;
      }

      // NHL's third column is overtime losses (key `otLosses`), NOT `ties`.
      // Soccer (EPL/MLS) uses `ties` for draws, and ESPN's stats match. Every
      // other sport has no third column; `ties` is 0 or absent.
      const thirdCol = sport === 'NHL'
        ? (parseInt(stats.otLosses ?? stats.overtimeLosses) || 0)
        : (parseInt(stats.ties) || 0);

      // Strip ", N PTS" suffix that ESPN adds to some display strings (e.g.
      // NHL "7-2-1, 0 PTS"). Keep just the record portion.
      const cleanDisplay = (v) => typeof v === 'string' ? v.split(',')[0].trim() : v;

      teams.push({
        espn_id: team.id,
        name: team.displayName,
        abbreviation: team.abbreviation,
        sport,
        conference,
        wins: parseInt(stats.wins) || 0,
        losses: parseInt(stats.losses) || 0,
        ties: thirdCol,
        points_for: parseInt(stats.pointsFor) || 0,
        points_against: parseInt(stats.pointsAgainst) || 0,
        point_differential: parseInt(stats.pointDifferential) || 0,
        streak: stats.streak || null,
        win_pct: parseFloat(stats.winPercent) || 0,
        home_record: cleanDisplay(stats.Home) || null,
        away_record: cleanDisplay(stats.Road) || null,
        last_10: cleanDisplay(stats['Last Ten Games'] || stats['Last Ten']) || null,
        playoff_seed: parseInt(stats.playoffSeed) || null
      });
    }
  }

  return teams;
}

/**
 * Ensure team exists in teams table, return team_id
 */
async function ensureTeam(teamData) {
  try {
    const espnId = teamData.espn_id != null ? String(teamData.espn_id) : null;

    // Identity first: the ESPN id is the only key that cannot collide.
    if (espnId) {
      const { data: byId } = await supabase
        .from('teams')
        .select('id')
        .eq('sport', teamData.sport)
        .eq('provider_ids->>espn', espnId)
        .limit(1);
      if (byId?.length) return byId[0].id;
    }

    // A name match is only trusted when the candidate does not already
    // belong to a different ESPN team. The old last-word fallback let
    // Sporting Kansas City land on Orlando City SC's row (%City%) and
    // folded Newcastle, West Ham and Leeds into Manchester United
    // (%United%), so those clubs never got rows and the wrong club's
    // record priced live MLS and EPL games (2026-09-09).
    const claimIfFree = async (rows) => {
      const row = (rows || []).find(r => {
        const existing = r.provider_ids?.espn != null ? String(r.provider_ids.espn) : null;
        return !existing || !espnId || existing === espnId;
      });
      if (!row) return null;
      if (espnId && row.provider_ids?.espn == null) {
        await supabase.from('teams')
          .update({ provider_ids: { ...(row.provider_ids || {}), espn: espnId } })
          .eq('id', row.id);
      }
      return row.id;
    };

    // Exact name match
    const { data: exact } = await supabase
      .from('teams')
      .select('id, name, provider_ids')
      .eq('sport', teamData.sport)
      .eq('name', teamData.name)
      .limit(3);
    const exactId = await claimIfFree(exact);
    if (exactId) return exactId;

    // Containment match on the full name (handles "LA Clippers" vs
    // "Los Angeles Clippers")
    const { data: fuzzyFull } = await supabase
      .from('teams')
      .select('id, name, provider_ids')
      .eq('sport', teamData.sport)
      .ilike('name', `%${teamData.name}%`)
      .limit(3);
    const fullId = await claimIfFree(fuzzyFull);
    if (fullId) return fullId;

    // Mascot match (last word), never for soccer where the last word is a
    // club suffix shared across the league (United, City, FC, Town).
    const SOCCER = new Set(['EPL', 'MLS']);
    const mascot = teamData.name.split(' ').slice(-1)[0];
    if (!SOCCER.has(teamData.sport) && mascot.length >= 4) {
      const { data: fuzzyMascot } = await supabase
        .from('teams')
        .select('id, name, provider_ids')
        .eq('sport', teamData.sport)
        .ilike('name', `%${mascot}%`)
        .limit(3);
      const mascotId = await claimIfFree(fuzzyMascot);
      if (mascotId) return mascotId;
    }

    // Insert new team
    const { data: newTeam, error } = await supabase
      .from('teams')
      .insert({
        sport: teamData.sport,
        name: teamData.name,
        provider_ids: { espn: teamData.espn_id }
      })
      .select('id')
      .single();

    if (error) {
      console.warn(`  ⚠️ Failed to create team ${teamData.name}: ${error.message}`);
      return null;
    }

    console.log(`  ➕ Created team: ${teamData.name} (${teamData.sport})`);
    return newTeam.id;
  } catch (err) {
    console.warn(`  ⚠️ ensureTeam error for ${teamData.name}: ${err.message}`);
    return null;
  }
}

/**
 * Main handler
 */
async function syncStandings(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sportsParam = (req.query.sports || 'NBA,NHL,MLB,NFL,NCAAB').toUpperCase();
  const sports = sportsParam.split(',').map(s => s.trim()).filter(s => SPORT_CONFIGS[s]);
  // ?season=2025 stores that season's table under its own key instead of
  // the current one (prior_season_standings view reads year minus one).
  const seasonOverride = /^\d{4}$/.test(String(req.query.season || '')) ? parseInt(req.query.season, 10) : null;

  res.status(202).json({ status: 'accepted', message: `Syncing standings for ${sports.join(', ')}` });

  const startTime = Date.now();
  const results = {};

  try {
    for (const sport of sports) {
      const config = SPORT_CONFIGS[sport];
      const season = seasonOverride || config.season();

      try {
        const teams = await fetchESPNStandings(sport, config, seasonOverride);
        let upserted = 0;
        const seenTeamIds = [];

        for (const team of teams) {
          const teamId = await ensureTeam(team);
          if (!teamId) continue;
          seenTeamIds.push(teamId);

          const { error } = await supabase
            .from('standings')
            .upsert({
              team_id: teamId,
              season,
              conference: team.conference,
              division: null,
              wins: team.wins,
              losses: team.losses,
              ties: team.ties,
              points_for: team.points_for,
              points_against: team.points_against,
              point_differential: team.point_differential,
              streak: team.streak,
              last_10: team.last_10,
              home_record: team.home_record,
              away_record: team.away_record,
              playoff_seed: team.playoff_seed,
              updated_at: new Date().toISOString()
            }, { onConflict: 'team_id,season' });

          if (!error) upserted++;
        }

        // Purge teams that left the table: standings are keyed by calendar
        // year, so a relegated or promoted club keeps last season's full
        // record under the same season key (EPL 2026-09-09: Burnley
        // 4-10-24 and Wolves 3-11-24 sat beside 3-match rows and made the
        // league read 20 wins against 68 losses). Only on a real fetch,
        // never on an empty one, so a blocked ESPN cannot wipe a table.
        let purged = 0;
        if (teams.length >= 10 && seenTeamIds.length >= 10) {
          const { data: sportTeams } = await supabase
            .from('teams').select('id').eq('sport', sport);
          const staleIds = (sportTeams || []).map(t => t.id).filter(id => !seenTeamIds.includes(id));
          if (staleIds.length > 0) {
            const { error: purgeErr, count } = await supabase
              .from('standings').delete({ count: 'exact' })
              .eq('season', season).in('team_id', staleIds);
            if (!purgeErr) purged = count || 0;
          }
        }

        results[sport] = { found: teams.length, upserted, purged };
        console.log(`✅ ${sport}: ${upserted}/${teams.length} teams synced (season ${season})`);

      } catch (err) {
        console.error(`❌ ${sport} failed:`, err.message);
        results[sport] = { error: err.message };
      }

      await sleep(500);
    }

    // Log to cron_job_logs. Every sport finding zero teams is ESPN
    // starvation (a denied host, 2026-09-08), never a completed sync.
    const duration = Date.now() - startTime;
    const allEmpty = sports.length > 0 && sports.every(s => (results[s]?.found ?? 0) === 0);
    await supabase.from('cron_job_logs').insert({
      job_name: 'sync-standings',
      status: allEmpty ? 'partial' : 'completed',
      details: JSON.stringify({ results, duration_ms: duration, ...(allEmpty ? { error: 'every sport returned zero teams from ESPN' } : {}) })
    });

    console.log(`\n📊 Standings sync complete in ${(duration / 1000).toFixed(1)}s`, results);

  } catch (err) {
    console.error('❌ Standings sync failed:', err.message);
  }
}

module.exports = syncStandings;
