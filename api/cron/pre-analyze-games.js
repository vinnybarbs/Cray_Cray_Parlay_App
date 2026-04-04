// CRON JOB: Pre-Analyze Upcoming Games
// Runs 2-3x daily to generate AI analysis snippets per game using GPT-4o-mini
// Stores results in game_analysis table for cheap/fast pick generation
// Schedule: Every 4 hours
// Endpoint: POST /cron/pre-analyze-games

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { ApiSportsMulti } = require('../../lib/services/apisports-multi.js');
const aiInstructions = require('../../lib/services/ai-instructions.js');
const { EdgeCalculator } = require('../../lib/services/edge-calculator.js');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// Map odds_cache sport slugs to display sport names
const SLUG_TO_SPORT = {
  americanfootball_nfl: 'NFL',
  americanfootball_ncaaf: 'NCAAF',
  basketball_nba: 'NBA',
  basketball_ncaab: 'NCAAB',
  icehockey_nhl: 'NHL',
  baseball_mlb: 'MLB',
  soccer_epl: 'EPL'
};

/**
 * Build a game_key from team names + date
 */
function makeGameKey(homeTeam, awayTeam, dateStr) {
  const normalize = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
  return `${normalize(awayTeam)}_vs_${normalize(homeTeam)}_${dateStr}`;
}

/**
 * Fetch upcoming games from odds_cache grouped by matchup
 */
async function getUpcomingGames(sports) {
  const now = new Date().toISOString();
  const twoDaysOut = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('odds_cache')
    .select('sport, home_team, away_team, commence_time, market_type, outcomes, bookmaker')
    .in('sport', sports)
    .gte('commence_time', now)
    .lte('commence_time', twoDaysOut)
    .order('commence_time', { ascending: true });

  if (error) throw new Error(`Failed to fetch odds: ${error.message}`);

  // Group by game
  const games = {};
  for (const row of (data || [])) {
    const dateStr = new Date(row.commence_time).toISOString().split('T')[0];
    const key = makeGameKey(row.home_team, row.away_team, dateStr);

    if (!games[key]) {
      games[key] = {
        game_key: key,
        sport: row.sport,
        home_team: row.home_team,
        away_team: row.away_team,
        game_date: row.commence_time,
        markets: {}
      };
    }

    // Prefer DraftKings, fall back to FanDuel
    const existing = games[key].markets[row.market_type];
    if (!existing || row.bookmaker === 'draftkings') {
      games[key].markets[row.market_type] = row.outcomes;
    }
  }

  return Object.values(games);
}

/**
 * Extract spread, total, moneyline from grouped market data
 */
function extractOddsContext(game) {
  const ctx = { spread: null, total: null, ml_home: null, ml_away: null };

  // Spread
  const spreads = game.markets['spreads'];
  if (spreads) {
    const homeSpread = spreads.find(o => o.name === game.home_team);
    if (homeSpread) ctx.spread = homeSpread.point;
  }

  // Total
  const totals = game.markets['totals'];
  if (totals) {
    const over = totals.find(o => o.name === 'Over');
    if (over) ctx.total = over.point;
  }

  // Moneyline
  const h2h = game.markets['h2h'];
  if (h2h) {
    const homeMl = h2h.find(o => o.name === game.home_team);
    const awayMl = h2h.find(o => o.name === game.away_team);
    if (homeMl) ctx.ml_home = homeMl.price;
    if (awayMl) ctx.ml_away = awayMl.price;
  }

  return ctx;
}

/**
 * Get relevant news snippets for a game's teams
 */
async function getNewsContext(homeTeam, awayTeam, sport) {
  try {
    // Search for articles mentioning either team in the last 3 days
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    // Extract key words from team names for search
    const homeWords = homeTeam.split(' ').slice(-1)[0]; // Last word (mascot)
    const awayWords = awayTeam.split(' ').slice(-1)[0];

    const { data } = await supabase
      .from('news_articles')
      .select('title, summary, betting_summary, content, published_at')
      .gte('published_at', threeDaysAgo)
      .or(`title.ilike.%${homeWords}%,title.ilike.%${awayWords}%,summary.ilike.%${homeWords}%,summary.ilike.%${awayWords}%`)
      .order('published_at', { ascending: false })
      .limit(5);

    if (!data || data.length === 0) return null;

    return data.map(a => {
      let line = `- ${a.title}`;
      if (a.betting_summary) line += ` | BETTING: ${a.betting_summary}`;
      if (a.content && !a.betting_summary) line += ` | ${a.content.substring(0, 150)}`;
      return line;
    }).join('\n');
  } catch {
    return null;
  }
}

/**
 * Get injury context from ESPN intelligence (news_cache table)
 */
async function getInjuryContext(homeTeam, awayTeam) {
  try {
    // Try exact team name match in news_cache (ESPN injuries)
    const { data } = await supabase
      .from('news_cache')
      .select('team_name, summary')
      .eq('search_type', 'injuries')
      .in('team_name', [homeTeam, awayTeam])
      .gt('last_updated', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (!data || data.length === 0) {
      // Fallback: try mascot-based match
      const homeMascot = homeTeam.split(' ').slice(-1)[0];
      const awayMascot = awayTeam.split(' ').slice(-1)[0];
      const { data: fallback } = await supabase
        .from('news_cache')
        .select('team_name, summary')
        .eq('search_type', 'injuries')
        .or(`team_name.ilike.%${homeMascot}%,team_name.ilike.%${awayMascot}%`)
        .gt('last_updated', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (!fallback || fallback.length === 0) return null;

      return fallback.map(row => {
        const summary = row.summary.substring(0, 300);
        return `${row.team_name}: ${summary}`;
      }).join('\n');
    }

    return data.map(row => {
      const summary = row.summary.substring(0, 300);
      return `${row.team_name}: ${summary}`;
    }).join('\n');
  } catch {
    return null;
  }
}

/**
 * Get rankings context
 */
async function getRankingsContext(homeTeam, awayTeam) {
  try {
    // rankings_cache stores mascot-only names (e.g., 'Crimson Tide', 'Blue Devils')
    // Extract possible mascot variations to match against
    const homeWords = homeTeam.split(' ');
    const awayWords = awayTeam.split(' ');
    
    // Try last word, last 2 words, and last 3 words as mascot
    const homeMascots = [
      homeWords.slice(-1).join(' '),
      homeWords.slice(-2).join(' '),
      homeWords.slice(-3).join(' ')
    ];
    const awayMascots = [
      awayWords.slice(-1).join(' '),
      awayWords.slice(-2).join(' '),
      awayWords.slice(-3).join(' ')
    ];
    
    // Use ilike for flexible matching
    const allMascots = [...new Set([...homeMascots, ...awayMascots])];
    const orFilter = allMascots.map(m => `team_name.ilike.%${m}%`).join(',');
    
    const { data } = await supabase
      .from('rankings_cache')
      .select('team_name, rank, record')
      .or(orFilter);

    const result = { home_rank: null, away_rank: null, home_record: null, away_record: null };

    for (const r of (data || [])) {
      const rName = r.team_name.toLowerCase();
      // Check if any home mascot variant matches
      if (homeMascots.some(m => rName.includes(m.toLowerCase()) || m.toLowerCase().includes(rName))) {
        result.home_rank = r.rank;
        result.home_record = r.record;
      }
      // Check if any away mascot variant matches
      if (awayMascots.some(m => rName.includes(m.toLowerCase()) || m.toLowerCase().includes(rName))) {
        result.away_rank = r.rank;
        result.away_record = r.record;
      }
    }

    // If rankings_cache didn't find them, try ESPN news_cache standings
    if (!result.home_record || !result.away_record) {
      try {
        const sportMap = { 'americanfootball_nfl': 'NFL', 'basketball_nba': 'NBA', 'basketball_ncaab': 'NCAAB', 'icehockey_nhl': 'NHL', 'baseball_mlb': 'MLB' };
        // We need the sport slug here but don't have it — use a broad search
        const { data: standingsData } = await supabase
          .from('news_cache')
          .select('summary')
          .eq('search_type', 'standings')
          .gt('last_updated', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .limit(5);

        if (standingsData) {
          for (const row of standingsData) {
            const lines = (row.summary || '').split('\n');
            for (const line of lines) {
              // Format: "Iowa State Cyclones: 27-7 (.900) Streak: W3"
              const homeMascot = homeTeam.split(' ').slice(-1)[0].toLowerCase();
              const awayMascot = awayTeam.split(' ').slice(-1)[0].toLowerCase();
              const lower = line.toLowerCase();
              const recordMatch = line.match(/:\s*(\d+-\d+)/);
              if (recordMatch) {
                if (lower.includes(homeMascot) && !result.home_record) result.home_record = recordMatch[1];
                if (lower.includes(awayMascot) && !result.away_record) result.away_record = recordMatch[1];
              }
            }
          }
        }
      } catch { /* continue without standings */ }
    }

    return result;
  } catch {
    return { home_rank: null, away_rank: null, home_record: null, away_record: null };
  }
}

/**
 * Get recent game results for trend context
 */
async function getRecentResults(teamName, sportSlug, limit = 5) {
  try {
    const mascot = teamName.split(' ').slice(-1)[0];
    // Map odds API slugs to game_results sport values
    const sportName = SLUG_TO_SPORT[sportSlug] || sportSlug;
    
    let query = supabase
      .from('game_results')
      .select('home_team_name, away_team_name, home_score, away_score, date, metadata')
      .eq('status', 'final')
      .or(`home_team_name.ilike.%${mascot}%,away_team_name.ilike.%${mascot}%`)
      .order('date', { ascending: false })
      .limit(limit);
    
    // Filter by sport if we have a valid mapping
    if (sportName) {
      query = query.eq('sport', sportName);
    }
    
    const { data } = await query;

    if (!data || data.length === 0) return null;

    let wins = 0, losses = 0;
    const results = [];
    for (const g of data) {
      const isHome = g.home_team_name.toLowerCase().includes(mascot.toLowerCase());
      const teamScore = isHome ? g.home_score : g.away_score;
      const oppScore = isHome ? g.away_score : g.home_score;
      const won = teamScore > oppScore;
      if (won) wins++; else losses++;
      const opp = isHome ? g.away_team_name : g.home_team_name;
      results.push(`${won ? 'W' : 'L'} ${teamScore}-${oppScore} vs ${opp}`);
    }

    return { record: `${wins}-${losses}`, games: results };
  } catch {
    return null;
  }
}

/**
 * Get model's past accuracy for this type of pick
 */
async function getPastAccuracy(sport) {
  try {
    const { data } = await supabase
      .from('ai_suggestions')
      .select('actual_outcome, bet_type, odds')
      .eq('sport', sport.toUpperCase().replace('AMERICANFOOTBALL_', '').replace('BASKETBALL_', '').replace('ICEHOCKEY_', ''))
      .in('actual_outcome', ['won', 'lost'])
      .limit(200);

    if (!data || data.length < 5) return null;

    const wins = data.filter(d => d.actual_outcome === 'won').length;
    const total = data.length;
    return `Model is ${wins}/${total} (${(wins/total*100).toFixed(0)}%) on ${sport} picks`;
  } catch {
    return null;
  }
}

/**
 * Get API-Sports enrichment (standings, season stats, H2H) for NFL/NBA/NHL/MLB
 * NCAAB uses ESPN instead (no API-Sports basketball college endpoint)
 */
async function getApiSportsContext(homeTeam, awayTeam, sportSlug) {
  const sportName = SLUG_TO_SPORT[sportSlug];
  if (!sportName || sportName === 'NCAAB') return null; // NCAAB uses ESPN

  const apiClient = new ApiSportsMulti();
  if (!apiClient.apiKey) return null;

  try {
    const parts = [];

    // 1. Standings — get W-L, conference rank, points differential
    const standingsData = await apiClient.getStandings(sportName);
    if (standingsData?.response?.length > 0) {
      const homeMascot = homeTeam.split(' ').slice(-1)[0].toLowerCase();
      const awayMascot = awayTeam.split(' ').slice(-1)[0].toLowerCase();

      for (const s of standingsData.response) {
        const teamName = (s.team?.name || '').toLowerCase();
        const isHome = teamName.includes(homeMascot);
        const isAway = teamName.includes(awayMascot);

        if (isHome || isAway) {
          const label = isHome ? homeTeam : awayTeam;
          const w = s.won || s.win?.total || 0;
          const l = s.lost || s.loss?.total || 0;
          const ptsFor = s.points?.for || 0;
          const ptsAgainst = s.points?.against || 0;
          const diff = ptsFor - ptsAgainst;
          const conf = s.conference?.name || s.group?.name || '';
          const streak = s.streak ? ` (streak: ${s.streak})` : '';

          parts.push(`[API-Sports] ${label}: ${w}-${l} ${conf}${streak}, PF/PA: ${ptsFor}/${ptsAgainst} (${diff >= 0 ? '+' : ''}${diff})`);
        }
      }
    }

    // 2. Today's games — check if there's a live/upcoming entry with odds
    if (sportName === 'NFL') {
      // NFL has odds endpoint on API-Sports (DraftKings/FanDuel via their feed)
      const today = new Date().toISOString().split('T')[0];
      const gamesData = await apiClient.getGamesByDate(sportName, today);
      if (gamesData?.response?.length > 0) {
        const homeMascot = homeTeam.split(' ').slice(-1)[0].toLowerCase();
        for (const g of gamesData.response) {
          const hName = (g.teams?.home?.name || '').toLowerCase();
          if (hName.includes(homeMascot)) {
            const venue = g.game?.venue?.name || '';
            const weather = g.game?.weather?.description || '';
            if (venue) parts.push(`[API-Sports] Venue: ${venue}`);
            if (weather) parts.push(`[API-Sports] Weather: ${weather}`);
            break;
          }
        }
      }
    }

    return parts.length > 0 ? parts.join('\n') : null;
  } catch (err) {
    console.warn(`API-Sports enrichment failed for ${sportSlug}:`, err.message);
    return null;
  }
}

/**
 * Get Supabase DB stats: player_game_stats season averages for key players
 */
async function getPlayerStatsContext(homeTeam, awayTeam, sportSlug) {
  const sportName = SLUG_TO_SPORT[sportSlug];
  if (!sportName) return null;

  try {
    // Get top players by game count for each team from player_game_stats
    const homeMascot = homeTeam.split(' ').slice(-1)[0];
    const awayMascot = awayTeam.split(' ').slice(-1)[0];

    const { data } = await supabase.rpc('resolve_team', { search_term: homeMascot, search_sport: sportName });
    if (!data || data.length === 0) return null;

    const teamId = data[0].id;

    // Get top 3 players by most recent stats for this team
    const { data: players } = await supabase
      .from('players')
      .select('id, name, position')
      .eq('team_id', teamId)
      .eq('sport', sportName)
      .limit(50);

    if (!players || players.length === 0) return null;

    const playerIds = players.map(p => p.id);

    // Get recent game stats averages
    const { data: stats } = await supabase
      .from('player_game_stats')
      .select('player_id, passing_yards, passing_touchdowns, rushing_yards, rushing_touchdowns, receptions, receiving_yards')
      .in('player_id', playerIds.slice(0, 20))
      .order('game_date', { ascending: false })
      .limit(100);

    if (!stats || stats.length === 0) return null;

    // Aggregate per player
    const playerMap = {};
    for (const p of players) playerMap[p.id] = p;

    const agg = {};
    for (const s of stats) {
      if (!agg[s.player_id]) agg[s.player_id] = { games: 0, passYds: 0, passTDs: 0, rushYds: 0, rushTDs: 0, recYds: 0, recs: 0 };
      const a = agg[s.player_id];
      a.games++;
      if (s.passing_yards) { a.passYds += s.passing_yards; a.passTDs += (s.passing_touchdowns || 0); }
      if (s.rushing_yards) { a.rushYds += s.rushing_yards; a.rushTDs += (s.rushing_touchdowns || 0); }
      if (s.receiving_yards) { a.recYds += s.receiving_yards; a.recs += (s.receptions || 0); }
    }

    // Format top performers
    const lines = [];
    for (const [pid, a] of Object.entries(agg)) {
      if (a.games < 2) continue;
      const p = playerMap[pid];
      if (!p) continue;
      const parts = [];
      if (a.passYds > 0) parts.push(`${(a.passYds / a.games).toFixed(0)} pass yds, ${(a.passTDs / a.games).toFixed(1)} TDs`);
      if (a.rushYds > 100) parts.push(`${(a.rushYds / a.games).toFixed(0)} rush yds`);
      if (a.recYds > 50) parts.push(`${(a.recYds / a.games).toFixed(0)} rec yds, ${(a.recs / a.games).toFixed(1)} rec`);
      if (parts.length > 0) lines.push(`${p.name} (${p.position || '?'}): ${parts.join(', ')} [${a.games}g avg]`);
    }

    return lines.length > 0 ? lines.slice(0, 5).join('\n') : null;
  } catch {
    return null;
  }
}

/**
 * Generate AI analysis for a single game using GPT-4o-mini
 */
async function analyzeGame(game, oddsCtx, newsCtx, injuryCtx, rankCtx, homeTrend, awayTrend, accuracy, apiSportsCtx, playerStatsCtx, playbook = '', priorAnalysis = null, edgeData = null) {
  const sportDisplay = SLUG_TO_SPORT[game.sport] || game.sport.toUpperCase();

  let contextParts = [];
  contextParts.push(`Sport: ${sportDisplay}`);
  contextParts.push(`Matchup: ${game.away_team} @ ${game.home_team}`);

  if (oddsCtx.spread != null) {
    const homeSpread = oddsCtx.spread >= 0 ? `+${oddsCtx.spread}` : `${oddsCtx.spread}`;
    const awaySpread = oddsCtx.spread >= 0 ? `-${oddsCtx.spread}` : `+${Math.abs(oddsCtx.spread)}`;
    contextParts.push(`Spread: ${game.home_team} ${homeSpread} / ${game.away_team} ${awaySpread}`);
  }
  if (oddsCtx.total != null) contextParts.push(`O/U Total: ${oddsCtx.total}`);
  if (oddsCtx.ml_home != null) contextParts.push(`Moneyline: ${game.home_team} ${oddsCtx.ml_home} / ${game.away_team} ${oddsCtx.ml_away}`);

  if (rankCtx.home_rank) contextParts.push(`${game.home_team}: Ranked #${rankCtx.home_rank} (${rankCtx.home_record || ''})`);
  if (rankCtx.away_rank) contextParts.push(`${game.away_team}: Ranked #${rankCtx.away_rank} (${rankCtx.away_record || ''})`);

  if (homeTrend) contextParts.push(`${game.home_team} last ${homeTrend.games.length}: ${homeTrend.record} — ${homeTrend.games.join('; ')}`);
  if (awayTrend) contextParts.push(`${game.away_team} last ${awayTrend.games.length}: ${awayTrend.record} — ${awayTrend.games.join('; ')}`);

  if (apiSportsCtx) contextParts.push(`Standings/Stats:\n${apiSportsCtx}`);
  if (playerStatsCtx) contextParts.push(`Key player averages:\n${playerStatsCtx}`);
  if (injuryCtx) contextParts.push(`Injuries: ${injuryCtx}`);
  if (newsCtx) contextParts.push(`Recent news:\n${newsCtx}`);

  // Statistical edge block — injected when EdgeCalculator has results
  if (edgeData) {
    const ed = edgeData;
    const edgeLines = [
      `--- STATISTICAL EDGE ANALYSIS ---`,
      `Calculated Win Probability: ${game.home_team} ${(ed.homeWinProb * 100).toFixed(1)}% | ${game.away_team} ${(ed.awayWinProb * 100).toFixed(1)}%`
    ];
    if (ed.impliedHomeProb !== null) {
      edgeLines.push(`Implied Probability (vig-free): ${game.home_team} ${(ed.impliedHomeProb * 100).toFixed(1)}% | ${game.away_team} ${(ed.impliedAwayProb * 100).toFixed(1)}%`);
    }
    if (ed.edge !== null) {
      const edgeSign = ed.edge >= 0 ? '+' : '';
      edgeLines.push(`Mathematical Edge: ${edgeSign}${(ed.edge * 100).toFixed(1)}% on ${ed.edgeSide === 'home' ? game.home_team : game.away_team} (${ed.confidence} confidence)`);
    }
    if (ed.factors) {
      const f = ed.factors;
      if (f.homeRecord) edgeLines.push(`Season record — ${game.home_team}: ${f.homeRecord.wins}-${f.homeRecord.losses} (${(f.homeRecord.winPct * 100).toFixed(1)}% win) | Pt diff/g: ${f.homePointDiff >= 0 ? '+' : ''}${f.homePointDiff}`);
      if (f.awayRecord) edgeLines.push(`Season record — ${game.away_team}: ${f.awayRecord.wins}-${f.awayRecord.losses} (${(f.awayRecord.winPct * 100).toFixed(1)}% win) | Pt diff/g: ${f.awayPointDiff >= 0 ? '+' : ''}${f.awayPointDiff}`);
      if (f.homeRecentForm) edgeLines.push(`Recent form — ${game.home_team}: ${f.homeRecentForm.last5} last 5 (${(f.homeRecentForm.winPct * 100).toFixed(0)}%)`);
      if (f.awayRecentForm) edgeLines.push(`Recent form — ${game.away_team}: ${f.awayRecentForm.last5} last 5 (${(f.awayRecentForm.winPct * 100).toFixed(0)}%)`);
      if (f.scheduleStrength) edgeLines.push(`Schedule strength — ${game.home_team}: ${(f.scheduleStrength.home * 100).toFixed(1)}% opp avg | ${game.away_team}: ${(f.scheduleStrength.away * 100).toFixed(1)}% opp avg`);
    }
    if (ed.adjustments && ed.adjustments.length > 0) {
      edgeLines.push(`Key adjustments: ${ed.adjustments.map(a => `${a.factor} (${a.impact >= 0 ? '+' : ''}${(a.impact * 100).toFixed(1)}%)`).join('; ')}`);
    }
    edgeLines.push(`Your job: Does the news/injury/trend context SUPPORT or CONTRADICT this ${ed.edgePercent !== null ? ed.edgePercent.toFixed(1) + '% mathematical edge' : 'edge'}? Be explicit.`);
    edgeLines.push(`--- END STATISTICAL EDGE ---`);
    contextParts.push(edgeLines.join('\n'));
  }
  if (accuracy) contextParts.push(`Past accuracy: ${accuracy}`);

  // Refinement: inject prior analysis if this is a re-analysis
  let refinementBlock = '';
  if (priorAnalysis) {
    refinementBlock = `
REFINEMENT CONTEXT — This is pass #${priorAnalysis.version + 1} on this game.
YOUR PRIOR ANALYSIS (${priorAnalysis.version === 1 ? 'initial' : 'pass #' + priorAnalysis.version}):
  Edge score: ${priorAnalysis.prior_edge}/10
  Pick: ${priorAnalysis.prior_pick}
  Analysis: ${priorAnalysis.prior_snippet}

YOUR TASK: Compare the current data above to your prior analysis. What changed?
- New injury reports? Line movement? Recent game results?
- Should your edge score go UP (more confident), DOWN (less confident), or STAY?
- Explain SPECIFICALLY what changed and why in the "what_changed" field.
- If nothing meaningful changed, keep your prior score but note "No significant changes."
`;
  }

  const prompt = `${playbook ? playbook + '\n\n---\n\n' : ''}You are a sharp sports betting analyst writing for a premium picks service. Analyze this game and provide a detailed, data-backed betting recommendation.
${refinementBlock}

${contextParts.join('\n')}

CRITICAL RULES:
- CITE SPECIFIC NUMBERS: W-L records, point differentials, recent scores, rankings
- Reference the ACTUAL recent game results if provided (e.g., "W 96-84 vs Auburn")
- Mention rankings if available (e.g., "#4 Florida hosts #15 Alabama")
- Your analysis should read like an expert handicapper, not a generic preview
- If a team's recent results show a trend (3 straight wins, blowout losses), highlight it
- Compare the spread/total to the actual scoring data when available

BET TYPE PRIORITY (based on our actual model performance):
- MONEYLINE picks hit at 70-77%. If one team is clearly stronger, recommend home_ml or away_ml.
- SPREAD picks hit at 61%. Only recommend when data strongly supports the margin.
- TOTAL picks hit at 56%. Only recommend when you have scoring data for BOTH teams.
- PREFER MONEYLINE when there's a clear favorite. Our users make the most money on ML picks.

BAD example: "Alabama has strong offensive performance and home advantage"
GOOD example: "Alabama (23-8, #15) beat Auburn 96-84 and Tennessee 71-69 in their last two, averaging 83.5 PPG. Florida (25-6, #4) is dominant at home but the 11.5-point spread is steep given Bama's recent form."

SPREAD SIGN RULES (critical — get this right):
- NEGATIVE spread (-1.5, -7.5) = FAVORITE, they must win by more than that margin
- POSITIVE spread (+1.5, +7.5) = UNDERDOG, they get those points added to their score
- The spread sign is provided in the matchup data above — use it EXACTLY as shown
- Example: if Team A is +1.5, your pick must say "Team A +1.5" NOT "Team A -1.5"

Respond in EXACTLY this JSON format (no markdown):
{
  "analysis": "3-5 sentence analysis citing specific records, scores, and matchup factors",
  "edge_score": 7.5,
  "recommended_pick": "Kansas -7.5",
  "recommended_side": "home_spread",
  "key_factors": ["factor1 with numbers", "factor2 with numbers", "factor3 with numbers"]${priorAnalysis ? ',\n  "what_changed": "Explain what changed since last analysis (injuries, line movement, new results)"' : ''}
}

edge_score: 1-10 (10 = strongest edge). recommended_side must be one of: home_spread, away_spread, over, under, home_ml, away_ml. Key factors MUST include specific numbers/records. The recommended_pick MUST include the correct spread sign (+ or -) matching the data provided.`;

  try {
    const response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 600
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    const usage = data.usage;

    if (!content) throw new Error('Empty response from OpenAI');

    // Parse JSON (strip markdown fences if present)
    const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return {
      analysis_snippet: parsed.analysis,
      edge_score: parsed.edge_score,
      recommended_pick: parsed.recommended_pick,
      recommended_side: parsed.recommended_side,
      key_factors: parsed.key_factors,
      what_changed: parsed.what_changed || null,
      prompt_tokens: usage?.prompt_tokens,
      completion_tokens: usage?.completion_tokens
    };
  } catch (err) {
    console.error(`AI analysis failed for ${game.game_key}:`, err.message);
    return null;
  }
}

// All supported sports
const ALL_SPORT_SLUGS = [
  'americanfootball_nfl', 'basketball_nba', 'basketball_ncaab',
  'icehockey_nhl', 'americanfootball_ncaaf', 'baseball_mlb',
  'soccer_epl'
];

// Sport group mappings for staggered crons
const SPORT_GROUPS = {
  'nba': ['basketball_nba'],
  'ncaab': ['basketball_ncaab'],
  'nhl': ['icehockey_nhl'],
  'mlb': ['baseball_mlb'],
  'epl': ['soccer_epl'],
  'football': ['americanfootball_nfl', 'americanfootball_ncaaf'],
  'all': ALL_SPORT_SLUGS
};

async function preAnalyzeGames(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Accept ?sports=nba or ?sports=nba,nhl or ?sports=all (default)
  const sportsParam = (req.query.sports || 'all').toLowerCase();
  const sportSlugs = sportsParam.split(',').flatMap(s => SPORT_GROUPS[s.trim()] || []);
  if (sportSlugs.length === 0) {
    return res.status(400).json({ error: `Unknown sport group: ${sportsParam}. Use: ${Object.keys(SPORT_GROUPS).join(', ')}` });
  }

  const sportNames = sportSlugs.map(s => SLUG_TO_SPORT[s] || s).join(', ');
  res.status(202).json({ status: 'accepted', message: `Pre-analysis started for ${sportNames}`, sports: sportSlugs });

  runPreAnalysis(sportSlugs).catch(err => console.error('❌ Pre-analysis background error:', err.message));
}

async function runPreAnalysis(sportSlugs) {
  const startTime = Date.now();

  try {
    const sportNames = sportSlugs.map(s => SLUG_TO_SPORT[s] || s).join(', ');
    console.log(`\n🧠 CRON: Pre-analyzing ${sportNames}...`);

    let games = await getUpcomingGames(sportSlugs);

    // Filter out hypothetical future-round matchups (e.g., championship lines
    // posted before semifinals are played). If a team has a game within 48h,
    // skip any later game for that team — they have to win the earlier one first.
    const now = Date.now();
    const cutoff48h = now + 48 * 60 * 60 * 1000;
    const teamEarliestGame = {};
    for (const g of games) {
      const gameTime = new Date(g.game_date).getTime();
      for (const team of [g.home_team, g.away_team]) {
        if (!teamEarliestGame[team] || gameTime < teamEarliestGame[team]) {
          teamEarliestGame[team] = gameTime;
        }
      }
    }
    const allGamesBeforeFilter = [...games];
    const beforeFilter = games.length;
    games = games.filter(g => {
      const gameTime = new Date(g.game_date).getTime();
      // Keep if this IS the earliest game for both teams, or if both teams' earliest game is >48h out
      const homeEarliest = teamEarliestGame[g.home_team];
      const awayEarliest = teamEarliestGame[g.away_team];
      const homeHasEarlier = homeEarliest < gameTime && homeEarliest < cutoff48h;
      const awayHasEarlier = awayEarliest < gameTime && awayEarliest < cutoff48h;
      return !homeHasEarlier && !awayHasEarlier;
    });
    if (beforeFilter !== games.length) {
      const keptKeys = new Set(games.map(g => g.game_key));
      const hypotheticalKeys = allGamesBeforeFilter
        .filter(g => !keptKeys.has(g.game_key))
        .map(g => g.game_key);
      console.log(`🔍 Filtered ${hypotheticalKeys.length} hypothetical future-round games`);

      // Clean up any previously-analyzed hypothetical games from game_analysis
      if (hypotheticalKeys.length > 0) {
        const { error: delErr } = await supabase
          .from('game_analysis')
          .delete()
          .in('game_key', hypotheticalKeys);
        if (!delErr) {
          console.log(`🗑️ Cleaned ${hypotheticalKeys.length} hypothetical games from game_analysis`);
        }
      }
    }

    console.log(`📊 Found ${games.length} upcoming games to analyze`);

    if (games.length === 0) {
      console.log('No upcoming games found');
      return;
    }

    // 2. Check which games already have analysis (fresh or stale)
    const { data: existingAnalysis } = await supabase
      .from('game_analysis')
      .select('game_key, generated_at, stale, analysis_snippet, edge_score, analysis_version, recommended_pick')
      .in('game_key', games.map(g => g.game_key));

    const existingKeys = new Set();
    const priorAnalysisMap = {};
    for (const ea of (existingAnalysis || [])) {
      const age = Date.now() - new Date(ea.generated_at).getTime();
      if (age < 3 * 60 * 60 * 1000 && !ea.stale) {
        existingKeys.add(ea.game_key); // Fresh, skip
      } else {
        // Stale — store prior analysis for refinement
        priorAnalysisMap[ea.game_key] = {
          prior_snippet: ea.analysis_snippet,
          prior_edge: ea.edge_score,
          prior_pick: ea.recommended_pick,
          version: ea.analysis_version || 1
        };
      }
    }

    const gamesToAnalyze = games.filter(g => !existingKeys.has(g.game_key));

    // Prioritize games in next 24 hours, then by sport variety
    const next24h = Date.now() + 24 * 60 * 60 * 1000;
    gamesToAnalyze.sort((a, b) => {
      const aIn24 = new Date(a.game_date).getTime() < next24h ? 0 : 1;
      const bIn24 = new Date(b.game_date).getTime() < next24h ? 0 : 1;
      if (aIn24 !== bIn24) return aIn24 - bIn24; // Next 24h first
      return new Date(a.game_date) - new Date(b.game_date); // Then by time
    });

    const in24Count = gamesToAnalyze.filter(g => new Date(g.game_date).getTime() < next24h).length;
    console.log(`🔄 ${gamesToAnalyze.length} games need analysis (${existingKeys.size} fresh, ${in24Count} in next 24h)`);

    // Load AI playbook from DB
    let playbook = '';
    try {
      playbook = await aiInstructions.getForPreAnalysis();
      if (playbook) console.log(`📖 Loaded AI playbook (${playbook.length} chars)`);
    } catch (e) { /* continue without */ }

    // Instantiate edge calculator (reuse single instance across all games)
    const edgeCalc = new EdgeCalculator(supabase);

    // 3. Analyze each game
    let analyzed = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    const errors = [];

    const batch = gamesToAnalyze.slice(0, 50);
    console.log(`🎯 Batch size: ${batch.length} games to analyze`);
    if (batch.length > 0) {
      console.log(`  First game: ${batch[0].game_key} (${batch[0].sport})`);
    }

    for (const game of batch) {
      try {
        const oddsCtx = extractOddsContext(game);
        const sportDisplay = SLUG_TO_SPORT[game.sport] || game.sport.toUpperCase();

        // Fetch context in parallel — DB queries + API-Sports + news
        const [newsCtx, injuryCtx, rankCtx, homeTrend, awayTrend, accuracy, apiSportsCtx, playerStatsCtx] = await Promise.all([
          getNewsContext(game.home_team, game.away_team, sportDisplay),
          getInjuryContext(game.home_team, game.away_team),
          getRankingsContext(game.home_team, game.away_team),
          getRecentResults(game.home_team, game.sport),
          getRecentResults(game.away_team, game.sport),
          getPastAccuracy(game.sport),
          getApiSportsContext(game.home_team, game.away_team, game.sport),
          getPlayerStatsContext(game.home_team, game.away_team, game.sport)
        ]);

        // Get prior analysis for refinement loop
        const prior = priorAnalysisMap[game.game_key] || null;
        if (prior) {
          console.log(`  🔄 Refinement pass #${prior.version + 1} for ${game.game_key} (prior edge: ${prior.prior_edge}/10)`);
        }

        // Calculate statistical edge BEFORE passing to AI
        let edgeData = null;
        try {
          edgeData = await edgeCalc.calculateEdge(game);
          if (edgeData) {
            const edgeSign = edgeData.edge !== null ? (edgeData.edge >= 0 ? '+' : '') + (edgeData.edge * 100).toFixed(1) + '%' : 'N/A';
            console.log(`  📐 Edge: ${edgeSign} on ${edgeData.edgeSide || '?'} (${edgeData.confidence}) — home ${(edgeData.homeWinProb * 100).toFixed(1)}% vs implied ${edgeData.impliedHomeProb !== null ? (edgeData.impliedHomeProb * 100).toFixed(1) + '%' : 'N/A'}`);
          }
        } catch (edgeErr) {
          console.warn(`  Edge calc failed for ${game.game_key}: ${edgeErr.message}`);
        }

        const result = await analyzeGame(game, oddsCtx, newsCtx, injuryCtx, rankCtx, homeTrend, awayTrend, accuracy, apiSportsCtx, playerStatsCtx, playbook, prior, edgeData);

        if (!result) {
          console.warn(`  ⚠️ analyzeGame returned null for ${game.game_key}`);
          errors.push(`${game.game_key}: AI returned null`);
        }

        if (result) {
          const record = {
            game_key: game.game_key,
            sport: sportDisplay,
            home_team: game.home_team,
            away_team: game.away_team,
            game_date: game.game_date,
            home_record: rankCtx.home_record,
            away_record: rankCtx.away_record,
            home_ranking: rankCtx.home_rank,
            away_ranking: rankCtx.away_rank,
            spread: oddsCtx.spread,
            total: oddsCtx.total,
            moneyline_home: oddsCtx.ml_home,
            moneyline_away: oddsCtx.ml_away,
            analysis_snippet: result.analysis_snippet,
            edge_score: result.edge_score,
            recommended_pick: result.recommended_pick,
            recommended_side: result.recommended_side,
            key_factors: result.key_factors,
            news_context: newsCtx,
            injury_context: injuryCtx,
            model_used: 'gpt-4o-mini',
            prompt_tokens: result.prompt_tokens,
            completion_tokens: result.completion_tokens,
            generated_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
            stale: false,
            // Refinement loop fields
            analysis_version: prior ? prior.version + 1 : 1,
            prior_analysis: prior ? prior.prior_snippet : null,
            prior_edge_score: prior ? prior.prior_edge : null,
            edge_movement: prior ? (result.edge_score > prior.prior_edge ? 'up' : result.edge_score < prior.prior_edge ? 'down' : 'stable') : null,
            what_changed: result.what_changed || null,
            // Statistical edge calculator outputs
            calc_home_prob: edgeData ? edgeData.homeWinProb : null,
            calc_away_prob: edgeData ? edgeData.awayWinProb : null,
            implied_home_prob: edgeData ? edgeData.impliedHomeProb : null,
            implied_away_prob: edgeData ? edgeData.impliedAwayProb : null,
            calc_edge: edgeData ? edgeData.edge : null,
            calc_edge_side: edgeData ? edgeData.edgeSide : null,
            edge_factors: edgeData ? edgeData.factors : null
          };

          const { error } = await supabase
            .from('game_analysis')
            .upsert(record, { onConflict: 'game_key' });

          if (error) {
            console.error(`DB error for ${game.game_key}:`, error.message);
            errors.push(`${game.game_key}: ${error.message}`);
          } else {
            analyzed++;
            totalPromptTokens += result.prompt_tokens || 0;
            totalCompletionTokens += result.completion_tokens || 0;

            // Auto-save ALL predictions to ai_suggestions for honest performance tracking
            if (result.recommended_pick) {
              try {
                // Determine bet type from the recommended pick text
                let betType = 'Moneyline';
                let point = null;
                const pickText = result.recommended_pick;
                if (pickText.match(/[+-]\d+\.?\d*/)) {
                  const spreadMatch = pickText.match(/([+-]\d+\.?\d*)/);
                  if (spreadMatch) point = parseFloat(spreadMatch[1]);
                  betType = 'Spread';
                }
                if (pickText.toLowerCase().includes('over') || pickText.toLowerCase().includes('under')) {
                  betType = 'Total';
                  const totalMatch = pickText.match(/(\d+\.?\d*)/);
                  if (totalMatch) point = parseFloat(totalMatch[1]);
                }

                const { error: sugErr } = await supabase
                  .from('ai_suggestions')
                  .insert({
                    session_id: `auto_digest_${new Date().toISOString().split('T')[0]}`,
                    sport: sportDisplay,
                    home_team: game.home_team,
                    away_team: game.away_team,
                    game_date: game.game_date,
                    bet_type: betType,
                    pick: result.recommended_pick,
                    point: point,
                    odds: null,
                    confidence: Math.round(result.edge_score),
                    reasoning: result.analysis_snippet,
                    risk_level: result.edge_score >= 8 ? 'Low' : 'Medium',
                    generate_mode: 'auto_digest',
                    actual_outcome: 'pending'
                  });
                if (sugErr) {
                  console.warn(`  Auto-save pick result: ${sugErr.message}`);
                } else {
                  console.log(`  ✅ Auto-saved pick: ${result.recommended_pick} (${sportDisplay})`);
                }
              } catch (e) {
                console.error(`  ❌ Auto-save exception: ${e.message}`);
              }
            }
          }
        }

        // Small delay between OpenAI calls
        await new Promise(r => setTimeout(r, 500));

      } catch (err) {
        console.error(`Error analyzing ${game.game_key}:`, err.message);
        errors.push(`${game.game_key}: ${err.message}`);
      }
    }

    const duration = Date.now() - startTime;
    const estimatedCost = ((totalPromptTokens * 0.00000015) + (totalCompletionTokens * 0.0000006)).toFixed(4);

    // Log results to cron_job_logs for admin dashboard visibility
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: `pre-analyze-${sportSlugs.map(s => SLUG_TO_SPORT[s] || s).join('-')}`,
        status: errors.length === 0 ? 'completed' : 'partial',
        details: JSON.stringify({
          games_found: games.length,
          games_to_analyze: gamesToAnalyze.length,
          batch_size: batch.length,
          existing_fresh: existingKeys.size,
          analyzed,
          errors: errors.slice(0, 5),
          duration_ms: duration,
          cost: estimatedCost
        })
      });
    } catch (e) { /* don't block on logging */ }

    console.log(`\n🧠 Pre-analysis complete in ${(duration / 1000).toFixed(1)}s`);
    console.log(`📊 Analyzed: ${analyzed}/${batch.length} games`);
    console.log(`💰 Tokens: ${totalPromptTokens} prompt + ${totalCompletionTokens} completion ≈ $${estimatedCost}`);

    console.log(`✅ Pre-analysis complete: ${analyzed} games, $${estimatedCost}`);

  } catch (error) {
    console.error('❌ Pre-analysis failed:', error.message);
  }
}

module.exports = preAnalyzeGames;
