/**
 * Cron: Fetch structured intelligence from ESPN APIs
 *
 * Pulls REAL data (not articles) into news_cache for the AI to use:
 * - Injury reports per team
 * - Recent game results with scores
 * - Team rankings and records
 *
 * POST /cron/fetch-espn-intelligence
 */

const { supabase } = require('../../lib/middleware/supabaseAuth');
const { logger } = require('../../shared/logger');

const FETCH_TIMEOUT = 10000;

// In-season sports and their ESPN slugs
const ACTIVE_SPORTS = [
  { code: 'NBA', espn: 'basketball/nba', slug: 'basketball_nba' },
  { code: 'NCAAB', espn: 'basketball/mens-college-basketball', slug: 'basketball_ncaab' },
  { code: 'NHL', espn: 'hockey/nhl', slug: 'icehockey_nhl' },
  { code: 'MLB', espn: 'baseball/mlb', slug: 'baseball_mlb' },
];

async function espnFetch(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}`, {
      headers: { 'User-Agent': 'CrayCrayParlay/1.0' },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    clearTimeout(timeout);
    return null;
  }
}

async function upsertNewsCache(sport, searchType, teamName, data) {
  const { error } = await supabase
    .from('news_cache')
    .upsert({
      sport,
      search_type: searchType,
      team_name: teamName || sport,
      articles: null,
      summary: typeof data === 'string' ? data : JSON.stringify(data),
      last_updated: new Date().toISOString(),
      expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
    }, { onConflict: 'sport,search_type,team_name' });

  if (error) logger.warn(`Upsert error for ${sport}/${searchType}/${teamName}: ${error.message}`);
}

// Fetch injury report for a sport
async function fetchInjuries(sport) {
  // ESPN doesn't have a direct injuries endpoint for all sports,
  // but the scoreboard events include injury info in the competitor status
  // For NBA/NHL, we can check team pages
  const teams = await espnFetch(`${sport.espn}/teams`);
  if (!teams?.sports?.[0]?.leagues?.[0]?.teams) return [];

  const injuries = [];
  const teamList = teams.sports[0].leagues[0].teams.slice(0, 15); // Top 15 teams to limit API calls

  for (const t of teamList) {
    const team = t.team;
    try {
      const injuryData = await espnFetch(`${sport.espn}/teams/${team.id}/injuries`);
      if (injuryData?.items?.length > 0) {
        const teamInjuries = injuryData.items.map(item => ({
          player: item.athlete?.displayName || 'Unknown',
          position: item.athlete?.position?.abbreviation || '',
          status: item.status || 'Unknown',
          details: item.longComment || item.shortComment || '',
          date: item.date
        }));

        if (teamInjuries.length > 0) {
          injuries.push({
            team: team.displayName,
            teamId: team.id,
            injuries: teamInjuries
          });
        }
      }
      // Be polite
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      // Skip this team
    }
  }

  return injuries;
}

// Fetch today's and yesterday's scores
async function fetchRecentScores(sport) {
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const dates = [
    today.toISOString().split('T')[0].replace(/-/g, ''),
    yesterday.toISOString().split('T')[0].replace(/-/g, '')
  ];

  const allGames = [];

  for (const dateStr of dates) {
    const data = await espnFetch(`${sport.espn}/scoreboard?dates=${dateStr}`);
    if (!data?.events) continue;

    for (const event of data.events) {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      const status = competition.status;
      const home = competition.competitors?.find(c => c.homeAway === 'home');
      const away = competition.competitors?.find(c => c.homeAway === 'away');

      if (!home || !away) continue;

      allGames.push({
        home_team: home.team?.displayName,
        away_team: away.team?.displayName,
        home_score: parseInt(home.score) || 0,
        away_score: parseInt(away.score) || 0,
        status: status?.type?.completed ? 'final' : status?.type?.description || 'scheduled',
        date: event.date,
        home_record: home.records?.[0]?.summary,
        away_record: away.records?.[0]?.summary,
        venue: competition.venue?.fullName,
        headline: event.competitions?.[0]?.headlines?.[0]?.shortLinkText || null
      });
    }
  }

  return allGames;
}

// Fetch standings/rankings
async function fetchStandings(sport) {
  const data = await espnFetch(`${sport.espn}/standings`);
  if (!data) return null;

  const standings = [];

  // Handle different standings formats
  const groups = data.children || data.standings?.entries || [];
  for (const group of groups) {
    const entries = group.standings?.entries || group.entries || [];
    for (const entry of entries) {
      const team = entry.team;
      if (!team) continue;

      const stats = {};
      (entry.stats || []).forEach(s => {
        stats[s.abbreviation || s.name] = s.displayValue || s.value;
      });

      standings.push({
        team: team.displayName,
        teamId: team.id,
        wins: parseInt(stats.W) || 0,
        losses: parseInt(stats.L) || 0,
        winPct: stats.PCT || stats['WIN%'] || null,
        streak: stats.STRK || stats.STREAK || null,
        conference: group.name || null
      });
    }
  }

  return standings;
}

async function fetchEspnIntelligence(req, res) {
  const startTime = Date.now();
  const results = {};

  try {
    for (const sport of ACTIVE_SPORTS) {
      logger.info(`Fetching ESPN intelligence for ${sport.code}...`);
      results[sport.code] = { injuries: 0, scores: 0, standings: 0 };

      // 1. Injuries
      try {
        const injuries = await fetchInjuries(sport);
        if (injuries.length > 0) {
          // Store as injury intelligence per team
          for (const teamInj of injuries) {
            const summary = teamInj.injuries.map(i =>
              `${i.player} (${i.position}) - ${i.status}: ${i.details}`
            ).join('\n');

            await upsertNewsCache(sport.code, 'injuries', teamInj.team, summary);
            results[sport.code].injuries++;
          }

          // Also store a sport-wide injury summary
          const allInjuries = injuries.flatMap(t =>
            t.injuries.map(i => `${t.team}: ${i.player} (${i.status})`)
          ).join('\n');
          await upsertNewsCache(sport.code, 'injuries', sport.code, allInjuries);
        }
      } catch (err) {
        logger.warn(`Injury fetch failed for ${sport.code}: ${err.message}`);
      }

      // 2. Recent Scores
      try {
        const scores = await fetchRecentScores(sport);
        if (scores.length > 0) {
          const scoreSummary = scores
            .filter(g => g.status === 'final')
            .map(g => `${g.away_team} ${g.away_score} @ ${g.home_team} ${g.home_score} (${g.away_record || '?'} vs ${g.home_record || '?'})`)
            .join('\n');

          await upsertNewsCache(sport.code, 'recent_results', sport.code, scoreSummary);
          results[sport.code].scores = scores.filter(g => g.status === 'final').length;

          // Store upcoming games too
          const upcoming = scores
            .filter(g => g.status !== 'final')
            .map(g => `${g.away_team} (${g.away_record || '?'}) @ ${g.home_team} (${g.home_record || '?'}) - ${g.status}`)
            .join('\n');

          if (upcoming) {
            await upsertNewsCache(sport.code, 'upcoming_games', sport.code, upcoming);
          }
        }
      } catch (err) {
        logger.warn(`Scores fetch failed for ${sport.code}: ${err.message}`);
      }

      // 3. Standings
      try {
        const standings = await fetchStandings(sport);
        if (standings && standings.length > 0) {
          const standingSummary = standings
            .sort((a, b) => b.wins - a.wins)
            .slice(0, 30)
            .map(t => `${t.team}: ${t.wins}-${t.losses} (${t.winPct || 'N/A'}) ${t.streak ? 'Streak: ' + t.streak : ''}`)
            .join('\n');

          await upsertNewsCache(sport.code, 'standings', sport.code, standingSummary);
          results[sport.code].standings = standings.length;
        }
      } catch (err) {
        logger.warn(`Standings fetch failed for ${sport.code}: ${err.message}`);
      }

      // Pace between sports
      await new Promise(r => setTimeout(r, 1000));
    }

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      results,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    logger.error('ESPN intelligence fetch error:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = fetchEspnIntelligence;
