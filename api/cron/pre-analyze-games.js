// CRON JOB: Pre-Analyze Upcoming Games
// Runs 2-3x daily to generate AI analysis snippets per game (Claude narrates;
// the math picks the side). Stores results in game_analysis for cheap/fast
// pick generation.
// Schedule: Every 4 hours
// Endpoint: POST /cron/pre-analyze-games

const crypto = require('crypto');
const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { siteDay } = require('../../shared/site-day.js');
const aiInstructions = require('../../lib/services/ai-instructions.js');
const { EdgeCalculator } = require('../../lib/services/edge-calculator.js');
const pickGrader = require('../../lib/services/pick-grader.js');
const { getIntelContext } = require('../../lib/services/data-integrity-agent.js');
const { getClient: getClaude, MODELS, WRITING_STYLE, extractJson } = require('../../lib/services/claude.js');
const tennisModel = require('../../lib/services/edge-models/tennis-model.js');
const { getTennisContext, formatTennisContext } = require('../../lib/services/tennis-data.js');
const { getUfcContext, formatUfcContext, isKnownUfcBout } = require('../../lib/services/ufc-data.js');
const { getProbablePitchersText } = require('../../lib/services/probable-pitchers.js');
const bandCalibration = require('../../lib/services/band-calibration.js');
const ufcModel = require('../../lib/services/edge-models/ufc-model.js');
const soccer1x2 = require('../../lib/services/edge-models/soccer-1x2.js');
const trapDetector = require('../../lib/services/trap-detector.js');
const { applyExposureGuard } = require('../../lib/services/exposure-guard.js');
const { withTierHistory, historyEntry } = require('../../lib/services/tier-history.js');
const { shouldAlertTierEntry, sendTierAlert } = require('../../lib/services/discord-alerts.js');
const { chooseAltMarkets, altSessionId } = require('../../lib/services/alt-markets.js');
const { createRatingsProvider, getTennisCalibrationMultiplier } = require('../../lib/services/tennis-ratings.js');
const { getCalibrationMultiplier } = require('../../lib/services/calibration-multiplier.js');

// One provider per process; the Elo table load is cached inside it, so a
// 40-match tennis slate costs one pair of table reads, not 40.
const tennisRatingsProvider = createRatingsProvider(supabase);

// Fires the Discord alert on a pick's FIRST entry into Strong Play or
// Sharp Take, fresh publish or upward promotion (owner spec 2026-08-22:
// promotions matter, demotions do not, and never alert the same pick
// at the same tier twice). No-op until DISCORD_WEBHOOK_URL is set.
// Never throws into the publish path.
async function alertIfNewSharpTake(game, payload, existing) {
  try {
    if (!shouldAlertTierEntry(payload.tier, existing?.tier ?? null, existing?.tier_history ?? null)) return;
    const result = await sendTierAlert({
      tier: payload.tier,
      pick: payload.pick,
      sport: payload.sport,
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      gameDate: game.game_date,
      edgePp: payload.edge_pp,
      previousTier: existing?.tier && existing.tier !== payload.tier ? existing.tier : null,
    });
    if (result.sent) console.log(`  🔔 ${payload.tier} alert sent: ${payload.pick}`);
  } catch (e) {
    console.warn(`  Sharp Take alert failed: ${e.message}`);
  }
}

// Map odds_cache sport slugs to display sport names. Tennis (and golf)
// tournament keys ROTATE weekly and are discovered dynamically by the
// refresh-odds edge function, so they resolve by prefix. Never enumerate
// tournaments here (the old static list went dark the Monday after Wimbledon).
const SLUG_TO_SPORT = {
  americanfootball_nfl: 'NFL',
  // The Odds API serves preseason NFL under its own sport key. Without this
  // mapping every August probe of americanfootball_nfl found zero events and
  // preseason looked missing from the plan tier. Same display sport, so
  // preseason games flow through the normal NFL shadow pipeline.
  americanfootball_nfl_preseason: 'NFL',
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

// Soccer v1 is RETIRED (2026-07-12). The edge calculator prices two-way
// markets and never modeled the draw, so its soccer edges were structurally
// inflated (EPL ML settled 17-54). Soccer games still get preview analyses
// for the digest, but no picks publish until a real three-way model exists.
// Sports whose edges come from dedicated models running in SHADOW MODE:
// edges are computed and stored on the board (game_analysis) so the tiles
// show the read, but no pick reaches the record (ai_suggestions) until the
// model calibrates on settled shadow reads. Soccer uses the three-way 1X2
// module, tennis and UFC use market-consensus player models. Designs and
// un-shadow criteria live in docs/models/.
// Tennis promoted to production 2026-08-10 at owner direction, and runs
// both model signals (market consensus + Elo) since 2026-08-25.
// UFC promoted to production 2026-08-25 at owner direction: 81 graded
// shadow reads, recommended side 48-33 (59.3 pct), measured k 4.43, so
// the direction is proven while the claims stay tiny (0.35pp average,
// market-consensus only). In practice UFC feeds the board, legs, and
// traps; picks require the same 2pp pre-band gate as everyone and will
// stay rare until the model gets a fighter-strength signal. Soccer stays
// shadowed until a real three-way model clears the readiness bar.
//
// NFL and NCAAF are shadowed for PRESEASON ONLY (owner decision
// 2026-08-10): full analysis and nightly shadow grading of every raw
// edge, zero publication, so the preseason slate trains the calibration
// before a single pick goes public. Go-live is a deliberate flip at the
// season openers (NCAAF 2026-08-29, NFL 2026-09-10): remove the sport
// from this set and seed its edge_calibration multipliers from the
// preseason market_shadow_calibration() measured_k.
const SHADOW_SPORTS = new Set(['EPL', 'MLS', 'Soccer', 'World Cup', 'Champions League', 'Copa America', 'Euros', 'NFL', 'NCAAF']);
// Model routing for the three-way soccer family only. SHADOW_SPORTS
// answers "does it publish"; this set answers "which model prices it".
const SOCCER_1X2_SPORTS = new Set(['EPL', 'MLS', 'Soccer', 'World Cup', 'Champions League', 'Copa America', 'Euros']);

// ATP slams are best of five. Everything else, including all WTA events,
// is best of three. The tennis model prices the reliability gap between
// the two formats.
const BO5_TENNIS_KEYS = new Set([
  'tennis_atp_aus_open_singles',
  'tennis_atp_french_open',
  'tennis_atp_wimbledon',
  'tennis_atp_us_open'
]);

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
    .select('sport, home_team, away_team, commence_time, market_type, outcomes, bookmaker, external_game_id')
    .or(orParts.join(','))
    .gte('commence_time', now)
    .lte('commence_time', twoDaysOut)
    .order('commence_time', { ascending: true });

  if (error) throw new Error(`Failed to fetch odds: ${error.message}`);

  // Group by game
  const games = {};
  for (const row of (data || [])) {
    // Site-local day, not UTC: an evening game after 6 PM Denver landed
    // on tomorrow's key, which mislabeled every board day (2026-08-08).
    const dateStr = siteDay(row.commence_time);
    const key = makeGameKey(row.home_team, row.away_team, dateStr);

    if (!games[key]) {
      games[key] = {
        game_key: key,
        sport: row.sport,
        home_team: row.home_team,
        away_team: row.away_team,
        game_date: row.commence_time,
        odds_event_id: row.external_game_id || null,
        markets: {},
        h2hRows: []
      };
    }
    if (!games[key].odds_event_id && row.external_game_id) {
      games[key].odds_event_id = row.external_game_id;
    }

    // Prefer DraftKings, fall back to FanDuel
    const existing = games[key].markets[row.market_type];
    if (!existing || row.bookmaker === 'draftkings') {
      games[key].markets[row.market_type] = row.outcomes;
    }

    // Keep EVERY book's moneyline row. The tennis, UFC, and soccer models
    // build a cross-book consensus, and collapsing to one book above
    // starves them of their core signal.
    if (row.market_type === 'h2h') {
      games[key].h2hRows.push({ bookmaker: row.bookmaker, market_type: 'h2h', outcomes: row.outcomes });
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

  // Spread: capture both point (line) and price (juice) per side
  const spreads = game.markets['spreads'];
  if (spreads) {
    const homeSpread = spreads.find(o => o.name === game.home_team);
    const awaySpread = spreads.find(o => o.name === game.away_team);
    if (homeSpread) { ctx.spread = homeSpread.point; ctx.spread_home_odds = homeSpread.price; }
    if (awaySpread) { ctx.spread_away_odds = awaySpread.price; }
  }

  // Total: capture O/U line and juice per side
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

// Draw is its own 1X2 side. The pick text carries no team name on purpose:
// settlement matches team picks on pick.includes(team_name), and a draw
// pick must never match either team.
function buildDrawPickText(game) {
  const h2h = game.markets && game.markets['h2h'];
  const draw = Array.isArray(h2h) ? h2h.find(o => o && o.name === 'Draw') : null;
  if (!draw || draw.price == null) return 'Draw';
  return `Draw ${formatAmericanOdds(draw.price)}`;
}

// Draw price for storage paths that resolve odds by side.
function drawPrice(game) {
  const h2h = game.markets && game.markets['h2h'];
  const draw = Array.isArray(h2h) ? h2h.find(o => o && o.name === 'Draw') : null;
  return draw && draw.price != null ? draw.price : null;
}

// Bet type + line from the math-chosen side, NOT regex on the pick text.
// ML picks include the price ("+310"), which the old regex misclassified
// as a Spread. Shared by pick and trap publication.
function deriveBetTypeAndPoint(side, oddsCtx) {
  if (side === 'home_spread' || side === 'away_spread') {
    return {
      betType: 'Spread',
      point: oddsCtx.spread != null
        ? (side === 'away_spread' ? -oddsCtx.spread : oddsCtx.spread)
        : null,
    };
  }
  if (side === 'over' || side === 'under') {
    return { betType: 'Total', point: oddsCtx.total ?? null };
  }
  return { betType: 'Moneyline', point: null };
}

/**
 * ONE row per GAME per domain, across ALL board days. A refinement pass
 * REVISES the newest pending row (pick, odds, even the market can change
 * while the line moves) instead of inserting a sibling: 4 re-picks of the
 * same loser used to count as 4 losses. created_at stays the FIRST publish
 * time (the receipts stamp); last_revised_at tracks the final pre-game
 * version. Settled rows are never touched.
 *
 * Picks, traps, and legs are SEPARATE domains: one game can carry a pick
 * on one side, a trap on another, and a high-probability leg, so a row in
 * one domain must never revise a row in another. The partial unique index
 * uq_ai_suggestions_auto_digest_game keys on session_id, which differs
 * across the domains (auto_digest_ vs auto_digest_trap_ vs
 * auto_digest_leg_).
 */
// The headline pick can MOVE onto a market an alt spotlight row already
// occupies: the dedupe index (home, away, bet_type, pick, point, day)
// then rejects the headline revision with a unique violation, and the
// stale headline pick stands while the model's real read exists only as
// the alt. Found live on raw-band promotion day (2026-08-31): both
// muted-total Sharp Takes failed to revise onto their spread reads
// because alt rows already carried "Boston Red Sox -1.5" and "Atlanta
// Braves -1.5". The headline owns the market: void the redundant alt
// and let the caller retry the write once.
async function voidCollidingAltRow(game, payload) {
  try {
    let q = supabase
      .from('ai_suggestions')
      .select('id')
      .like('session_id', 'auto_digest_alt_%')
      .eq('bet_type', payload.bet_type)
      .eq('pick', payload.pick)
      .eq('actual_outcome', 'pending')
      .is('voided_at', null);
    q = game.odds_event_id
      ? q.eq('odds_event_id', game.odds_event_id)
      : q.eq('home_team', game.home_team).eq('away_team', game.away_team).eq('game_date', game.game_date);
    const { data } = await q.limit(1);
    const alt = data?.[0];
    if (!alt) return false;
    const { error } = await supabase
      .from('ai_suggestions')
      .update({
        voided_at: new Date().toISOString(),
        voided_reason: 'superseded: the headline pick moved onto this market',
      })
      .eq('id', alt.id);
    if (!error) console.log(`  🔁 Voided redundant alt row ${alt.id}: headline pick took its market`);
    return !error;
  } catch {
    return false;
  }
}

const UNIQUE_VIOLATION = '23505';

async function upsertDailySuggestion(game, payload, sessionId, { domain = 'pick' } = {}) {
  // Match by event id FIRST. Tennis re-emits matches with shifted start
  // times, and the team+game_date match below treats the re-emit as a new
  // game, publishing the same match twice (2026-08-12 ops finding: three
  // duplicate rows double counted the live record). The event id is
  // stable across reschedules, so an existing row for the same event in
  // the same domain gets revised, and its game_date follows the
  // reschedule so settlement matches the real instant.
  if (game.odds_event_id) {
    let evQuery = supabase
      .from('ai_suggestions')
      .select('id, actual_outcome, tier, tier_history')
      .like('session_id', 'auto_digest%')
      .eq('odds_event_id', game.odds_event_id);
    // Alt (spotlight) rows carry normal pick tiers, so the pick domain
    // must exclude their sessions or a spread spotlight would be revised
    // as if it were the headline pick. The alt domain matches only its
    // own sessions and its own bet type: a game can carry one spread AND
    // one total spotlight.
    evQuery = domain === 'alt'
      ? evQuery.like('session_id', 'auto_digest_alt_%').eq('bet_type', payload.bet_type)
      : evQuery.not('session_id', 'like', 'auto_digest_alt_%');
    evQuery = domain === 'trap' ? evQuery.eq('tier', 'Trap')
            : domain === 'leg' ? evQuery.eq('tier', 'Leg')
            : evQuery.or('tier.not.in.("Trap","Leg"),tier.is.null');
    const { data: evRows } = await evQuery
      .order('created_at', { ascending: false })
      .limit(1);
    const evExisting = evRows?.[0] || null;
    if (evExisting && evExisting.actual_outcome !== 'pending') {
      return { status: 'settled' };
    }
    if (evExisting) {
      const evHist = withTierHistory(evExisting.tier, evExisting.tier_history,
        historyEntry(payload.tier, payload.odds, payload.edge_pp));
      const evUpdate = () => supabase
        .from('ai_suggestions')
        .update({
          ...payload,
          ...(evHist ? { tier_history: evHist } : {}),
          game_date: game.game_date,
          odds_event_id: game.odds_event_id,
          last_revised_at: new Date().toISOString(),
        })
        .eq('id', evExisting.id);
      let { error } = await evUpdate();
      if (error && error.code === UNIQUE_VIOLATION && domain === 'pick'
          && await voidCollidingAltRow(game, payload)) {
        ({ error } = await evUpdate());
      }
      if (!error) await alertIfNewSharpTake(game, payload, evExisting);
      return { status: error ? 'error' : 'revised', error };
    }
  }

  let query = supabase
    .from('ai_suggestions')
    .select('id, actual_outcome, tier, tier_history')
    .like('session_id', 'auto_digest%')
    .eq('home_team', game.home_team)
    .eq('away_team', game.away_team)
    .eq('game_date', game.game_date);
  query = domain === 'alt'
    ? query.like('session_id', 'auto_digest_alt_%').eq('bet_type', payload.bet_type)
    : query.not('session_id', 'like', 'auto_digest_alt_%');
  query = domain === 'trap' ? query.eq('tier', 'Trap')
        : domain === 'leg' ? query.eq('tier', 'Leg')
        : query.or('tier.not.in.("Trap","Leg"),tier.is.null');
  const { data: existingRows } = await query
    .order('created_at', { ascending: false })
    .limit(1);
  const existing = existingRows?.[0] || null;

  if (existing && existing.actual_outcome !== 'pending') {
    return { status: 'settled' };
  }
  if (existing) {
    const hist = withTierHistory(existing.tier, existing.tier_history,
      historyEntry(payload.tier, payload.odds, payload.edge_pp));
    const doUpdate = () => supabase
      .from('ai_suggestions')
      .update({
        ...payload,
        ...(hist ? { tier_history: hist } : {}),
        odds_event_id: game.odds_event_id || null,
        last_revised_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    let { error } = await doUpdate();
    if (error && error.code === UNIQUE_VIOLATION && domain === 'pick'
        && await voidCollidingAltRow(game, payload)) {
      ({ error } = await doUpdate());
    }
    if (!error) await alertIfNewSharpTake(game, payload, existing);
    return { status: error ? 'error' : 'revised', error };
  }
  const doInsert = () => supabase
    .from('ai_suggestions')
    .insert({
      session_id: sessionId,
      home_team: game.home_team,
      away_team: game.away_team,
      game_date: game.game_date,
      odds_event_id: game.odds_event_id || null,
      actual_outcome: 'pending',
      ...payload,
      tier_history: payload.tier
        ? [historyEntry(payload.tier, payload.odds, payload.edge_pp)]
        : null,
    });
  let { error } = await doInsert();
  if (error && error.code === UNIQUE_VIOLATION && domain === 'pick'
      && await voidCollidingAltRow(game, payload)) {
    ({ error } = await doInsert());
  }
  if (!error) await alertIfNewSharpTake(game, payload, null);
  return { status: error ? 'error' : 'published', error };
}

// Map a published pick row back to its side key in the edges dict, so a
// re-analysis can price the row's OWN market, not just the newly
// recommended side.
function sideForPublishedRow(row, game) {
  if (row.bet_type === 'Total') {
    if (/^over\b/i.test(row.pick || '')) return 'over';
    if (/^under\b/i.test(row.pick || '')) return 'under';
    return null;
  }
  const onHome = row.pick && game.home_team && row.pick.includes(game.home_team);
  const onAway = row.pick && game.away_team && row.pick.includes(game.away_team);
  if (!onHome && !onAway) return null;
  if (row.bet_type === 'Spread') return onHome ? 'home_spread' : 'away_spread';
  return onHome ? 'home_ml' : 'away_ml';
}

/**
 * AUTO-DEMOTE: when a re-analysis finds NO side clearing the 2pp gate,
 * any still-pending published pick for the game must come down with it.
 * Before this existed, the publication block simply didn't run on a
 * gate failure, so a published pick kept its stale tier no matter what
 * the model now believed. That gap put 17 sub-gate picks into the graded
 * record during the tennis Elo incident (2026-08-30, they stand by owner
 * decision) and let two muted-market totals wear Sharp Take for an hour
 * on raw-band promotion day (2026-08-31).
 *
 * The demotion target is Lean: the ladder already defines Lean as the
 * published floor ("published picks whose calibrated pp fell under 2").
 * The row keeps its pick and price, gets the re-analyzed edge for its
 * own market when that can be resolved, and the round trip is recorded
 * in tier_history, so a pick that recovers its edge on a later pass
 * shows the full journey. Settled rows are never touched, and the trap
 * and leg domains are out of scope here.
 */
async function demoteStaleSuggestion(game, edgeData, sportDisplay) {
  try {
    let q = supabase
      .from('ai_suggestions')
      .select('id, tier, tier_history, bet_type, pick, odds, edge_pp')
      .like('session_id', 'auto_digest%')
      .not('session_id', 'like', 'auto_digest_alt_%')
      .eq('actual_outcome', 'pending')
      .is('voided_at', null)
      .or('tier.not.in.("Trap","Leg"),tier.is.null');
    q = game.odds_event_id
      ? q.eq('odds_event_id', game.odds_event_id)
      : q.eq('home_team', game.home_team).eq('away_team', game.away_team).eq('game_date', game.game_date);
    const { data } = await q.order('created_at', { ascending: false }).limit(1);
    const row = data?.[0];
    if (!row || row.tier === 'Lean') return;

    const side = sideForPublishedRow(row, game);
    const newEdge = side != null && edgeData?.edges?.[side] != null
      ? Math.round(edgeData.edges[side] * 1000) / 10 : null;
    const hist = withTierHistory(row.tier, row.tier_history,
      historyEntry('Lean', row.odds, newEdge != null ? newEdge : row.edge_pp));
    const { error } = await supabase
      .from('ai_suggestions')
      .update({
        tier: 'Lean',
        ...(newEdge != null ? { edge_pp: newEdge } : {}),
        ...(hist ? { tier_history: hist } : {}),
        last_revised_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (error) {
      console.warn(`  Auto-demote failed for ${game.game_key}: ${error.message}`);
    } else {
      console.log(`  ⬇️ Demoted ${row.tier} to Lean (${sportDisplay} ${row.pick}): re-analysis below the 2pp gate`);
    }
  } catch (e) {
    console.warn(`  Auto-demote exception for ${game.game_key}: ${e.message}`);
  }
}

// The tennis longshot fence's cleanup arm: a pending published pick at a
// fenced price (the line drifted out, or it published before the fence
// shipped) gets voided pre-lock, because the read is a price-dispersion
// artifact and should not exist at any tier. Settled rows are never
// touched.
async function voidFencedTennisRow(game) {
  try {
    let q = supabase
      .from('ai_suggestions')
      .select('id, pick, odds')
      .like('session_id', 'auto_digest%')
      .not('session_id', 'like', 'auto_digest_alt_%')
      .not('session_id', 'like', 'auto_digest_leg_%')
      .not('session_id', 'like', 'auto_digest_trap_%')
      .eq('actual_outcome', 'pending')
      .is('voided_at', null);
    q = game.odds_event_id
      ? q.eq('odds_event_id', game.odds_event_id)
      : q.eq('home_team', game.home_team).eq('away_team', game.away_team).eq('game_date', game.game_date);
    const { data } = await q.order('created_at', { ascending: false }).limit(1);
    const row = data?.[0];
    if (!row) return;
    const n = parseInt(String(row.odds), 10);
    if (!Number.isFinite(n) || n < 251) return;
    const { error } = await supabase
      .from('ai_suggestions')
      .update({
        voided_at: new Date().toISOString(),
        voided_reason: 'tennis longshot fence: market-only edges at +251 and lighter prices are cross-book price dispersion, not prediction',
      })
      .eq('id', row.id);
    if (!error) console.log(`  🚧 Voided fenced tennis longshot ${row.id} (${row.pick})`);
  } catch (e) {
    console.warn(`  Tennis fence void exception for ${game.game_key}: ${e.message}`);
  }
}

/**
 * Get relevant news snippets for a game's teams.
 *
 * Matches on the FULL team/player name (not last-word mascot) to prevent
 * cross-sport contamination. Previously `"Leylah Fernandez"` → `"Fernandez"`
 * matched unrelated Brooklyn Nets articles about assistant coach Fernandez.
 * Full-name matching may miss articles that use short forms (e.g., "Lakers"
 * alone instead of "Los Angeles Lakers"), but fewer false matches beats
 * hallucinated cross-sport context. Source-of-truth beats coverage.
 */
async function getNewsContext(homeTeam, awayTeam, sport) {
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    // Strip chars that break PostgREST filter syntax (commas, parens).
    // Apostrophes are fine, supabase-js URL-encodes them.
    const homeQuery = homeTeam.replace(/[(),]/g, '').trim();
    const awayQuery = awayTeam.replace(/[(),]/g, '').trim();
    if (!homeQuery || !awayQuery) return null;

    const { data } = await supabase
      .from('news_articles')
      .select('title, summary, betting_summary, content, published_at')
      .gte('published_at', threeDaysAgo)
      .or(`title.ilike.%${homeQuery}%,title.ilike.%${awayQuery}%,summary.ilike.%${homeQuery}%,summary.ilike.%${awayQuery}%`)
      .order('published_at', { ascending: false })
      // Deterministic tiebreaker. 37 percent of articles share a published_at
      // with another article, and without a secondary key Postgres returns
      // ties in planner-dependent order, so the top-5 set shuffled between
      // runs, churned the context hash, and re-narrated MLB for nothing.
      .order('id', { ascending: false })
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

    // Secondary source: rankings_cache (AP Top 25, adds rank for college teams).
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
async function analyzeGame(game, oddsCtx, newsCtx, injuryCtx, rankCtx, homeTrend, awayTrend, accuracy, playerStatsCtx, playbook = '', priorAnalysis = null, edgeData = null, mathPick = null, tennisCtx = null, pitcherCtx = null, narrationModel = null) {
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
  // made it into the prompt. The model was left with only the EdgeCalculator's
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

  if (homeTrend) contextParts.push(`${game.home_team} last ${homeTrend.games.length}: ${homeTrend.record} (${homeTrend.games.join('; ')})`);
  if (awayTrend) contextParts.push(`${game.away_team} last ${awayTrend.games.length}: ${awayTrend.record} (${awayTrend.games.join('; ')})`);

  // Tennis: rankings, recent results, workload, and H2H from the tennis
  // tables (sync-tennis-data cron). The team-sport context fetchers above
  // all read tables with no tennis rows, so without this block a tennis
  // prompt carried only odds and every card said "records not available".
  if (tennisCtx) contextParts.push(tennisCtx);

  // MLB: the probable starters are the single most game-specific fact on
  // the card. Without this line the narration fell back to team streaks.
  if (pitcherCtx) contextParts.push(`Probable starting pitchers: ${pitcherCtx}`);

  if (playerStatsCtx) contextParts.push(`Key player averages:\n${playerStatsCtx}`);
  if (injuryCtx) contextParts.push(`Injuries: ${injuryCtx}`);
  if (newsCtx) contextParts.push(`Recent news:\n${newsCtx}`);

  // Statistical edge block. Inject only when EdgeCalculator has REAL record/form data.
  // Sports without a stats source (Tennis, UFC, sometimes MLS) previously got the
  // calculator's no-data fallback (~53% / 47% defaults) surfaced as prompt input,
  // producing identical-looking "calculated win probability" numbers on every tile.
  //
  // Trimmed to a tight 2-line signal (math-edge conclusion + recent form) now that
  // the prompt already carries the actual season record from current_standings.
  // Intermediate math inputs (calculated win prob, implied prob, pt diff, schedule
  // strength, adjustments, last-20 record) removed. They were noise the model
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
    // largest positive edge. Anything < +2pp is market noise; ML picks
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
REFINEMENT CONTEXT: This is pass #${priorAnalysis.version + 1} on this game.
YOUR PRIOR ANALYSIS (${priorAnalysis.version === 1 ? 'initial' : 'pass #' + priorAnalysis.version}):
  Pick: ${priorAnalysis.prior_pick}
  Analysis: ${priorAnalysis.prior_snippet}
  (Edge score is computed from our model, not your judgment. Last pass: ${priorAnalysis.prior_edge}/10)

YOUR TASK: Compare the current data above to your prior analysis. What changed?
- New injury reports? Line movement? Recent game results?
- Did your recommended pick change? If so, why?
- Explain SPECIFICALLY what changed and why in the "what_changed" field.
- If nothing meaningful changed, keep your prior pick and note "No significant changes."
`;
  }

  // The pick is chosen by the math (edge-calculator.pickBestSide). The LLM's
  // job is to JUSTIFY that pick with specific data, not to override it. This
  // is the structural fix for the "LLM picks the wrong side because of
  // narrative" problem (e.g., OKC -10.5 picked over Lakers +10.5 despite a
  // +18pp model edge on the Lakers side).
  // Every verdict gets the SAME analytical depth. Skips and Traps used to be
  // told "2-3 sentences", which threw away research we'd already paid to
  // gather and made most tiles read thin (Vince: "we do the work and have
  // the data, so why wouldn't I have it on the site"). Only the verdict
  // framing differs between branches now, never the depth.
  const edgePpForPrompt = mathPick ? mathPick.signedEdge * 100 : null;
  const pickBlock = mathPick && edgePpForPrompt >= 2
    ? `\nOUR MODEL'S PICK (fixed, do not change):
  Side: ${mathPick.recommended_side}
  Pick text: ${mathPick.recommended_pick}
  Model edge: ${edgePpForPrompt.toFixed(1)}pp vs market
  Your job is to JUSTIFY this pick using the matchup data above. If the data
  contradicts the model's pick, say so honestly in the analysis (we'd rather
  catch a model mistake than confidently bullshit). Do NOT write a different
  pick. That's chosen by our math.\n`
    : mathPick && edgePpForPrompt < 0
    ? `\nOUR MODEL'S READ (display only, this is NOT a bet):
  Best available side: ${mathPick.recommended_pick} at ${edgePpForPrompt.toFixed(1)}pp, which is NEGATIVE.
  Every side of this game is priced worse than fair. This is a TRAP. Write
  the same full 3-5 sentence analysis of the matchup as you would for a
  pick, citing the records, form, and factors above, then explain why the
  market has this game priced tight or why the popular side is overvalued,
  and advise staying away. Never call it a pick.\n`
    : mathPick
    ? `\nOUR MODEL'S READ (display only, this is NOT a bet):
  Best available side: ${mathPick.recommended_pick} at ${edgePpForPrompt.toFixed(1)}pp, below our 2pp betting floor.
  This is a SKIP, but the reader still gets the full breakdown. Write the
  same full 3-5 sentence analysis of the matchup as you would for a pick,
  citing the records, form, and factors above, then say plainly that the
  market is priced about right and the value isn't there. Never call it a
  pick.\n`
    : `\nOUR MODEL HAS NO EDGE DATA on this game. Write the same full 3-5
  sentence analysis of the matchup as you would for any other game, citing
  the records, form, and factors above like an expert handicapper. Do not
  recommend a pick, do not mention edges, thresholds, or implied
  probabilities.\n`;

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
- NEVER name a tournament round or stage (final, semifinal, third-place match,
  quarterfinal) unless the matchup data or news above EXPLICITLY states it for
  THIS game. Calling a third-place playoff "the final" destroys credibility.
- ${WRITING_STYLE}

Respond in EXACTLY this JSON format (no markdown):
{
  "analysis": "3-5 sentence analysis citing specific records, scores, and matchup factors",
  "key_factors": ["factor1 with numbers", "factor2 with numbers", "factor3 with numbers"]${priorAnalysis ? ',\n  "what_changed": "Explain what changed since last analysis (injuries, line movement, new results)"' : ''}
}

Key factors MUST include specific numbers/records. Do NOT include recommended_pick, recommended_side, or edge_score. Those are determined by the math, not by you.`;

  try {
    const claude = getClaude();
    if (!claude) throw new Error('Server missing ANTHROPIC_API_KEY');

    // One retry on a malformed generation. On 2026-08-08 a single
    // unparseable response failed the Diamondbacks refresh, the old
    // analysis expired a minute later, and a +15pp Sharp Take fell off
    // the board with the next cron scheduled after first pitch. These
    // failures are transient, one more attempt is cheap insurance.
    // Cost tiering (owner decision 2026-08-19): audience-worthy tiles
    // (publishable picks, traps, possible legs) narrate on Sonnet, the
    // Skip and bubble tiles narrate on Haiku at a third of the price.
    const model = narrationModel || MODELS.NARRATION;
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const params = {
          model,
          // Sonnet narrations run 500-600 output tokens where gpt-4o-mini used
          // ~150-200. The old 600 cap truncated most responses mid-JSON, so
          // nearly every analysis parsed as null (broke the whole board 7/11).
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }],
        };
        // Narration only. The math already picked the side. Thinking stays
        // off to keep the per-game cost/latency profile of the old setup.
        // Haiku runs without a thinking param at all.
        if (model !== MODELS.UTILITY) params.thinking = { type: 'disabled' };
        const data = await claude.messages.create(params);

        const content = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        const usage = data.usage;

        if (!content) throw new Error('Empty response from Claude');
        if (data.stop_reason === 'max_tokens') throw new Error(`Response truncated at max_tokens (${usage?.output_tokens} tokens)`);

        const parsed = extractJson(content);
        if (!parsed || !parsed.analysis) throw new Error(`Unparseable model response: ${content.slice(0, 120)}`);

        // Pick is now math-derived. Return it alongside the LLM's analysis text.
        // LLM is no longer allowed to change recommended_pick / recommended_side.
        return {
          analysis_snippet: parsed.analysis,
          edge_score_llm_fallback: null,
          recommended_pick: mathPick ? mathPick.recommended_pick : null,
          recommended_side: mathPick ? mathPick.recommended_side : null,
          key_factors: parsed.key_factors,
          what_changed: parsed.what_changed || null,
          model_used: model,
          prompt_tokens: usage?.input_tokens,
          completion_tokens: usage?.output_tokens
        };
      } catch (err) {
        lastErr = err;
        if (attempt === 1) console.warn(`Narration attempt 1 failed for ${game.game_key}, retrying once: ${err.message}`);
      }
    }
    throw lastErr;
  } catch (err) {
    console.error(`AI analysis failed for ${game.game_key}:`, err.message);
    // Surface the real reason to the caller. cron_job_logs used to record
    // only "AI returned null", which hid a truncation bug for 12 hours.
    return { error: err.message };
  }
}

// All supported sports. Entries ending in '%' are prefix patterns resolved
// against odds_cache at query time (tennis tournament keys rotate weekly).
// Golf is deliberately absent: its markets are outright-winner fields, which
// don't fit the h2h edge model. Golf odds land in odds_cache for display,
// not for pre-analysis.
const ALL_SPORT_SLUGS = [
  'americanfootball_nfl', 'americanfootball_nfl_preseason',
  'basketball_nba', 'basketball_ncaab',
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
  'nfl': ['americanfootball_nfl', 'americanfootball_nfl_preseason'],
  'ncaaf': ['americanfootball_ncaaf'],
  'football': ['americanfootball_nfl', 'americanfootball_nfl_preseason', 'americanfootball_ncaaf'],
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

    // Started marker. A run that dies mid-flight (deploy restart, crash)
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
    // skip any later game for that team. They have to win the earlier one first.
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
      // Log the empty run. Bare returns left "started" rows with no
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
      .select('game_key, generated_at, stale, analysis_snippet, edge_score, analysis_version, recommended_pick, context_hash')
      .in('game_key', games.map(g => g.game_key));

    const existingKeys = new Set();
    const priorAnalysisMap = {};
    for (const ea of (existingAnalysis || [])) {
      const age = Date.now() - new Date(ea.generated_at).getTime();
      if (age < 3 * 60 * 60 * 1000 && !ea.stale) {
        existingKeys.add(ea.game_key); // Fresh, skip
      } else {
        // Stale, so store prior analysis for refinement
        priorAnalysisMap[ea.game_key] = {
          prior_snippet: ea.analysis_snippet,
          prior_edge: ea.edge_score,
          prior_pick: ea.recommended_pick,
          version: ea.analysis_version || 1,
          context_hash: ea.context_hash || null
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
    let skippedUnchanged = 0;
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

        // National-team tournaments must NEVER read club tables. "England"
        // is contained in "New England Revolution", and the bidirectional
        // name match fed the Revolution's MLS record into a World Cup
        // semifinal preview. News + web-verified intel only.
        const NATIONAL_TEAM_SPORTS = new Set(['World Cup', 'Euros', 'Copa America']);
        const nationalTeams = NATIONAL_TEAM_SPORTS.has(sportDisplay);
        // Player sports skip every team-sport fetcher: standings, injuries,
        // game_results, and player_game_stats have no rows for them, and
        // the surname-based mascot matching can only produce false
        // positives ("Fernandez" matching a Nets assistant coach). Their
        // context comes from the tennis/ufc tables instead.
        const isTennis = sportDisplay === 'Tennis';
        const isUfc = sportDisplay === 'UFC';
        const skipTeamCtx = nationalTeams || isTennis || isUfc;
        const emptyRankCtx = { home_rank: null, away_rank: null, home_record: null, away_record: null, home_streak: null, away_streak: null };

        // Fetch context in parallel: DB queries + news
        const [newsCtxRaw, injuryCtx, rankCtx, homeTrend, awayTrend, accuracy, playerStatsCtx, intelCtx, tennisData, pitcherCtx] = await Promise.all([
          getNewsContext(game.home_team, game.away_team, sportDisplay),
          skipTeamCtx ? null : getInjuryContext(game.home_team, game.away_team),
          skipTeamCtx ? Promise.resolve(emptyRankCtx) : getRankingsContext(game.home_team, game.away_team),
          skipTeamCtx ? null : getRecentResults(game.home_team, game.sport),
          skipTeamCtx ? null : getRecentResults(game.away_team, game.sport),
          getPastAccuracy(game.sport),
          skipTeamCtx ? null : getPlayerStatsContext(game.home_team, game.away_team, game.sport),
          // Web-verified injuries/weather/record warnings from the data
          // integrity agent (empty string when no fresh intel exists).
          getIntelContext(supabase, game.home_team, game.away_team),
          isTennis ? getTennisContext(supabase, game.home_team, game.away_team)
            : isUfc ? getUfcContext(supabase, game.home_team, game.away_team)
            : null,
          // MLB only: probable starters from ESPN's scoreboard. Fail-soft,
          // one cached fetch covers the whole slate.
          sportDisplay === 'MLB' ? getProbablePitchersText(game.home_team, game.away_team) : null
        ]);
        const newsCtx = `${newsCtxRaw || ''}${intelCtx || ''}` || null;
        const tennisCtx = isTennis ? formatTennisContext(tennisData)
          : isUfc ? formatUfcContext(tennisData)
          : null;
        if (isTennis) {
          // Surface tour rank and 30-day match record through the standard
          // rank/record storage fields so tiles and the digest show them.
          // The prompt gets the precise wording via tennisCtx, so the
          // "season record" prompt lines stay suppressed (rankCtx records
          // stay null until after analyzeGame runs).
          if (tennisData?.home?.rank != null) rankCtx.home_rank = tennisData.home.rank;
          if (tennisData?.away?.rank != null) rankCtx.away_rank = tennisData.away.rank;
        }

        // Get prior analysis for refinement loop
        const prior = priorAnalysisMap[game.game_key] || null;
        if (prior) {
          console.log(`  🔄 Refinement pass #${prior.version + 1} for ${game.game_key} (prior edge: ${prior.prior_edge}/10)`);
        }

        // Calculate statistical edge BEFORE passing to AI. Team sports use
        // the core calculator. Tennis, UFC, and the soccer family use their
        // dedicated models (docs/models/), market-consensus based and in
        // shadow mode until calibrated.
        let edgeData = null;
        try {
          if (sportDisplay === 'Tennis') {
            // Both halves of the model's design are wired as of 2026-08-25:
            // the Elo ratings provider (seeded from official points, replayed
            // over stored results) and the Tennis:ml calibration multiplier.
            // Before this, production ran market-consensus only, which
            // structurally capped tennis edges near 4pp and made Sharp Takes
            // impossible.
            edgeData = await tennisModel.calculateTennisEdge({
              home_team: game.home_team,
              away_team: game.away_team,
              books: tennisModel.booksFromOddsRows(game.h2hRows || [], game.home_team, game.away_team),
              best_of: BO5_TENNIS_KEYS.has(game.sport) ? 5 : 3,
              tour: String(game.sport || '').startsWith('tennis_wta') ? 'wta' : 'atp'
            }, {
              ratings: tennisRatingsProvider,
              // Elo blend weight ZERO (2026-08-26, first live day): the
              // point-seeded ratings compress most of a slam draw into a
              // ~150 Elo band, so every mid-tier matchup read as a coin
              // flip against a 90/10 market and the model published 20
              // straight underdogs with fabricated 4-10pp edges (Dzumhur
              // +900 at 10pp, Elo 62/38 on a match priced 94/6). Ranking
              // points measure twelve months of activity, not strength.
              // The market-consensus half stays live (shadow-validated,
              // 79.3 actual vs 76.9 implied). The ratings provider still
              // runs so its reads keep logging in edge_factors.elo, and
              // the weight returns only after the ratings pass offline
              // validation against stored match results and prices.
              eloWeight: 0,
              calibrationMultiplier: await getTennisCalibrationMultiplier(supabase)
            });
          } else if (sportDisplay === 'UFC') {
            edgeData = await ufcModel.computeUfcEdge({
              home_team: game.home_team,
              away_team: game.away_team,
              books: game.h2hRows || [],
              markets: game.markets
            }, {
              calibrationMultiplier: await getCalibrationMultiplier(supabase, ['UFC:ml', 'UFC'])
            });
          } else if (SOCCER_1X2_SPORTS.has(sportDisplay)) {
            // The soccer family prices three-way 1X2 with the draw as its
            // own side. This branch used to test SHADOW_SPORTS, which
            // silently routed NFL and NCAAF preseason (added to the shadow
            // set 2026-08-10) through the soccer model: no raw edges
            // stored, so market_shadow_calibration had zero football rows
            // to seed go-live k from. Model routing and publication
            // shadowing are different questions; football belongs to the
            // core team calculator below, shadow or not.
            edgeData = soccer1x2.calculateSoccer1x2Edges({
              homeTeam: game.home_team,
              awayTeam: game.away_team,
              books: soccer1x2.fromOddsCacheRows(game.h2hRows || [], game.home_team, game.away_team)
            });
          } else {
            edgeData = await edgeCalc.calculateEdge(game);
          }
          if (edgeData) {
            // Second calibration layer: per-band mapping fit on PUBLISHED
            // outcomes (edge_band_calibration, refit weekly). Positive
            // edges shrink toward what their band actually delivers,
            // negative edges (trap reads) pass through raw. Applied here,
            // before side selection and tiering, so board tiles, math
            // picks, and the published record all speak calibrated pp.
            edgeData = await bandCalibration.applyToEdgeData(edgeData, sportDisplay);
            const edgeSign = edgeData.edge !== null ? (edgeData.edge >= 0 ? '+' : '') + (edgeData.edge * 100).toFixed(1) + '%' : 'N/A';
            console.log(`  📐 Edge: ${edgeSign} on ${edgeData.edgeSide || '?'} (${edgeData.confidence}), home ${(edgeData.homeWinProb * 100).toFixed(1)}% vs implied ${edgeData.impliedHomeProb !== null ? (edgeData.impliedHomeProb * 100).toFixed(1) + '%' : 'N/A'}`);
          }
        } catch (edgeErr) {
          console.warn(`  Edge calc failed for ${game.game_key}: ${edgeErr.message}`);
        }

        // MATH PICKS, LLM NARRATES: choose side+market from per-side edges,
        // then ask the LLM only to justify it. The previous flow let the LLM
        // pick its own side, which broke when narrative ("5-game win streak")
        // overruled the per-side edge data (e.g., OKC -10.5 chosen over the
        // +18pp Lakers +10.5 cover edge).
        let mathPick = null;
        // No minimum edge for DISPLAY: a negative best side is a Trap read,
        // 0-2pp is a Skip. The board shows what the math sees either way
        // (Vince: "just because there might not be sharp takes doesn't mean
        // we shouldn't show what we have"). The RECORD gate stays at 2pp in
        // the auto-save below, and SHADOW_SPORTS never reach the record at
        // all. Three-way soccer results carry a draw side the core picker
        // does not know, so they use the 1X2 picker.
        const bestSide = edgeData
          ? (edgeData.edges && 'draw' in edgeData.edges
              ? soccer1x2.pickBest1x2Side(edgeData, { minEdgePp: -100 })
              : edgeCalc.pickBestSide(edgeData, { minEdgePp: -100 }))
          : null;
        // Trap detection runs independent of pick selection: a Trap is a
        // side the casual bettor is drawn to (lure score from chalk,
        // streaks, home lean, juicy-dog pricing, popular Overs) that the
        // model prices at -2pp or worse. The mere inverse of a pick is NOT
        // a trap and no longer gets a callout. See lib/services/trap-detector.js.
        const trapCalls = trapDetector.detectTraps({
          edgeData, oddsCtx, game, sport: sportDisplay, rankCtx
        });
        if (trapCalls.length > 0) {
          const t = trapCalls[0];
          console.log(`  🪤 Trap detected: ${t.side} lure ${t.lure_score} at ${t.edge_pp}pp (${t.signals.map(s => s.key).join(', ')})`);
        }

        // Directional read selection. An actionable pick is the BEST side
        // at +2pp or better. When no side clears that bar, the strongest
        // DETECTED trap becomes the read: it names the side you should not
        // bet, so grading the fade is honest. A negative side with no lure
        // is a Skip like any other noise, not a trap read. Before
        // 2026-07-24 the trap read was just the most negative side, which
        // made every trap the mirror of the board's math.
        let readSide = bestSide;
        if (bestSide && bestSide.signedEdge * 100 < 2 && trapCalls.length > 0) {
          readSide = { side: trapCalls[0].side, signedEdge: trapCalls[0].edge_pp / 100 };
        }
        if (readSide) {
          const pickText = readSide.side === 'draw'
            ? buildDrawPickText(game)
            : buildPickText(readSide.side, oddsCtx, game);
          if (pickText) {
            mathPick = {
              recommended_side: readSide.side,
              recommended_pick: pickText,
              signedEdge: readSide.signedEdge,
            };
            const kind = readSide.signedEdge * 100 <= -2 ? 'Trap read' : 'Math pick';
            console.log(`  🎯 ${kind}: ${pickText} (${readSide.side}, edge ${(readSide.signedEdge * 100).toFixed(1)}pp)`);
          }
        } else {
          console.log(`  ⚪ No-edge game, every market < +2pp`);
        }

        // CHANGE GATE (August cost audit): a game past the 3h staleness
        // window whose inputs are byte-identical to the last narration gets
        // its expiry extended instead of a fresh Claude call. The hash
        // covers everything the prompt is built from: odds, records, news
        // and intel, trends, player stats, the computed edge, the math
        // pick, and trap calls. Any line move, injury note, or intel row
        // changes the hash and the game re-analyzes as before. Grading
        // meta (accuracy) and the playbook are deliberately excluded.
        const contextHash = crypto.createHash('sha256').update(JSON.stringify({
          odds: [oddsCtx.spread, oddsCtx.total, oddsCtx.ml_home, oddsCtx.ml_away],
          rank: rankCtx,
          news: newsCtx,
          injuries: injuryCtx,
          trends: [homeTrend, awayTrend],
          stats: playerStatsCtx,
          tennis: tennisCtx,
          // A probables CHANGE (late scratch, new announcement) must force
          // a fresh narration, so the hash carries the pitcher NAMES. It
          // must NOT carry the (W-L, ERA) stat notes: ESPN updates those
          // continuously, including live during games, and hashing them
          // kept the MLB change gate at zero skips for a week (the ops
          // checks' tenth-report finding, prime suspect confirmed). The
          // prompt still gets the full text with stats.
          pitchers: pitcherCtx ? pitcherCtx.replace(/\s*\([^)]*\)/g, '') : null,
          edge: edgeData ? {
            edge: edgeData.edge, side: edgeData.edgeSide,
            home: edgeData.homeWinProb, implied: edgeData.impliedHomeProb
          } : null,
          pick: mathPick ? [mathPick.recommended_side, mathPick.recommended_pick] : null,
          traps: trapCalls.map(t => [t.side, t.edge_pp, t.lure_score]),
        })).digest('hex');

        if (prior && prior.context_hash && prior.context_hash === contextHash && prior.prior_snippet) {
          await supabase
            .from('game_analysis')
            .update({
              expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
              stale: false,
            })
            .eq('game_key', game.game_key);
          skippedUnchanged++;
          console.log(`  ⏩ Inputs unchanged since v${prior.version}, expiry extended, no model call (${game.game_key})`);
          continue;
        }

        // Model tiering by audience (owner decision 2026-08-19, cost).
        // Sonnet narrates anything a bettor acts on: a publishable pick
        // (pre-band 2pp+), a trap call, or a possible leg (65%+ side).
        // Skip and bubble tiles, most of a full tennis draw, narrate on
        // Haiku at roughly a third of the price.
        const audienceWorthy =
          (mathPick && ((edgeData?.edgesPreBand?.[mathPick.recommended_side] ?? mathPick.signedEdge) || 0) * 100 >= 2)
          || trapCalls.length > 0
          || (edgeData?.homeWinProb >= 0.65 || edgeData?.awayWinProb >= 0.65);
        const narrationModel = audienceWorthy ? MODELS.NARRATION : MODELS.UTILITY;

        const result = await analyzeGame(game, oddsCtx, newsCtx, injuryCtx, rankCtx, homeTrend, awayTrend, accuracy, playerStatsCtx, playbook, prior, edgeData, mathPick, tennisCtx, pitcherCtx, narrationModel);

        // After the prompt is built: expose the tennis 30-day match record
        // through the stored record fields (tiles/digest), without letting
        // the prompt mislabel it as a season record. The prompt already got
        // the precisely-worded version inside tennisCtx.
        if (isTennis) {
          if (tennisData?.home?.record30d) rankCtx.home_record = tennisData.home.record30d;
          if (tennisData?.away?.record30d) rankCtx.away_record = tennisData.away.record30d;
        }

        if (!result || result.error) {
          const reason = result?.error || 'AI returned null';
          console.warn(`  ⚠️ analyzeGame failed for ${game.game_key}: ${reason}`);
          errors.push(`${game.game_key}: ${reason}`);
          // A failed refresh must never take a live game off the board.
          // Keep the last good analysis visible for another 3 hours and
          // mark it stale so every later run keeps trying to replace it.
          // Without this, the Aug 8 Diamondbacks Sharp Take vanished 25
          // minutes after one flaky generation.
          if (prior) {
            await supabase
              .from('game_analysis')
              .update({
                expires_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
                stale: true,
              })
              .eq('game_key', game.game_key);
          }
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
            // lock payload reads this. It must never fall back to a made-up
            // -110, the ledger records it.
            recommended_odds: result.recommended_side === 'draw'
              ? drawPrice(game)
              : resolveOddsForPick(oddsCtx, result.recommended_side) ?? null,
            key_factors: result.key_factors,
            news_context: newsCtx,
            injury_context: injuryCtx,
            model_used: result.model_used || MODELS.NARRATION,
            prompt_tokens: result.prompt_tokens,
            completion_tokens: result.completion_tokens,
            generated_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
            stale: false,
            context_hash: contextHash,
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
            // Same dict before the ±15pp cap. Calibration needs the raw signal.
            edges_raw: edgeData ? edgeData.edgesRaw : null,
            // Merge factors + adjustments + confidence into edge_factors so the
            // fact sheet's edge.adjustments[] path resolves. Calculator returns
            // them as separate top-level keys on edgeData, so flatten for storage.
            edge_factors: edgeData ? {
              ...edgeData.factors,
              adjustments: edgeData.adjustments || [],
              confidence: edgeData.confidence || null
            } : null,
            // Detector-qualified traps (lure >= threshold AND <= -2pp),
            // strongest first. The board renders these as their own tiles,
            // independent of the pick.
            trap_calls: trapCalls.length > 0 ? trapCalls : null
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

            // Publication. Picks (>= +2pp) and traps (detector calls at
            // <= -2pp with real lure) publish INDEPENDENTLY: a game can
            // carry both a pick on one side and a trap on another, and
            // 40 straight MLB trap calls died unpublished between 7/23 and
            // 8/2 because the trap only published when it was the game's
            // ONLY read. Only Skip (the -2 to +2 noise band) stays
            // display-only: it carries no read in either direction.
            const displayEdgePp = edgeData?.edges?.[result.recommended_side] != null
              ? edgeData.edges[result.recommended_side] * 100 : null;
            // The publish gate binds on the PRE-band-calibration edge so the
            // calibration layer relabels picks without shrinking publication
            // (owner 2026-08-16: everything graded keeps publishing, it
            // costs nothing and users get the research). Tier still comes
            // from the calibrated pp below.
            const gateEdgePp = edgeData?.edgesPreBand?.[result.recommended_side] != null
              ? edgeData.edgesPreBand[result.recommended_side] * 100 : displayEdgePp;
            if (SHADOW_SPORTS.has(sportDisplay)) {
              // Shadow mode: the board shows the read and game_analysis
              // stores the edges for calibration measurement, but nothing
              // reaches the graded record until the model proves out.
              if (displayEdgePp != null) {
                console.log(`  👻 Shadow (${sportDisplay}): ${displayEdgePp.toFixed(1)}pp stored, no pick published`);
              }
            } else {
              // THE TENNIS LONGSHOT FENCE (owner-era data, 2026-09-01): a
              // market-only model's "edge" on a +251-or-lighter-priced side
              // can only come from one book's outlier price against the
              // consensus, which is line-shopping dispersion, not
              // prediction, and it is largest exactly at long odds. Since
              // the 1.0 multiplier went live (2026-08-25) that bucket went
              // 1-19 against a 14 percent implied price for -15.6u,
              // including 1-14 for -10.6u AFTER Elo was zeroed, so it is
              // the mechanism, not a leftover of the Elo incident. Fenced
              // picks never publish, and a pending row that drifted past
              // the fence price gets voided, not demoted: the read should
              // not exist at any tier.
              const TENNIS_LONGSHOT_FENCE = 251;
              const tennisFenced = (() => {
                if (sportDisplay !== 'Tennis' || !result.recommended_side) return false;
                const n = parseInt(String(resolveOddsForPick(oddsCtx, result.recommended_side)), 10);
                return Number.isFinite(n) && n >= TENNIS_LONGSHOT_FENCE;
              })();
              if (result.recommended_pick && gateEdgePp != null && gateEdgePp >= 2 && !tennisFenced) {
              try {
                const side = result.recommended_side;
                const { betType, point } = deriveBetTypeAndPoint(side, oddsCtx);
                const pickOdds = formatAmericanOdds(resolveOddsForPick(oddsCtx, result.recommended_side));

                // Snapshot the edge that justified this pick. The analysis
                // cache gets regenerated, so the pick row must carry its own
                // pp/tier or win-rate-by-edge analysis becomes unprovable.
                const sideEdge = edgeData?.edges?.[side] ?? null;
                const sideEdgeRaw = edgeData?.edgesRaw?.[side] ?? sideEdge;
                const edgePp = sideEdge != null ? Math.round(sideEdge * 1000) / 10 : null;
                const isHomeMl = side === 'home_ml';
                const isAwayMl = side === 'away_ml';

                // Calibrated pp under 2 would grade Skip, but this row
                // cleared the pre-band gate, so it publishes at the
                // ladder floor instead of wearing a non-published label.
                let pickTier = (() => {
                  const t = pickGrader.edgeTier(edgePp, pickOdds);
                  return t === 'Skip' ? 'Lean' : t;
                })();
                let pickReasoning = result.analysis_snippet;
                // Same-team moneyline claims are the same opinion resampled,
                // so a team on a graded losing streak this week costs the
                // claim one rung until it cashes (exposure-guard.js).
                if (betType === 'Moneyline' && (isHomeMl || isAwayMl)) {
                  const guard = await applyExposureGuard(supabase, {
                    sport: sportDisplay,
                    team: isHomeMl ? game.home_team : game.away_team,
                    tier: pickTier,
                  });
                  if (guard.demoted) {
                    console.log(`  🛑 ${guard.reason}`);
                    pickTier = guard.tier;
                    pickReasoning = pickReasoning ? `${pickReasoning} ${guard.reason}` : guard.reason;
                  }
                }

                const sessionId = `auto_digest_${siteDay()}`;
                const pickPayload = {
                  sport: sportDisplay,
                  bet_type: betType,
                  pick: result.recommended_pick,
                  point: point,
                  odds: pickOdds,
                  confidence: Math.round(result.edge_score),
                  reasoning: pickReasoning,
                  risk_level: result.edge_score >= 8 ? 'Low' : 'Medium',
                  generate_mode: 'auto_digest',
                  // 7 = market-anchored base regime (2026-09-02, owner
                  // rule: the consensus price is the likelihood estimate
                  // in every sport, the model's claim is the factor stack
                  // arguing off it). 6 was the calibrated devig regime.
                  // Calibration fits key off the regime boundary date so
                  // old-regime claims never grade new-regime labels.
                  pipeline_version: 7,
                  edge_pp: edgePp,
                  edge_pp_raw: sideEdgeRaw != null ? Math.round(sideEdgeRaw * 1000) / 10 : null,
                  tier: pickTier,
                  model_prob: isHomeMl ? edgeData?.homeWinProb ?? null
                            : isAwayMl ? edgeData?.awayWinProb ?? null : null,
                  implied_prob: isHomeMl ? edgeData?.impliedHomeProb ?? null
                              : isAwayMl ? edgeData?.impliedAwayProb ?? null : null,
                  // Trap rows carry their lure evidence so the trap record
                  // can later be analyzed by signal, not just by edge.
                  lure_score: (() => {
                    const t = trapCalls.find(t => t.side === side);
                    return t ? t.lure_score : null;
                  })(),
                  trap_signals: (() => {
                    const t = trapCalls.find(t => t.side === side);
                    return t ? t.signals : null;
                  })(),
                };

                const saved = await upsertDailySuggestion(game, pickPayload, sessionId, { domain: 'pick' });
                if (saved.status === 'settled') {
                  console.log(`  Pick already settled for ${game.game_key}, not revising`);
                } else if (saved.error) {
                  console.warn(`  Auto-save pick result: ${saved.error.message}`);
                } else {
                  console.log(`  ${saved.status === 'revised' ? '✏️ Revised' : '✅ Published'} pick: ${result.recommended_pick} (${sportDisplay})`);
                }
              } catch (e) {
                console.error(`  ❌ Auto-save exception: ${e.message}`);
              }
              } else if (tennisFenced) {
                console.log(`  🚧 Tennis longshot fence: ${result.recommended_pick} not published`);
                await voidFencedTennisRow(game);
              } else {
                // No side clears the gate: any published pending pick for
                // this game comes down to the Lean floor with it.
                await demoteStaleSuggestion(game, edgeData, sportDisplay);
              }

              // Trap publication, independent of the pick above. The
              // strongest detector call publishes to its own domain
              // (session auto_digest_trap_, tier Trap) so the Trap Record
              // grades live even when the same game also has a pick.
              if (trapCalls.length > 0) {
                try {
                  const t = trapCalls[0];
                  const tPickText = t.side === 'draw'
                    ? buildDrawPickText(game)
                    : buildPickText(t.side, oddsCtx, game);
                  const tOddsRaw = t.side === 'draw'
                    ? drawPrice(game)
                    : resolveOddsForPick(oddsCtx, t.side);
                  const tEdge = edgeData?.edges?.[t.side]
                    ?? (t.edge_pp != null ? t.edge_pp / 100 : null);
                  const tEdgeRaw = edgeData?.edgesRaw?.[t.side] ?? tEdge;
                  const tEdgePp = tEdge != null ? Math.round(tEdge * 1000) / 10 : null;
                  const tTier = pickGrader.edgeTier(tEdgePp);

                  if (tPickText && tEdgePp != null && tTier === 'Trap') {
                    const { betType, point } = deriveBetTypeAndPoint(t.side, oddsCtx);
                    const trapPayload = {
                      sport: sportDisplay,
                      bet_type: betType,
                      pick: tPickText,
                      point: point,
                      odds: formatAmericanOdds(tOddsRaw),
                      confidence: Math.min(10, Math.max(1, Math.round(Math.abs(tEdgePp)))),
                      reasoning: `Trap call: ${tPickText} is the bait (lure ${t.lure_score}: ${(t.signals || []).map(s => s.key).join(', ')}). ${result.analysis_snippet || ''}`.trim(),
                      risk_level: 'Medium',
                      generate_mode: 'auto_digest',
                      pipeline_version: 6,
                      edge_pp: tEdgePp,
                      edge_pp_raw: tEdgeRaw != null ? Math.round(tEdgeRaw * 1000) / 10 : null,
                      tier: tTier,
                      model_prob: t.side === 'home_ml' ? edgeData?.homeWinProb ?? null
                                : t.side === 'away_ml' ? edgeData?.awayWinProb ?? null : null,
                      implied_prob: t.side === 'home_ml' ? edgeData?.impliedHomeProb ?? null
                                  : t.side === 'away_ml' ? edgeData?.impliedAwayProb ?? null : null,
                      lure_score: t.lure_score,
                      trap_signals: t.signals || null,
                    };
                    const trapSessionId = `auto_digest_trap_${siteDay()}`;
                    const saved = await upsertDailySuggestion(game, trapPayload, trapSessionId, { domain: 'trap' });
                    if (saved.status === 'settled') {
                      console.log(`  Trap already settled for ${game.game_key}, not revising`);
                    } else if (saved.error) {
                      console.warn(`  Trap-save result: ${saved.error.message}`);
                    } else {
                      console.log(`  ${saved.status === 'revised' ? '✏️ Revised' : '🪤 Published'} trap: ${tPickText} (${sportDisplay}, ${tEdgePp}pp)`);
                    }
                  }
                } catch (e) {
                  console.error(`  ❌ Trap-save exception: ${e.message}`);
                }
              }

              // Spotlight lane (owner approved 2026-08-24): a spread or
              // total whose PRE-band edge clears the same 2pp gate as the
              // headline publishes as its own graded row in its own
              // session domain, instead of living unseen in the market
              // tabs whenever the moneyline edge is bigger. Grades under
              // its bet type, seeds spread and total calibration with
              // real published samples, and rides the tier-entry alerts.
              try {
                const altSides = chooseAltMarkets(edgeData?.edgesPreBand, result.recommended_side);
                for (const alt of altSides) {
                  const altText = buildPickText(alt.side, oddsCtx, game);
                  const altOddsRaw = resolveOddsForPick(oddsCtx, alt.side);
                  const altEdge = edgeData?.edges?.[alt.side];
                  if (!altText || altOddsRaw == null || altEdge == null) continue;
                  const altEdgeRaw = edgeData?.edgesRaw?.[alt.side] ?? altEdge;
                  const altPp = Math.round(altEdge * 1000) / 10;
                  const { betType, point } = deriveBetTypeAndPoint(alt.side, oddsCtx);
                  const altOdds = formatAmericanOdds(altOddsRaw);
                  const altTier = (() => {
                    const t = pickGrader.edgeTier(altPp, altOdds);
                    return t === 'Skip' ? 'Lean' : t;
                  })();
                  const altPayload = {
                    sport: sportDisplay,
                    bet_type: betType,
                    pick: altText,
                    point,
                    odds: altOdds,
                    confidence: Math.min(10, Math.max(1, Math.round(altPp))),
                    reasoning: `${betType} spotlight: this market cleared the publish gate on its own, independent of the headline read. ${result.analysis_snippet || ''}`.trim(),
                    risk_level: altPp >= 8 ? 'Low' : 'Medium',
                    generate_mode: 'auto_digest',
                    pipeline_version: 6,
                    edge_pp: altPp,
                    edge_pp_raw: altEdgeRaw != null ? Math.round(altEdgeRaw * 1000) / 10 : null,
                    tier: altTier,
                    model_prob: null,
                    implied_prob: null,
                    lure_score: null,
                    trap_signals: null,
                  };
                  const altSid = altSessionId(betType, siteDay());
                  const savedAlt = await upsertDailySuggestion(game, altPayload, altSid, { domain: 'alt' });
                  if (savedAlt.status === 'settled') {
                    console.log(`  ${betType} spotlight already settled for ${game.game_key}, not revising`);
                  } else if (savedAlt.error) {
                    console.warn(`  ${betType} spotlight save result: ${savedAlt.error.message}`);
                  } else {
                    console.log(`  ${savedAlt.status === 'revised' ? '✏️ Revised' : '🎯 Published'} ${betType.toLowerCase()} spotlight: ${altText} (${sportDisplay}, ${altPp}pp)`);
                  }
                }
              } catch (e) {
                console.error(`  ❌ Spotlight-save exception: ${e.message}`);
              }

              // Leg tracking: high percent to hit, bad payout, only a leg.
              // A Skip game's short-priced favorite never published
              // anywhere, so its hits were invisible to calibration and
              // unavailable to the parlay builder. When the model makes
              // one side very likely to WIN but the game has no betting
              // edge, that side publishes as tier Leg in its own domain:
              // never in the pick record, graded on its own line, and a
              // backfill pool for machine parlays.
              //
              // Floor at 65%: books cap MLB favorites around -250 (71%
              // implied) and a full slate's strongest no-pick favorite
              // often sits in the mid-60s, so a 70% floor produced zero
              // legs across entire MLB slates. 65% is about -186, still a
              // genuinely heavy favorite in any sport.
              const LEG_PROB_FLOOR = 0.65;
              // Owner clarification 2026-08-25: a Leg means a GIMME, the
              // model's own 65%-plus read, and the label does not loosen
              // in rebuild weeks. The quiet-day content problem is solved
              // in the Discord morning board instead, which lists heavy
              // market favorites the model agrees with as presentation
              // only (never published, never graded). A briefly-live
              // market-anchored second path (implied 60% + raw agreement)
              // was reverted the same day at owner direction.
              // Same pre-band gate as publication, so the pick-vs-leg split
              // is unchanged by the calibration layer. (mathPick carries
              // recommended_side; an earlier version read a nonexistent
              // .side key and silently fell back to the calibrated edge.)
              const publishedPick = mathPick && (
                (edgeData?.edgesPreBand?.[mathPick.recommended_side] ?? mathPick.signedEdge) * 100 >= 2
              );
              // Owner rule 2026-08-31: non-UFC MMA cards never enter the
              // leg pool. The MMA odds feed carries every promotion, ESPN
              // results cover UFC-brand events only, so a leg on any other
              // card has no settlement path and dies in the 3-day
              // auto-void (ids 16640, 16861).
              const legEligible = !publishedPick && edgeData
                && edgeData.homeWinProb != null && edgeData.awayWinProb != null
                && (sportDisplay !== 'UFC'
                  || await isKnownUfcBout(supabase, game.home_team, game.away_team));
              if (!legEligible && !publishedPick && sportDisplay === 'UFC' && edgeData) {
                console.log(`  Leg skipped for ${game.game_key}: not a settleable UFC-brand bout`);
              }
              if (legEligible) {
                try {
                  const legSide = edgeData.homeWinProb >= edgeData.awayWinProb ? 'home_ml' : 'away_ml';
                  const legProb = Math.max(edgeData.homeWinProb, edgeData.awayWinProb);
                  const legEdge = edgeData?.edges?.[legSide] ?? null;
                  const legIsTrapSide = trapCalls.some(t => t.side === legSide);
                  if (legProb >= LEG_PROB_FLOOR && !legIsTrapSide && legEdge != null && legEdge * 100 > -2) {
                    const legText = buildPickText(legSide, oddsCtx, game);
                    const legOdds = resolveOddsForPick(oddsCtx, legSide);
                    if (legText && legOdds != null) {
                      const legEdgeRaw = edgeData?.edgesRaw?.[legSide] ?? legEdge;
                      const legPayload = {
                        sport: sportDisplay,
                        bet_type: 'Moneyline',
                        pick: legText,
                        point: null,
                        odds: formatAmericanOdds(legOdds),
                        confidence: Math.min(10, Math.round(legProb * 10)),
                        reasoning: `Leg: ${legText} grades ${(legProb * 100).toFixed(0)}% to hit but carries no betting value at the price. High hit probability, thin payout. Tracked as a parlay leg, never a pick.`,
                        risk_level: 'Low',
                        generate_mode: 'auto_digest',
                        pipeline_version: 6,
                        edge_pp: Math.round(legEdge * 1000) / 10,
                        edge_pp_raw: legEdgeRaw != null ? Math.round(legEdgeRaw * 1000) / 10 : null,
                        tier: 'Leg',
                        model_prob: legSide === 'home_ml' ? edgeData.homeWinProb : edgeData.awayWinProb,
                        implied_prob: legSide === 'home_ml' ? edgeData.impliedHomeProb ?? null : edgeData.impliedAwayProb ?? null,
                        lure_score: null,
                        trap_signals: null,
                      };
                      const legSessionId = `auto_digest_leg_${siteDay()}`;
                      const saved = await upsertDailySuggestion(game, legPayload, legSessionId, { domain: 'leg' });
                      if (saved.status === 'settled') {
                        console.log(`  Leg already settled for ${game.game_key}, not revising`);
                      } else if (saved.error) {
                        console.warn(`  Leg-save result: ${saved.error.message}`);
                      } else {
                        console.log(`  ${saved.status === 'revised' ? '✏️ Revised' : '🦵 Published'} leg: ${legText} (${(legProb * 100).toFixed(0)}% to hit)`);
                      }
                    }
                  }
                } catch (e) {
                  console.error(`  ❌ Leg-save exception: ${e.message}`);
                }
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
        // Deduped exactly like the started row at the top of the run:
        // the NFL job sweeps two slugs that both map to NFL, and the
        // undeduped terminal name pre-analyze-NFL-NFL never paired with
        // its started row, reading as hung runs in every ops check.
        job_name: `pre-analyze-${[...new Set(sportSlugs.map(s => slugToSport(s)))].join('-')}`,
        status: errors.length === 0 ? 'completed' : 'partial',
        details: JSON.stringify({
          games_found: games.length,
          games_to_analyze: gamesToAnalyze.length,
          batch_size: batch.length,
          existing_fresh: existingKeys.size,
          analyzed,
          skipped_unchanged: skippedUnchanged,
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
