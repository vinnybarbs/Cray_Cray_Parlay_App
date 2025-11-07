const { supabase } = require('../lib/middleware/supabaseAuth.js');
const { logger } = require('../shared/logger');

/**
 * Refresh API-Sports data cache (team stats, standings, injuries)
 * POST /cron/refresh-stats
 * Protected by CRON_SECRET
 * Run daily (less frequent than odds since stats change slower)
 */
async function refreshStatsCache(req, res) {
  try {
    // Verify cron secret
    const cronSecret = req.headers.authorization?.replace('Bearer ', '');
    if (cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const apiKey = process.env.APISPORTS_API_KEY || process.env.API_SPORTS_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API-Sports key not configured' });
    }

    const currentSeason = new Date().getFullYear();
    let totalStats = 0;
    let totalInjuries = 0;
    let totalTeams = 0;

    // Step 1: Fetch and cache team list (for ID mapping)
    try {
      logger.info('Fetching NFL teams...');
      const teamsRes = await fetch('https://v1.american-football.api-sports.io/teams?league=1', {
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': 'v1.american-football.api-sports.io'
        }
      });

      if (teamsRes.ok) {
        const teamsData = await teamsRes.json();
        const teams = teamsData.response || [];
        
        logger.info(`Found ${teams.length} NFL teams - storing for reference`);
        
        // Store team mapping in a simple cache table
        for (const team of teams) {
          if (team.id && team.name) {
            const { error } = await supabase
              .from('team_stats_cache')
              .upsert({
                sport: 'NFL',
                season: currentSeason,
                team_id: team.id.toString(),
                team_name: team.name,
                stats: { team_info: team }, // Store basic info
                last_updated: new Date().toISOString()
              }, {
                onConflict: 'sport,season,team_id'
              });
            
            if (!error) totalTeams++;
          }
        }
        
        logger.info(`Stored ${totalTeams} team records`);
      }
    } catch (error) {
      logger.error('Error fetching teams', { error: error.message });
    }

    // Step 2: NFL Team Stats & Standings
    try {
      logger.info('Fetching NFL standings...');
      const standingsRes = await fetch('https://v1.american-football.api-sports.io/standings?league=1&season=' + currentSeason, {
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': 'v1.american-football.api-sports.io'
        }
      });

      if (standingsRes.ok) {
        const standingsData = await standingsRes.json();
        const standings = standingsData.response || [];

        // Store standings
        const { error: standingsError } = await supabase
          .from('standings_cache')
          .upsert({
            sport: 'NFL',
            season: currentSeason,
            league: 'NFL',
            standings: standings,
            last_updated: new Date().toISOString()
          }, {
            onConflict: 'sport,season,league'
          });

        if (standingsError) {
          logger.error('Error storing standings', { error: standingsError.message });
        } else {
          logger.info(`Stored standings for ${standings.length} teams`);
        }

        // Store individual team stats
        for (const team of standings) {
          if (team.team?.id) {
            // Fetch detailed team stats
            await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit: 2 req/sec

            const statsRes = await fetch(`https://v1.american-football.api-sports.io/teams/statistics?id=${team.team.id}&season=${currentSeason}`, {
              headers: {
                'x-rapidapi-key': apiKey,
                'x-rapidapi-host': 'v1.american-football.api-sports.io'
              }
            });

            if (statsRes.ok) {
              const statsData = await statsRes.json();
              const stats = statsData.response;

              if (stats) {
                const { error: statsError } = await supabase
                  .from('team_stats_cache')
                  .upsert({
                    sport: 'NFL',
                    season: currentSeason,
                    team_id: team.team.id.toString(),
                    team_name: team.team.name,
                    stats: stats,
                    last_updated: new Date().toISOString()
                  }, {
                    onConflict: 'sport,season,team_id'
                  });

                if (!statsError) {
                  totalStats++;
                }
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error fetching NFL stats', { error: error.message });
    }

    // NFL Injuries
    try {
      logger.info('Fetching NFL injuries...');
      const injuriesRes = await fetch(`https://v1.american-football.api-sports.io/injuries?league=1&season=${currentSeason}`, {
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': 'v1.american-football.api-sports.io'
        }
      });

      if (injuriesRes.ok) {
        const injuriesData = await injuriesRes.json();
        const injuries = injuriesData.response || [];

        // Clear old injuries
        await supabase
          .from('injuries_cache')
          .delete()
          .eq('sport', 'NFL')
          .eq('season', currentSeason);

        // Store new injuries
        for (const injury of injuries) {
          const { error } = await supabase
            .from('injuries_cache')
            .insert({
              sport: 'NFL',
              season: currentSeason,
              team_id: injury.team?.id?.toString(),
              player_name: injury.player?.name,
              injury_status: injury.player?.status,
              injury_details: injury,
              last_updated: new Date().toISOString()
            });

          if (!error) {
            totalInjuries++;
          }
        }

        logger.info(`Stored ${totalInjuries} injury reports`);
      }
    } catch (error) {
      logger.error('Error fetching injuries', { error: error.message });
    }

    logger.info('Stats cache refresh complete', { totalStats, totalInjuries });
    res.json({ 
      success: true, 
      totalStats, 
      totalInjuries, 
      timestamp: new Date().toISOString() 
    });

  } catch (error) {
    logger.error('Error in refreshStatsCache', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = refreshStatsCache;
