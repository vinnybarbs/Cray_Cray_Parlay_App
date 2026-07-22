// Read-only pipeline vitals for the daily 6am sanity-check routine (a
// scheduled Claude agent, same pattern as review-bundle). Auth: the shared
// report_secret from app_config. Reads aggregates only, can't trigger jobs.
//
// The checks exist because failures here have historically been SILENT:
// the 7/11 Anthropic migration truncated every analysis response and the
// board quietly drained to nothing over 12 hours. The core signal is
// coverage: games with odds vs games with fresh analyses, per sport.

const { supabase } = require('../lib/middleware/supabaseAuth.js');

// odds_cache stores provider slugs, game_analysis stores display names.
function slugToSport(slug) {
  if (!slug) return 'Unknown';
  if (slug.startsWith('tennis_')) return 'Tennis';
  const map = {
    americanfootball_nfl: 'NFL', americanfootball_ncaaf: 'NCAAF',
    basketball_nba: 'NBA', basketball_ncaab: 'NCAAB',
    icehockey_nhl: 'NHL', baseball_mlb: 'MLB',
    soccer_epl: 'EPL', soccer_usa_mls: 'MLS',
    mma_mixed_martial_arts: 'UFC',
  };
  return map[slug] || slug;
}

module.exports = async function pipelineHealth(req, res) {
  try {
    // Two accepted read-only secrets: the original report_secret (weekly
    // review) and report_secret_2 (daily routine, embedded in its task
    // prompt so scheduled runs need no database connector).
    const { data: cfgRows } = await supabase
      .from('app_config').select('key, value').in('key', ['report_secret', 'report_secret_2']);
    const accepted = new Set((cfgRows || []).map(r => r.value).filter(Boolean));
    const provided = req.headers['x-report-secret'] || req.query.secret;
    if (accepted.size === 0 || !provided || !accepted.has(provided)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const now = Date.now();
    const in24h = new Date(now + 24 * 3600e3).toISOString();
    const nowIso = new Date(now).toISOString();
    const ago24h = new Date(now - 24 * 3600e3).toISOString();
    const ago48h = new Date(now - 48 * 3600e3).toISOString();
    const ago12h = new Date(now - 12 * 3600e3).toISOString();
    const todayUtc = nowIso.split('T')[0];

    const [cronRows, oddsRows, analysisRows, oddsFresh, picksToday, parlaysToday, stalePending, errorRows] = await Promise.all([
      // Latest runs across all app-level cron jobs
      supabase.from('cron_job_logs')
        .select('job_name, status, created_at')
        .gte('created_at', ago48h)
        .order('created_at', { ascending: false })
        .limit(300),
      // Upcoming games that HAVE odds (next 24h)
      supabase.from('odds_cache')
        .select('sport, home_team, away_team, commence_time')
        .gte('commence_time', nowIso)
        .lte('commence_time', in24h)
        .limit(5000),
      // Analyses that are still alive for those games
      supabase.from('game_analysis')
        .select('sport, game_key, expires_at, generated_at, model_used')
        .gte('game_date', nowIso)
        .lte('game_date', in24h),
      // How stale is the odds feed overall
      supabase.from('odds_cache')
        .select('last_updated')
        .order('last_updated', { ascending: false })
        .limit(1),
      // Graded picks published today by the digest pipeline
      supabase.from('ai_suggestions')
        .select('sport', { count: 'exact', head: true })
        .eq('session_id', `auto_digest_${todayUtc}`),
      // Machine parlays built today
      supabase.from('house_parlays')
        .select('legs_count, status, combined_edge_pp, created_at')
        .eq('parlay_date', todayUtc),
      // Picks that should have settled by now but haven't
      supabase.from('ai_suggestions')
        .select('sport', { count: 'exact', head: true })
        .eq('actual_outcome', 'pending')
        .lt('game_date', ago12h),
      // Anything that logged a non-success in the last 24h, with details
      supabase.from('cron_job_logs')
        .select('job_name, status, created_at, details')
        .gte('created_at', ago24h)
        .not('status', 'in', '("completed","success","started","skipped")')
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    // Latest run per job
    const lastRunByJob = {};
    for (const r of (cronRows.data ?? [])) {
      if (!lastRunByJob[r.job_name]) {
        lastRunByJob[r.job_name] = {
          status: r.status,
          last_run: r.created_at,
          age_minutes: Math.round((now - new Date(r.created_at).getTime()) / 60000),
        };
      }
    }

    // Coverage per sport: distinct upcoming games with odds vs live analyses
    const gamesWithOdds = {};
    for (const r of (oddsRows.data ?? [])) {
      const sport = slugToSport(r.sport);
      const day = String(r.commence_time).split('T')[0];
      (gamesWithOdds[sport] ??= new Set()).add(`${r.away_team}@${r.home_team}@${day}`);
    }
    const liveAnalyses = {};
    for (const r of (analysisRows.data ?? [])) {
      if (new Date(r.expires_at).getTime() > now) {
        liveAnalyses[r.sport] = (liveAnalyses[r.sport] || 0) + 1;
      }
    }
    const coverage = {};
    for (const sport of new Set([...Object.keys(gamesWithOdds), ...Object.keys(liveAnalyses)])) {
      coverage[sport] = {
        games_with_odds_next_24h: gamesWithOdds[sport]?.size ?? 0,
        live_analyses: liveAnalyses[sport] ?? 0,
      };
    }

    const latestOdds = oddsFresh.data?.[0]?.last_updated ?? null;

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      generated_at: nowIso,
      coverage,
      odds_feed: {
        latest_update: latestOdds,
        minutes_since_update: latestOdds ? Math.round((now - new Date(latestOdds).getTime()) / 60000) : null,
      },
      picks_published_today: picksToday.count ?? 0,
      house_parlays_today: parlaysToday.data ?? [],
      pending_picks_older_than_12h: stalePending.count ?? 0,
      last_run_by_job: lastRunByJob,
      non_success_runs_last_24h: errorRows.data ?? [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
