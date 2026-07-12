// CRON JOB: Pre-Analyze Upcoming Games
// Runs 2-3x daily to generate AI analysis snippets per game (Claude narrates;
// the math picks the side). Stores results in game_analysis for cheap/fast
// pick generation.
// Schedule: Every 4 hours
// Endpoint: POST /cron/pre-analyze-games

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const aiInstructions = require('../../lib/services/ai-instructions.js');
const { EdgeCalculator } = require('../../lib/services/edge-calculator.js');
const pickGrader = require('../../lib/services/pick-grader.js');
const { getIntelContext } = require('../../lib/services/data-integrity-agent.js');
const { getClient: getClaude, MODELS, extractJson } = require('../../lib/services/claude.js');

// Map odds_cache sport slugs to display sport names. Tennis (and golf)
// tournament keys ROTATE weekly and are discovered dynamically by the
// refresh-odds edge function, so they resolve by prefix — never enumerate
// tournaments here (the old static list went dark the Monday after Wimbledon).
const SLUG_TO_SPORT = {
  americanfootball_nfl: 'NFL',
  americanfootball_ncaaf: 'NCAAF',
  basketball_nba: 'NBA',
  basketball_ncaab: 'NCAAB',
  icehockey_nhl: 'NHL',
  baseball_mlb: 'MLB',
  soccer_epl: 'EPL',
  soccer_usa_mls: 'MLS',
  soccer_fifa_world_cup: 'World Cup',
  soccer_fifa_world_cup_womens: 'World Cup',
  soccer_uefa_champs_league: 'Champions League',
  soccer_conmebol_copa_america: 'Copa America',
  soccer_uefa_european_championship: 'Euros',
  mma_mixed_martial_arts: 'UFC'
};

function slugToSport(slug) {
  if (!slug) return slug;
  if (slug.startsWith('tennis_')) return 'Tennis';
  if (slug.startsWith('golf_')) return 'Golf';
  if (SLUG_TO_SPORT[slug]) return SLUG_TO_SPORT[slug];
  if (slug.startsWith('soccer_')) return 'Soccer';
  return slug;
}

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

  // Entries ending in '%' are prefix patterns (rotating tennis tournament
  // keys); everything else is an exact slug. PostgREST or-filters use * as
  // the wildcard.
  const exact = sports.filter(s => !s.includes('%'));
  const prefixes = sports.filter(s => s.includes('%'));
  const orParts = [];
  if (exact.length > 0) orParts.push(`sport.in.(${exact.map(s => `"${s}"`).join(',')})`);
  for (const p of prefixes) orParts.push(`sport.like.${p.replace(/%/g, '*')}`);

  const { data, error } = await supabase
    .from('odds_cache')
    .select('sport, home_team, away_team, commence_time, market_type, outcomes, bookmaker')
    .or(orParts.join(','))
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
  const ctx = {
    spread: null, total: null, ml_home: null, ml_away: null,
    spread_home_odds: null, spread_away_odds: null,
    over_odds: null, under_odds: null
  };

  // Spread — capture both point (line) and price (juice) per side
  const spreads = game.markets['spreads'];
  if (spreads) {
    const homeSpread = spreads.find(o => o.name === game.home_team);
    const awaySpread = spreads.find(o => o.name === game.away_team);
    if (homeSpread) { ctx.spread = homeSpread.point; ctx.spread_home_odds = homeSpread.price; }
    if (awaySpread) { ctx.spread_away_odds = awaySpread.price; }
  }

  // Total — capture O/U line and juice per side
  const totals = game.markets['totals'];
  if (totals) {
    const over = totals.find(o => o.name === 'Over');
    const under = totals.find(o => o.name === 'Under');
    if (over) { ctx.total = over.point; ctx.over_odds = over.price; }
    if (under) { ctx.under_odds = under.price; }
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

// Re-exported from the shared pick-grader module so everything that formats a
// pick goes through one helper.
const { formatAmericanOdds, buildPickText, resolveOddsForSide: resolveOddsForPick } = pickGrader;

/**
 * Get relevant news snippets for a game's teams.
 *
 * Matches on the FULL team/player name (not last-word mascot) to prevent
 * cross-sport contamination. Previously `"Leylah Fernandez"` → `"Fernandez"`
 * matched unrelated Brooklyn Nets articles about assistant coach Fernandez.
 * Full-name matching may miss articles that use short forms (e.g., "Lakers"
 * alone instead of "Los Angeles Lakers"), but fewer false matches beats
 * hallucinated cross-sport context — source-of-truth > coverage.
 */
async function getNewsContext(homeTeam, awayTeam, sport) {
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    // Strip chars that break PostgREST filter syntax (commas, parens).
    // Apostrophes are fine — supabase-js URL-encodes them.
    const homeQuery = homeTeam.replace(/[(),]/g, '').trim();
    const awayQuery = awayTeam.replace(/[(),]/g, '').trim();
    if (!homeQuery || !awayQuery) return null;

    const { data } = await supabase
      .from('news_articles')
      .select('title, summary, betting_summary, content, published_at')
      .gte('published_at', threeDaysAgo)
      .or(`title.ilike.%${homeQuery}%,title.ilike.%${awayQuery}%,summary.ilike.%${homeQuery}%,summary.ilike.%${awayQuery}%`)
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
    // Full-team-name match prevents collisions like "%Sox%" catching both
    // White Sox and Red Sox rows. Same rationale as edge-calculator.js.
    const homeQ = (homeTeam || '').replace(/[(),]/g, '').trim();
    const awayQ = (awayTeam || '').replace(/[(),]/g, '').trim();
    const homeLower = homeQ.toLowerCase();
    const awayLower = awayQ.toLowerCase();

    const result = { home_rank: null, away_rank: null, home_record: null, away_record: null, home_streak: null, away_streak: null };
    if (!homeQ || !awayQ) return result;

    // Primary source: current_standings (populated by sync-standings cron from ESPN)
    const { data: standingsData } = await supabase
      .from('current_standings')
      .select('team_name, wins, losses, ties, win_percentage, point_differential, streak, division_rank')
      .or(`team_name.ilike.%${homeQ}%,team_name.ilike.%${awayQ}%`);

    if (standingsData) {
      for (const s of standingsData) {
        const sLower = s.team_name.toLowerCase();
        // Bidirectional match: either the standings name contains the full query,
        // or the query contains the standings name (handles cases where ESPN uses
        // a slightly shorter form than the odds feed, e.g. "LA Dodgers" vs "Los Angeles Dodgers").
        const isHome = sLower.includes(homeLower) || homeLower.includes(sLower);
        const isAway = sLower.includes(awayLower) || awayLower.includes(sLower);

        const record = s.ties > 0 ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`;
        if (isHome && !result.home_record) {
          result.home_record = record;
          result.home_streak = s.streak || null;
        }
        if (isAway && !result.away_record) {
          result.away_record = record;
          result.away_streak = s.streak || null;
        }
      }
    }

    // Secondary source: rankings_cache (AP Top 25 — adds rank for college teams).
    // Full-team-name match, same rationale as standings block above.
    const { data: rankData } = await supabase
      .from('rankings_cache')
      .select('team_name, rank, record')
      .or(`team_name.ilike.%${homeQ}%,team_name.ilike.%${awayQ}%`);

    if (rankData) {
      for (const r of rankData) {
        const rLower = r.team_name.toLowerCase();
        const isHome = rLower.includes(homeLower) || homeLower.includes(rLower);
        const isAway = rLower.includes(awayLower) || awayLower.includes(rLower);
        if (isHome) {
          result.home_rank = r.rank;
          if (!result.home_record && r.record) result.home_record = r.record;
        }
        if (isAway) {
          result.away_rank = r.rank;
          if (!result.away_record && r.record) result.away_record = r.record;
        }
      }
    }

    return result;
  } catch {
    return { home_rank: null, away_rank: null, home_record: null, away_record: null, home_streak: null, away_streak: null };
  }
}

/**
 * Get recent game results for trend context
 */
async function getRecentResults(teamName, sportSlug, limit = 5) {
  try {
    const mascot = teamName.split(' ').slice(-1)[0];
    // Map odds API slugs to game_results sport values
    const sportName = slugToSport(sportSlug);
    
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
 * Get Supabase DB stats: player_game_stats season averages for key players
 */
async function getPlayerStatsContext(homeTeam, awayTeam, sportSlug) {
  const sportName = slugToSport(sportSlug);
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
 * Generate AI analysis for a single game. Returns the analysis fields on
 * success, or { error } on failure so the caller can log the real reason.
 */
async function analyzeGame(game, oddsCtx, newsCtx, injuryCtx, rankCtx, homeTrend, awayTrend, accuracy, playerStatsCtx, playbook = '', priorAnalysis = null, edgeData = null, mathPick = null) {
  const sportDisplay = slugToSport(game.sport) || game.sport.toUpperCase();

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

  // Emit the actual season record whenever we have it (from current_standings).
  // Previously this only fired when `rank` was populated, which is college-only.
  // NBA/MLB/NHL etc. have no AP-style ranking, so their real season record never
  // made it into the prompt — the model was left with only the EdgeCalculator's
  // "last 20 games" record (mislabeled as Season record) and ended up writing
  // wrong records into snippets. This path is the single source of truth for
  // the full-season W-L.
  if (rankCtx.home_record) {
    const rankStr = rankCtx.home_rank ? ` (Ranked #${rankCtx.home_rank})` : '';
    const streakStr = rankCtx.home_streak ? `, streak ${rankCtx.home_streak}` : '';
    contextParts.push(`${game.home_team} season record: ${rankCtx.home_record}${rankStr}${streakStr}`);
  }
  if (rankCtx.away_record) {
    const rankStr = rankCtx.away_rank ? ` (Ranked #${rankCtx.away_rank})` : '';
    const streakStr = rankCtx.away_streak ? `, streak ${rankCtx.away_streak}` : '';
    contextParts.push(`${game.away_team} season record: ${rankCtx.away_record}${rankStr}${streakStr}`);
  }

  if (homeTrend) contextParts.push(`${game.home_team} last ${homeTrend.games.length}: ${homeTrend.record} — ${homeTrend.games.join('; ')}`);
  if (awayTrend) contextParts.push(`${game.away_team} last ${awayTrend.games.length}: ${awayTrend.record} — ${awayTrend.games.join('; ')}`);

  if (playerStatsCtx) contextParts.push(`Key player averages:\n${playerStatsCtx}`);
  if (injuryCtx) contextParts.push(`Injuries: ${injuryCtx}`);
  if (newsCtx) contextParts.push(`Recent news:\n${newsCtx}`);

  // Statistical edge block — inject only when EdgeCalculator has REAL record/form data.
  // Sports without a stats source (Tennis, UFC, sometimes MLS) previously got the
  // calculator's no-data fallback (~53% / 47% defaults) surfaced as prompt input,
  // producing identical-looking "calculated win probability" numbers on every tile.
  //
  // Trimmed to a tight 2-line signal (math-edge conclusion + recent form) now that
  // the prompt already carries the actual season record from current_standings.
  // Intermediate math inputs (calculated win prob, implied prob, pt diff, schedule
  // strength, adjustments, last-20 record) removed — they were noise the model
  // parroted incorrectly and are redundant with the real season record.
  const hasRealEdgeData = edgeData
    && edgeData.factors
    && (edgeData.factors.homeRecord
        || edgeData.factors.awayRecord
        || edgeData.factors.homeRecentForm
        || edgeData.factors.awayRecentForm);

  if (hasRealEdgeData) {
    const ed = edgeData;
    const edgeLines = [`--- STATISTICAL EDGE ---`];

    // Per-side edges, signed. The LLM should pick the side with the
    // largest positive edge — anything < +2pp is market noise; ML picks
    // hit hardest historically when their edge is real.
    const fmt = (e) => e == null ? 'N/A' : `${e >= 0 ? '+' : ''}${(e * 100).toFixed(1)}pp`;
    if (ed.edges) {
      const e = ed.edges;
      edgeLines.push(`Per-side model edge vs market (positive = value):`);
      edgeLines.push(`  ${game.home_team} ML: ${fmt(e.home_ml)}    ${game.away_team} ML: ${fmt(e.away_ml)}`);
      if (e.home_spread != null || e.away_spread != null) {
        edgeLines.push(`  ${game.home_team} spread: ${fmt(e.home_spread)}    ${game.away_team} spread: ${fmt(e.away_spread)}`);
      }
      if (ed.modelMargin != null && ed.market?.homeSpread != null) {
        edgeLines.push(`  Model expects ${game.home_team} ${ed.modelMargin >= 0 ? 'wins by' : 'loses by'} ${Math.abs(ed.modelMargin).toFixed(1)} (market spread: ${ed.market.homeSpread})`);
      }
      edgeLines.push(`Confidence: ${ed.confidence}.`);
    } else if (ed.edge !== null) {
      // Legacy fallback when per-side edges weren't computed (no spread market).
      const edgeSign = ed.edge >= 0 ? '+' : '';
      const edgeTeam = ed.edgeSide === 'home' ? game.home_team : game.away_team;
      edgeLines.push(`Edge: ${edgeSign}${(ed.edge * 100).toFixed(1)}% on ${edgeTeam} (${ed.confidence} confidence)`);
    }

    if (ed.factors) {
      const f = ed.factors;
      if (f.homeRecentForm) edgeLines.push(`${game.home_team} last 5: ${f.homeRecentForm.last5}`);
      if (f.awayRecentForm) edgeLines.push(`${game.away_team} last 5: ${f.awayRecentForm.last5}`);
    }

    // Only emit the block if we actually added at least one data line beyond the header
    if (edgeLines.length > 1) {
      edgeLines.push(`--- END EDGE ---`);
      contextParts.push(edgeLines.join('\n'));
    }
  }
  if (accuracy) contextParts.push(`Past accuracy: ${accuracy}`);

  // Refinement: inject prior analysis if this is a re-analysis
  let refinementBlock = '';
  if (priorAnalysis) {
    refinementBlock = `
REFINEMENT CONTEXT — This is pass #${priorAnalysis.version + 1} on this game.
YOUR PRIOR ANALYSIS (${priorAnalysis.version === 1 ? 'initial' : 'pass #' + priorAnalysis.version}):
  Pick: ${priorAnalysis.prior_pick}
  Analysis: ${priorAnalysis.prior_snippet}
  (Edge score is computed from our model, not your judgment — last pass: ${priorAnalysis.prior_edge}/10)

YOUR TASK: Compare the current data above to your prior analysis. What changed?
- New injury reports? Line movement? Recent game results?
- Did your recommended pick change? If so, why?
- Explain SPECIFICALLY what changed and why in the "what_changed" field.
- If nothing meaningful changed, keep your prior pick and note "No significant changes."
`;
  }

  // The pick is chosen by the math (edge-calculator.pickBestSide). The LLM's
  // job is to JUSTIFY that pick with specific data — not to override it. This
  // is the structural fix for the "LLM picks the wrong side because of
  // narrative" problem (e.g., OKC -10.5 picked over Lakers +10.5 despite a
  // +18pp model edge on the Lakers side).
  const pickBlock = mathPick
    ? `\nOUR MODEL'S PICK (fixed — do not change):
  Side: ${mathPick.recommended_side}
  Pick text: ${mathPick.recommended_pick}
  Model edge: ${(mathPick.signedEdge * 100).toFixed(1)}pp vs market
  Your job is to JUSTIFY this pick using the matchup data above. If the data
  contradicts the model's pick, say so honestly in the analysis (we'd rather
  catch a model mistake than confidently bullshit). Do NOT write a different
  pick — that's chosen by our math.\n`
    : `\nOUR MODEL HAS NO EDGE on this game (every market < +2pp). Your job is to
  write a 2-3 sentence preview that explains why this game lacks a clear edge.
  Do not recommend a pick.\n`;

  const prompt = `${playbook ? playbook + '\n\n---\n\n' : ''}You are a sharp sports betting analyst writing for a premium picks service. Justify our model's pick using the data below.
${refinementBlock}

${contextParts.join('\n')}
${pickBlock}
CRITICAL RULES:
- CITE SPECIFIC NUMBERS: W-L records, point differentials, recent scores, rankings
- Reference the ACTUAL recent game results if provided (e.g., "W 96-84 vs Auburn")
- Mention rankings if available (e.g., "#4 Florida hosts #15 Alabama")
- Your analysis should read like an expert handicapper, not a generic preview
- If a team's recent results show a trend (3 straight wins, blowout losses), highlight it
- Compare the spread/total to the actual scoring data when available
- NEVER INVENT NUMBERS: if a spread, total, record, ranking, win probability, or trend
  is NOT provided in the matchup data above, DO NOT write a specific value for it.
  If the data isn't there, either omit that dimension or say "not available" explicitly.
  It is better to have shorter analysis than confident-sounding invented numbers.

Respond in EXACTLY this JSON format (no markdown):
{
  "analysis": "3-5 sentence analysis citing specific records, scores, and matchup factors",
  "key_factors": ["factor1 with numbers", "factor2 with numbers", "factor3 with numbers"]${priorAnalysis ? ',\n  "what_changed": "Explain what changed since last analysis (injuries, line movement, new results)"' : ''}
}

Key factors MUST include specific numbers/records. Do NOT include recommended_pick, recommended_side, or edge_score — those are determined by the math, not by you.`;

  try {
    const claude = getClaude();
    if (!claude) throw new Error('Server missing ANTHROPIC_API_KEY');

    const data = await claude.messages.create({
      model: MODELS.NARRATION,
      // Sonnet narrations run 500-600 output tokens where gpt-4o-mini used
      // ~150-200. The old 600 cap truncated most responses mid-JSON, so
      // nearly every analysis parsed as null (broke the whole board 7/11).
      max_tokens: 1500,
      // Narration only — the math already picked the side. Thinking stays
      // off to keep the per-game cost/latency profile of the old setup.
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: prompt }],
    });

    const content = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const usage = data.usage;

    if (!content) throw new Error('Empty response from Claude');
    if (data.stop_reason === 'max_tokens') throw new Error(`Response truncated at max_tokens (${usage?.output_tokens} tokens)`);

    const parsed = extractJson(content);
    if (!parsed || !parsed.analysis) throw new Error(`Unparseable model response: ${content.slice(0, 120)}`);

    // Pick is now math-derived — return it alongside the LLM's analysis text.
    // LLM is no longer allowed to change recommended_pick / recommended_side.
    return {
      analysis_snippet: parsed.analysis,
      edge_score_llm_fallback: null,
      recommended_pick: mathPick ? mathPick.recommended_pick : null,
      recommended_side: mathPick ? mathPick.recommended_side : null,
      key_factors: parsed.key_factors,
      what_changed: parsed.what_changed || null,
      prompt_tokens: usage?.input_tokens,
      completion_tokens: usage?.output_tokens
    };
  } catch (err) {
    console.error(`AI analysis failed for ${game.game_key}:`, err.message);
    // Surface the real reason to the caller — cron_job_logs used to record
    // only "AI returned null", which hid a truncation bug for 12 hours.
    return { error: err.message };
  }
}

// All supported sports. Entries ending in '%' are prefix patterns resolved
// against odds_cache at query time (tennis tournament keys rotate weekly).
// Golf is deliberately absent: its markets are outright-winner fields, which
// don't fit the h2h edge model — golf odds land in odds_cache for display,
// not for pre-analysis.
const ALL_SPORT_SLUGS = [
  'americanfootball_nfl', 'basketball_nba', 'basketball_ncaab',
  'icehockey_nhl', 'americanfootball_ncaaf', 'baseball_mlb',
  'soccer_%', 'mma_mixed_martial_arts',
  'tennis_%'
];

// Sport group mappings for staggered crons
const SPORT_GROUPS = {
  'nba': ['basketball_nba'],
  'ncaab': ['basketball_ncaab'],
  'nhl': ['icehockey_nhl'],
  'mlb': ['baseball_mlb'],
  'epl': ['soccer_epl'],
  'mls': ['soccer_usa_mls'],
  'ufc': ['mma_mixed_martial_arts'],
  'tennis': ['tennis_%'],
  'soccer': ['soccer_%'],
  'worldcup': ['soccer_fifa_world_cup'],
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

  const sportNames = sportSlugs.map(s => slugToSport(s)).join(', ');
  res.status(202).json({ status: 'accepted', message: `Pre-analysis started for ${sportNames}`, sports: sportSlugs });

  runPreAnalysis(sportSlugs).catch(err => console.error('❌ Pre-analysis background error:', err.message));
}

async function runPreAnalysis(sportSlugs) {
  const startTime = Date.now();
  const jobName = `pre-analyze-${[...new Set(sportSlugs.map(s => slugToSport(s)))].join('-')}`;

  try {
    const sportNames = sportSlugs.map(s => slugToSport(s)).join(', ');
    console.log(`\n🧠 CRON: Pre-analyzing ${sportNames}...`);

    // Started marker — a run that dies mid-flight (deploy restart, crash)
    // leaves this row with no completion row after it, instead of vanishing
    // without a trace (which hid failures on 7/12).
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: jobName, status: 'started',
        details: JSON.stringify({ sports: sportSlugs }),
      });
    } catch (e) { /* don't block on logging */ }

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
      // Log the empty run — bare returns left "started" rows with no
      // completion, which read as mid-flight deaths and burned a morning
      // of debugging a phantom hang (7/12).
      try {
        await supabase.from('cron_job_logs').insert({
          job_name: jobName, status: 'completed',
          details: JSON.stringify({ games_found: 0, analyzed: 0 }),
        });
      } catch (e) { /* don't block on logging */ }
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
        const sportDisplay = slugToSport(game.sport) || game.sport.toUpperCase();

        // Fetch context in parallel — DB queries + API-Sports + news
        const [newsCtxRaw, injuryCtx, rankCtx, homeTrend, awayTrend, accuracy, playerStatsCtx, intelCtx] = await Promise.all([
          getNewsContext(game.home_team, game.away_team, sportDisplay),
          getInjuryContext(game.home_team, game.away_team),
          getRankingsContext(game.home_team, game.away_team),
          getRecentResults(game.home_team, game.sport),
          getRecentResults(game.away_team, game.sport),
          getPastAccuracy(game.sport),
          getPlayerStatsContext(game.home_team, game.away_team, game.sport),
          // Web-verified injuries/weather/record warnings from the data
          // integrity agent (empty string when no fresh intel exists).
          getIntelContext(supabase, game.home_team, game.away_team)
        ]);
        const newsCtx = `${newsCtxRaw || ''}${intelCtx || ''}` || null;

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

        // MATH PICKS, LLM NARRATES — choose side+market from per-side edges,
        // then ask the LLM only to justify it. The previous flow let the LLM
        // pick its own side, which broke when narrative ("5-game win streak")
        // overruled the per-side edge data (e.g., OKC -10.5 chosen over the
        // +18pp Lakers +10.5 cover edge).
        let mathPick = null;
        const bestSide = edgeData ? edgeCalc.pickBestSide(edgeData) : null;
        if (bestSide) {
          const pickText = buildPickText(bestSide.side, oddsCtx, game);
          if (pickText) {
            mathPick = {
              recommended_side: bestSide.side,
              recommended_pick: pickText,
              signedEdge: bestSide.signedEdge,
            };
            console.log(`  🎯 Math pick: ${pickText} (${bestSide.side}, edge ${(bestSide.signedEdge * 100).toFixed(1)}pp)`);
          }
        } else {
          console.log(`  ⚪ No-edge game — every market < +2pp`);
        }

        const result = await analyzeGame(game, oddsCtx, newsCtx, injuryCtx, rankCtx, homeTrend, awayTrend, accuracy, playerStatsCtx, playbook, prior, edgeData, mathPick);

        if (!result || result.error) {
          const reason = result?.error || 'AI returned null';
          console.warn(`  ⚠️ analyzeGame failed for ${game.game_key}: ${reason}`);
          errors.push(`${game.game_key}: ${reason}`);
        }

        if (result && !result.error) {
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
            // Deterministic edge_score from edge-calculator (clamp(0,10, edgePct + confBonus)).
            // Falls back to LLM-supplied number only when calc has no market data.
            // Score the bet that was actually picked. A spread pick on a
            // heavy ML favorite no longer inherits the ML probability gap.
            edge_score: edgeCalc.edgeScoreFromCalc(edgeData, result.recommended_side)
                        ?? result.edge_score_llm_fallback ?? null,
            recommended_pick: result.recommended_pick,
            recommended_side: result.recommended_side,
            // Real price of the recommended side at analysis time. The digest
            // lock payload reads this — it must never fall back to a made-up
            // -110, the ledger records it.
            recommended_odds: resolveOddsForPick(oddsCtx, result.recommended_side) ?? null,
            key_factors: result.key_factors,
            news_context: newsCtx,
            injury_context: injuryCtx,
            model_used: MODELS.NARRATION,
            prompt_tokens: result.prompt_tokens,
            completion_tokens: result.completion_tokens,
            generated_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
            stale: false,
            // Refinement loop fields
            analysis_version: prior ? prior.version + 1 : 1,
            prior_analysis: prior ? prior.prior_snippet : null,
            prior_edge_score: prior ? prior.prior_edge : null,
            edge_movement: (() => {
              if (!prior) return null;
              const newScore = edgeCalc.edgeScoreFromCalc(edgeData, result.recommended_side)
                               ?? result.edge_score_llm_fallback;
              if (newScore == null || prior.prior_edge == null) return null;
              return newScore > prior.prior_edge ? 'up' : newScore < prior.prior_edge ? 'down' : 'stable';
            })(),
            what_changed: result.what_changed || null,
            // Statistical edge calculator outputs
            calc_home_prob: edgeData ? edgeData.homeWinProb : null,
            calc_away_prob: edgeData ? edgeData.awayWinProb : null,
            implied_home_prob: edgeData ? edgeData.impliedHomeProb : null,
            implied_away_prob: edgeData ? edgeData.impliedAwayProb : null,
            calc_edge: edgeData ? edgeData.edge : null,
            calc_edge_side: edgeData ? edgeData.edgeSide : null,
            // Per-side edges {home_ml, away_ml, home_spread, away_spread, over, under}
            // so the chatbot + parlay generator can read the same math the
            // tile uses, without re-running calculateEdge.
            edges: edgeData ? edgeData.edges : null,
            // Same dict before the ±15pp cap — calibration needs the raw signal.
            edges_raw: edgeData ? edgeData.edgesRaw : null,
            // Merge factors + adjustments + confidence into edge_factors so the
            // fact sheet's edge.adjustments[] path resolves. Calculator returns
            // them as separate top-level keys on edgeData — flatten for storage.
            edge_factors: edgeData ? {
              ...edgeData.factors,
              adjustments: edgeData.adjustments || [],
              confidence: edgeData.confidence || null
            } : null
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
                // Derive bet type from the math-chosen side, NOT regex on the
                // pick text. ML picks include the price ("+310"), which the
                // old regex misclassified as a Spread.
                let betType = 'Moneyline';
                let point = null;
                const side = result.recommended_side;
                if (side === 'home_spread' || side === 'away_spread') {
                  betType = 'Spread';
                  point = oddsCtx.spread != null
                    ? (side === 'away_spread' ? -oddsCtx.spread : oddsCtx.spread)
                    : null;
                } else if (side === 'over' || side === 'under') {
                  betType = 'Total';
                  point = oddsCtx.total ?? null;
                }

                const pickOdds = formatAmericanOdds(resolveOddsForPick(oddsCtx, result.recommended_side));

                // Snapshot the edge that justified this pick. The analysis
                // cache gets regenerated, so the pick row must carry its own
                // pp/tier or win-rate-by-edge analysis becomes unprovable.
                const sideEdge = edgeData?.edges?.[side] ?? null;
                const sideEdgeRaw = edgeData?.edgesRaw?.[side] ?? sideEdge;
                const edgePp = sideEdge != null ? Math.round(sideEdge * 1000) / 10 : null;
                const isHomeMl = side === 'home_ml';
                const isAwayMl = side === 'away_ml';

                // Refinement passes re-run games that already saved their
                // pick — ignoreDuplicates keeps the original row (with its
                // odds/edge snapshot) instead of erroring on the unique key
                // every 3 hours.
                const { error: sugErr } = await supabase
                  .from('ai_suggestions')
                  .upsert({
                    session_id: `auto_digest_${new Date().toISOString().split('T')[0]}`,
                    sport: sportDisplay,
                    home_team: game.home_team,
                    away_team: game.away_team,
                    game_date: game.game_date,
                    bet_type: betType,
                    pick: result.recommended_pick,
                    point: point,
                    odds: pickOdds,
                    confidence: Math.round(result.edge_score),
                    reasoning: result.analysis_snippet,
                    risk_level: result.edge_score >= 8 ? 'Low' : 'Medium',
                    generate_mode: 'auto_digest',
                    actual_outcome: 'pending',
                    // 6 = calibrated devig regime (edge_calibration multipliers
                    // + real spread/total baselines). Calibration refresh only
                    // trusts picks from this regime forward.
                    pipeline_version: 6,
                    edge_pp: edgePp,
                    edge_pp_raw: sideEdgeRaw != null ? Math.round(sideEdgeRaw * 1000) / 10 : null,
                    tier: pickGrader.edgeTier(edgePp),
                    model_prob: isHomeMl ? edgeData?.homeWinProb ?? null
                              : isAwayMl ? edgeData?.awayWinProb ?? null : null,
                    implied_prob: isHomeMl ? edgeData?.impliedHomeProb ?? null
                                : isAwayMl ? edgeData?.impliedAwayProb ?? null : null
                  }, { onConflict: 'session_id,home_team,away_team,bet_type,pick', ignoreDuplicates: true });
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

        // Small delay between model calls
        await new Promise(r => setTimeout(r, 500));

      } catch (err) {
        console.error(`Error analyzing ${game.game_key}:`, err.message);
        errors.push(`${game.game_key}: ${err.message}`);
      }
    }

    const duration = Date.now() - startTime;
    // Sonnet per-token rates ($3 in / $15 out per MTok)
    const estimatedCost = ((totalPromptTokens * 0.000003) + (totalCompletionTokens * 0.000015)).toFixed(4);

    // Log results to cron_job_logs for admin dashboard visibility
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: `pre-analyze-${sportSlugs.map(s => slugToSport(s)).join('-')}`,
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
    // Total failures used to log only to the (unreadable) container console.
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: jobName, status: 'failed',
        details: JSON.stringify({
          error: error.message,
          stack: String(error.stack || '').split('\n').slice(0, 4).join(' | '),
        }),
      });
    } catch (e) { /* don't block on logging */ }
  }
}

module.exports = preAnalyzeGames;
