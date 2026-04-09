/**
 * CRON / ONE-OFF: Backfill Game Results from ESPN
 * Fetches completed games for the last N days across all sports
 * Populates game_results table for ATS/trend analysis
 * 
 * POST /cron/backfill-game-results?days=30
 */

const { supabase } = require('../../lib/middleware/supabaseAuth.js');

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const SPORT_PATHS = {
  NFL: 'football/nfl',
  NBA: 'basketball/nba',
  NCAAB: 'basketball/mens-college-basketball',
  NHL: 'hockey/nhl',
  MLB: 'baseball/mlb',
  EPL: 'soccer/eng.1'
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDateStr(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function fetchScoreboard(sport, sportPath, dateStr) {
  try {
    const groups = (sport === 'NCAAB' || sport === 'NCAAF') ? '&groups=50' : '';
    const url = `${ESPN_BASE}/${sportPath}/scoreboard?dates=${dateStr}${groups}&limit=200`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    
    const games = [];
    for (const event of (data.events || [])) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const home = comp.competitors?.find(c => c.homeAway === 'home');
      const away = comp.competitors?.find(c => c.homeAway === 'away');
      if (!home || !away) continue;

      const status = event.status?.type?.name;
      if (status !== 'STATUS_FINAL' && status !== 'STATUS_END_PERIOD') continue;

      const homeScore = parseInt(home.score, 10);
      const awayScore = parseInt(away.score, 10);
      if (isNaN(homeScore) || isNaN(awayScore)) continue;

      const eventDate = new Date(event.date);
      const dateOnly = formatDateISO(eventDate);

      // Derive season from date (e.g., NCAAB 2025-26 season, NBA 2025-26)
      const year = eventDate.getFullYear();
      const month = eventDate.getMonth() + 1;
      const season = month >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`;

      games.push({
        espn_event_id: event.id,
        game_id: parseInt(event.id, 10) || Math.floor(Math.random() * 900000000) + 100000000,
        sport,
        season,
        date: dateOnly,
        home_team_id: home.team.id ? parseInt(home.team.id, 10) : null,
        home_team_name: home.team.displayName,
        away_team_id: away.team.id ? parseInt(away.team.id, 10) : null,
        away_team_name: away.team.displayName,
        home_score: homeScore,
        away_score: awayScore,
        status: 'final',
        metadata: {
          event_name: event.name,
          venue: comp.venue?.fullName,
          home_record: home.records?.[0]?.summary,
          away_record: away.records?.[0]?.summary,
          home_seed: home.curatedRank?.current,
          away_seed: away.curatedRank?.current,
          conference_game: comp.conferenceCompetition || false,
          spread: comp.odds?.[0]?.details,
          over_under: comp.odds?.[0]?.overUnder
        }
      });
    }
    return games;
  } catch (err) {
    console.error(`Error fetching ${sport} ${dateStr}:`, err.message);
    return [];
  }
}

async function backfillGameResults(req, res) {
  const startTime = Date.now();

  try {
    const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
    if (cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const days = parseInt(req.query.days || '30', 10);
    const sports = (req.query.sports || 'NBA,NCAAB,NFL,NHL,MLB,EPL').split(',').map(s => s.trim().toUpperCase());

    console.log(`\n📊 Backfilling game results: ${days} days, sports: ${sports.join(', ')}`);

    const results = { total_games: 0, total_inserted: 0, by_sport: {}, errors: [] };

    for (const sport of sports) {
      const sportPath = SPORT_PATHS[sport];
      if (!sportPath) {
        results.errors.push(`Unknown sport: ${sport}`);
        continue;
      }

      let sportGames = 0;
      let sportInserted = 0;

      for (let d = 0; d < days; d++) {
        const date = new Date();
        date.setDate(date.getDate() - d);
        const dateStr = formatDateStr(date);

        const games = await fetchScoreboard(sport, sportPath, dateStr);

        for (const game of games) {
          const { error } = await supabase
            .from('game_results')
            .upsert(game, { onConflict: 'espn_event_id', ignoreDuplicates: false });
          if (!error) sportInserted++;
        }

        sportGames += games.length;

        // Rate limit: 300ms between dates
        if (games.length > 0) await sleep(300);
      }

      results.by_sport[sport] = { found: sportGames, inserted: sportInserted };
      results.total_games += sportGames;
      results.total_inserted += sportInserted;

      console.log(`✅ ${sport}: ${sportInserted}/${sportGames} games`);

      // Rate limit: 1s between sports
      await sleep(1000);
    }

    const duration = Date.now() - startTime;
    console.log(`\n📊 Backfill complete in ${(duration / 1000).toFixed(1)}s:`, results);

    return res.status(200).json({ success: true, duration_ms: duration, ...results });

  } catch (error) {
    console.error('❌ Backfill failed:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = backfillGameResults;
