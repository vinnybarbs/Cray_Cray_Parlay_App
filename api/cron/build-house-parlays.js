/**
 * Cron: Build the house parlays for today
 *
 * Runs after pre-analyze-games has published the daily auto digest picks.
 * Takes the strongest +EV legs from today's digest and publishes up to two
 * machine built parlays into house_parlays. One 2 leg and one 3 leg.
 * Idempotent. A parlay already published for today is never overwritten.
 */

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../../shared/logger');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Minimum CALIBRATED edge in percentage points for a pick to qualify.
// Was 4 ("Play tier or better") on the old claimed scale, but edge_pp
// stores band-calibrated values since 2026-08-16 and calibrated 4 is a
// genuinely strong claim now: the bar left the pool at roughly one pick
// a day and starved the 3-leg build (Aug 17 never built one). Every
// published pick (calibrated 2+, Lean floor) qualifies, the sort still
// puts the strongest first, and Legs backfill below picks as before.
const MIN_EDGE_PP = 2;

// Never publish a leg whose game starts within this window.
const MIN_MINUTES_TO_START = 30;

// American odds string to decimal odds.
function americanToDecimal(price) {
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

// Decimal odds back to American.
function decimalToAmerican(dec) {
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}

// American odds to raw implied probability (includes the book's margin).
function americanToProb(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}

// Combine a set of legs into parlay pricing and probability.
//
// Leg edges do NOT add across a parlay. Each leg's edge_pp is a probability
// gap (model win prob minus fair win prob), and parlay probabilities
// MULTIPLY, so the honest combined numbers are:
//   model win prob = product of per-leg model probs
//   fair win prob  = product of per-leg fair (devigged) probs
//   combined edge  = the difference in pp, always far smaller than the sum
//                    of leg edges. The payout leverage shows up in expected
//                    ROI (model prob x decimal payout - 1), not in the pp.
// The old sum (11 + 15 + 15 = "41pp") overstated the parlay wildly.
function combineLegs(legs) {
  const combinedDecimal = legs.reduce(
    (acc, leg) => acc * americanToDecimal(parseInt(leg.odds, 10)),
    1
  );
  const combinedOdds = decimalToAmerican(combinedDecimal);

  let modelProb = 1;
  let fairProb = 1;
  for (const leg of legs) {
    const raw = americanToProb(parseInt(leg.odds, 10));
    // Fair prob: the devigged number stored with the pick when we have it
    // (ML picks), else strip a standard ~4.5% two-way margin off the price.
    const fair = leg.implied_prob != null ? Number(leg.implied_prob) : raw * 0.955;
    const model = leg.model_prob != null
      ? Number(leg.model_prob)
      : Math.min(0.99, fair + Number(leg.edge_pp) / 100);
    modelProb *= model;
    fairProb *= fair;
  }

  const combinedEdgePp = Math.round((modelProb - fairProb) * 1000) / 10;
  const evPct = Math.round((modelProb * combinedDecimal - 1) * 1000) / 10;
  return {
    combinedDecimal,
    combinedOdds,
    combinedEdgePp,
    modelProb: Math.round(modelProb * 10000) / 10000,
    fairProb: Math.round(fairProb * 10000) / 10000,
    evPct,
  };
}

async function buildHouseParlays(req, res) {
  const startTime = Date.now();
  let built = 0;
  let skipped = 0;
  const parlays = [];

  try {
    // Today's calendar date in America/Denver, formatted YYYY-MM-DD.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
    const sessionId = `auto_digest_${today}`;

    // Cutoff so we never publish a leg whose game has started or is about to.
    const cutoff = new Date(Date.now() + MIN_MINUTES_TO_START * 60 * 1000).toISOString();

    // Candidate legs come from the house's own digest picks for today.
    const { data: candidates, error } = await supabase
      .from('ai_suggestions')
      .select('id, sport, home_team, away_team, game_date, bet_type, pick, odds, edge_pp, tier, model_prob, implied_prob')
      .eq('session_id', sessionId)
      .eq('actual_outcome', 'pending')
      .gte('edge_pp', MIN_EDGE_PP)
      .not('odds', 'is', null)
      .gt('game_date', cutoff);

    if (error) throw error;

    // Leg-tier rows are the backfill pool: sides the model grades 65%+ to
    // win on games with no betting edge (high hit probability, thin
    // payout). They rank BELOW every positive-edge pick, so they only
    // enter a parlay when the day's pick pool is short.
    const { data: legRows, error: legError } = await supabase
      .from('ai_suggestions')
      .select('id, sport, home_team, away_team, game_date, bet_type, pick, odds, edge_pp, tier, model_prob, implied_prob')
      .eq('session_id', `auto_digest_leg_${today}`)
      .eq('actual_outcome', 'pending')
      .not('odds', 'is', null)
      .gt('game_date', cutoff);
    // A failed leg query used to be discarded silently, shrinking the
    // pool with no witness. It is not fatal (picks can still build), but
    // it must be visible in the run log.
    if (legError) logger.error('House parlay leg pool query failed:', legError);

    // Correlation exclusion for the MVP is cross game only.
    // Keep at most one leg per game: a positive-edge pick always beats a
    // Leg row, otherwise highest edge wins.
    const byGame = new Map();
    for (const row of [...(candidates || []), ...(legRows || [])]) {
      const key = `${row.home_team}|${row.away_team}|${row.game_date}`;
      const existing = byGame.get(key);
      const beats = !existing
        || (existing.tier === 'Leg' && row.tier !== 'Leg')
        || (existing.tier === 'Leg') === (row.tier === 'Leg') && Number(row.edge_pp) > Number(existing.edge_pp);
      if (beats) byGame.set(key, row);
    }

    const legsPool = Array.from(byGame.values())
      .sort((a, b) => {
        const aLeg = a.tier === 'Leg', bLeg = b.tier === 'Leg';
        if (aLeg !== bLeg) return aLeg ? 1 : -1;
        return aLeg
          ? Number(b.model_prob || 0) - Number(a.model_prob || 0)
          : Number(b.edge_pp) - Number(a.edge_pp);
      });

    // Which sizes are already published today. Published parlays are append only.
    const { data: existingRows, error: existingError } = await supabase
      .from('house_parlays')
      .select('legs_count')
      .eq('parlay_date', today);

    if (existingError) throw existingError;
    const existingSizes = new Set((existingRows || []).map(r => r.legs_count));

    // Build the 2 leg and 3 leg products from the top of the pool.
    // The two parlays may share legs. They are separate published products.
    const sizeOutcomes = {};
    for (const size of [2, 3]) {
      if (legsPool.length < size) {
        // The old code fell through here in silence, which is how the
        // Aug 17 three-leg build vanished without a trace.
        sizeOutcomes[size] = `pool_short (${legsPool.length} eligible)`;
        logger.info(`House parlay ${size}-leg for ${today}: pool too short (${legsPool.length})`);
        continue;
      }

      if (existingSizes.has(size)) {
        logger.info(`House parlay ${size}-leg for ${today} already published, skipping`);
        sizeOutcomes[size] = 'already_published';
        skipped++;
        continue;
      }

      const legs = legsPool.slice(0, size).map(row => ({
        suggestion_id: row.id,
        sport: row.sport,
        home_team: row.home_team,
        away_team: row.away_team,
        game_date: row.game_date,
        bet_type: row.bet_type,
        pick: row.pick,
        odds: row.odds,
        edge_pp: row.edge_pp,
        tier: row.tier
      }));

      const { combinedDecimal, combinedOdds, combinedEdgePp, modelProb, fairProb, evPct } = combineLegs(legsPool.slice(0, size));

      const record = {
        parlay_date: today,
        legs_count: size,
        legs,
        combined_odds: combinedOdds,
        combined_decimal: combinedDecimal,
        combined_edge_pp: combinedEdgePp,
        model_win_prob: modelProb,
        fair_win_prob: fairProb,
        ev_pct: evPct,
        status: 'pending'
      };

      // ignoreDuplicates keeps this safe against a concurrent run.
      // The existence check above already prevents overwriting published rows.
      const { error: upsertError } = await supabase
        .from('house_parlays')
        .upsert(record, { onConflict: 'parlay_date,legs_count', ignoreDuplicates: true });

      if (upsertError) throw upsertError;

      built++;
      parlays.push(record);
      sizeOutcomes[size] = 'built';
      logger.info(`Built ${size}-leg house parlay for ${today} at ${combinedOdds} (model ${Math.round(modelProb * 1000) / 10}% vs fair ${Math.round(fairProb * 1000) / 10}%, +${combinedEdgePp}pp, EV ${evPct}%)`);
    }

    const duration = Date.now() - startTime;

    // The run log is the witness. pg_cron records the HTTP post as
    // succeeded no matter what happens in here, which is how four days
    // of quiet non-builds read as healthy (Aug 14-17 ops checks). Every
    // run now files its outcome where the ops sweep already looks.
    await supabase.from('cron_job_logs').insert({
      job_name: 'build-house-parlays',
      status: 'completed',
      details: JSON.stringify({
        built, skipped, sizes: sizeOutcomes,
        pool: legsPool.length,
        pick_candidates: (candidates || []).length,
        leg_candidates: (legRows || []).length,
        leg_query_error: legError ? String(legError.message || legError) : null,
        duration_ms: duration,
      }),
    });

    res.json({
      success: true,
      built,
      skipped,
      parlays,
      candidateLegs: legsPool.length,
      duration: `${duration}ms`
    });

  } catch (error) {
    logger.error('Build house parlays error:', error);
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: 'build-house-parlays',
        status: 'failed',
        details: JSON.stringify({ error: error.message }),
      });
    } catch { /* best-effort */ }
    res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = buildHouseParlays;
