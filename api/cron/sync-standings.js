/**
 * CRON: Sync Standings from ESPN
 * Fetches current standings for all sports from ESPN public API
 * Populates standings table (via teams foreign key) for accurate W-L records
 *
 * Schedule: Every 6 hours
 * Endpoint: POST /cron/sync-standings
 */

const { supabase } = require('../../lib/middleware/supabaseAuth.js');

const ESPN_STANDINGS = 'https://site.api.espn.com/apis/v2/sports';

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
  // Use current year for all sports — the current_standings view filters
  // WHERE season = EXTRACT(YEAR FROM CURRENT_DATE), so we must match.
  return new Date().getFullYear();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch standings from ESPN for a given sport
 */
async function fetchESPNStandings(sport, config) {
  const url = `${ESPN_STANDINGS}/${config.path}/standings`;
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
      // Soccer (EPL/MLS) uses `ties` for draws — ESPN's stats match. Every
      // other sport has no third column; `ties` is 0 or absent.
      const thirdCol = sport === 'NHL'
        ? (parseInt(stats.otLosses ?? stats.overtimeLosses) || 0)
        : (parseInt(stats.ties) || 0);

      // Strip ", N PTS" suffix that ESPN adds to some display strings (e.g.
      // NHL "7-2-1, 0 PTS") — keep just the record portion.
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
    // Try exact name match
    const { data: exact } = await supabase
      .from('teams')
      .select('id')
      .eq('sport', teamData.sport)
      .eq('name', teamData.name)
      .limit(1);

    if (exact?.length) return exact[0].id;

    // Try ilike match on full name (handles "LA Clippers" vs "Los Angeles Clippers")
    const { data: fuzzyFull } = await supabase
      .from('teams')
      .select('id, name')
      .eq('sport', teamData.sport)
      .ilike('name', `%${teamData.name}%`)
      .limit(1);

    if (fuzzyFull?.length) return fuzzyFull[0].id;

    // Try mascot match (last word)
    const mascot = teamData.name.split(' ').slice(-1)[0];
    if (mascot.length >= 4) { // Avoid short matches like "FC"
      const { data: fuzzyMascot } = await supabase
        .from('teams')
        .select('id, name')
        .eq('sport', teamData.sport)
        .ilike('name', `%${mascot}%`)
        .limit(1);

      if (fuzzyMascot?.length) return fuzzyMascot[0].id;
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

  res.status(202).json({ status: 'accepted', message: `Syncing standings for ${sports.join(', ')}` });

  const startTime = Date.now();
  const results = {};

  try {
    for (const sport of sports) {
      const config = SPORT_CONFIGS[sport];
      const season = config.season();

      try {
        const teams = await fetchESPNStandings(sport, config);
        let upserted = 0;

        for (const team of teams) {
          const teamId = await ensureTeam(team);
          if (!teamId) continue;

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

        results[sport] = { found: teams.length, upserted };
        console.log(`✅ ${sport}: ${upserted}/${teams.length} teams synced (season ${season})`);

      } catch (err) {
        console.error(`❌ ${sport} failed:`, err.message);
        results[sport] = { error: err.message };
      }

      await sleep(500);
    }

    // Log to cron_job_logs
    const duration = Date.now() - startTime;
    await supabase.from('cron_job_logs').insert({
      job_name: 'sync-standings',
      status: 'completed',
      details: JSON.stringify({ results, duration_ms: duration })
    });

    console.log(`\n📊 Standings sync complete in ${(duration / 1000).toFixed(1)}s`, results);

  } catch (err) {
    console.error('❌ Standings sync failed:', err.message);
  }
}

module.exports = syncStandings;
