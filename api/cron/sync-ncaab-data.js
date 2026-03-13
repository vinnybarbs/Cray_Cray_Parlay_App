/**
 * CRON JOB: Sync NCAAB Data
 * Fetches college basketball scores, team records, and standings from ESPN
 * Caches to Supabase for AI agent enrichment during pick generation
 * 
 * Recommended schedule: Every 2 hours during season (Nov-Apr)
 * Endpoint: POST /cron/sync-ncaab-data
 */

const { supabase } = require('../../lib/middleware/supabaseAuth.js');

const ESPN_BASE = 'http://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN API ${res.status}: ${url}`);
  return res.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncNCAABData(req, res) {
  const startTime = Date.now();

  try {
    // Verify cron secret
    const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
    if (cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('\n🏀 CRON: Starting NCAAB data sync...');

    const results = {
      games_cached: 0,
      teams_updated: 0,
      rankings_cached: 0,
      errors: []
    };

    // ─── 1. Fetch today's + yesterday's scoreboard ───
    console.log('📊 Phase 1: Fetching NCAAB scoreboards...');
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    for (const date of [yesterday, today]) {
      try {
        const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
        const data = await fetchJSON(`${ESPN_BASE}/scoreboard?dates=${dateStr}&limit=100`);

        const games = [];
        for (const event of (data.events || [])) {
          const comp = event.competitions?.[0];
          if (!comp) continue;

          const home = comp.competitors?.find(c => c.homeAway === 'home');
          const away = comp.competitors?.find(c => c.homeAway === 'away');
          if (!home || !away) continue;

          const eventDate = new Date(event.date);
          const dateOnly = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;

          games.push({
            espn_event_id: event.id,
            sport: 'NCAAB',
            date: dateOnly,
            home_team_id: home.team.id ? parseInt(home.team.id, 10) : null,
            home_team_name: home.team.displayName,
            away_team_id: away.team.id ? parseInt(away.team.id, 10) : null,
            away_team_name: away.team.displayName,
            home_score: home.score ? parseInt(home.score, 10) : null,
            away_score: away.score ? parseInt(away.score, 10) : null,
            status: event.status?.type?.name === 'STATUS_FINAL' ? 'final'
              : event.status?.type?.name === 'STATUS_SCHEDULED' ? 'scheduled'
              : event.status?.type?.name || 'unknown',
            metadata: {
              event_name: event.name,
              venue: comp.venue?.fullName,
              broadcast: comp.broadcasts?.[0]?.names?.[0],
              home_record: home.records?.[0]?.summary,
              away_record: away.records?.[0]?.summary,
              home_seed: home.curatedRank?.current,
              away_seed: away.curatedRank?.current,
              conference_game: comp.conferenceCompetition || false
            }
          });
        }

        if (games.length > 0) {
          // Insert games one by one to handle espn_event_id conflicts gracefully
          let inserted = 0;
          for (const game of games) {
            const { error } = await supabase
              .from('game_results')
              .upsert(game, { onConflict: 'espn_event_id', ignoreDuplicates: false });
            if (!error) inserted++;
          }
          results.games_cached += inserted;
          console.log(`✅ Cached ${inserted}/${games.length} NCAAB games for ${dateStr}`);
        }
      } catch (err) {
        console.error('❌ Scoreboard fetch error:', err.message);
        results.errors.push(`scoreboard: ${err.message}`);
      }

      await sleep(500);
    }

    // ─── 2. Fetch AP Top 25 rankings ───
    console.log('🏆 Phase 2: Fetching NCAAB rankings...');
    try {
      const rankData = await fetchJSON(`${ESPN_BASE}/rankings`);
      const rankings = [];

      for (const poll of (rankData.rankings || [])) {
        if (!poll.name?.toLowerCase().includes('ap')) continue;

        for (const rank of (poll.ranks || [])) {
          rankings.push({
            sport: 'NCAAB',
            poll_name: poll.name,
            rank: rank.current,
            previous_rank: rank.previous,
            team_name: rank.team?.displayName || rank.team?.name,
            team_abbreviation: rank.team?.abbreviation,
            record: rank.recordSummary,
            points: rank.points,
            first_place_votes: rank.firstPlaceVotes,
            updated_at: new Date().toISOString()
          });
        }
      }

      if (rankings.length > 0) {
        // Clear old NCAAB rankings and insert fresh
        await supabase.from('rankings_cache').delete().eq('sport', 'NCAAB');
        const { error } = await supabase.from('rankings_cache').insert(rankings);

        if (error) {
          console.error('❌ Rankings cache error:', error.message);
          results.errors.push(`rankings: ${error.message}`);
        } else {
          results.rankings_cached = rankings.length;
          console.log(`✅ Cached ${rankings.length} NCAAB rankings`);
        }
      }
    } catch (err) {
      console.error('❌ Rankings fetch error:', err.message);
      results.errors.push(`rankings: ${err.message}`);
    }

    await sleep(500);

    // ─── 3. Update team records from scoreboard data ───
    console.log('📈 Phase 3: Updating NCAAB team records...');
    try {
      // Get all NCAAB teams from our DB
      const { data: teams } = await supabase
        .from('teams')
        .select('id, name, abbreviation')
        .eq('sport', 'NCAAB');

      if (teams && teams.length > 0) {
        // Get recent games to extract team records
        const { data: recentGames } = await supabase
          .from('game_results')
          .select('home_team, away_team, metadata')
          .eq('sport', 'NCAAB')
          .order('game_date', { ascending: false })
          .limit(200);

        if (recentGames) {
          const teamRecords = {};

          for (const game of recentGames) {
            if (game.metadata?.home_record && !teamRecords[game.home_team]) {
              teamRecords[game.home_team] = {
                record: game.metadata.home_record,
                seed: game.metadata.home_seed
              };
            }
            if (game.metadata?.away_record && !teamRecords[game.away_team]) {
              teamRecords[game.away_team] = {
                record: game.metadata.away_record,
                seed: game.metadata.away_seed
              };
            }
          }

          // Update team records in provider_ids via direct JSONB merge
          let updated = 0;
          for (const team of teams) {
            const record = teamRecords[team.name];
            if (record) {
              // Fetch current provider_ids, merge in record/seed, then update
              const { data: current } = await supabase
                .from('teams')
                .select('provider_ids')
                .eq('id', team.id)
                .single();

              const merged = {
                ...(current?.provider_ids || {}),
                record: record.record,
                seed: record.seed
              };

              const { error } = await supabase
                .from('teams')
                .update({ provider_ids: merged })
                .eq('id', team.id);

              if (!error) updated++;
            }
          }

          results.teams_updated = updated;
          console.log(`✅ Updated ${updated} NCAAB team records`);
        }
      }
    } catch (err) {
      console.error('❌ Team records update error:', err.message);
      results.errors.push(`team_records: ${err.message}`);
    }

    const duration = Date.now() - startTime;
    console.log(`\n🏀 NCAAB sync complete in ${duration}ms:`, results);

    // Log cron execution
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: 'sync-ncaab-data',
        status: results.errors.length === 0 ? 'completed' : 'partial',
        details: JSON.stringify(results)
      });
    } catch (e) {
      console.warn('Cron log write failed:', e.message);
    }

    return res.status(200).json({
      success: true,
      duration_ms: duration,
      ...results
    });

  } catch (error) {
    console.error('❌ NCAAB sync failed:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

module.exports = syncNCAABData;
