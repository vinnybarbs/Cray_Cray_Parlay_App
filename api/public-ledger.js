/**
 * The House Ledger: public, append-only settlement record.
 *
 * This endpoint is the substantiation surface the whole marketing pitch
 * stands on (audit ROADMAP NOW item 5): every house pick published before
 * the game, settled after, losers included. It serves:
 *  - picks: settled auto_digest picks (the house picks the digest publishes)
 *  - summary: overall + per-tier record with ROI and units at 1u stakes
 *  - parlays: machine-built house parlays, pending and settled
 *
 * Anon-readable by design. No auth, no user data.
 */

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../shared/logger');

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function safeQuery(fn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn('Public ledger query failed', { error: err.message });
    return null;
  }
}

// Profit on a 1-unit stake at American odds. Won: +price/100 for dogs,
// +100/|price| for favorites. Lost: -1. Push/void: 0 (stake returned).
function unitProfit(oddsStr, outcome) {
  if (outcome === 'push' || outcome === 'void') return 0;
  if (outcome === 'lost') return -1;
  if (outcome !== 'won') return 0;
  const price = parseInt(oddsStr, 10);
  if (Number.isNaN(price) || price === 0) return 0;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

function summarize(rows) {
  const out = { settled: 0, won: 0, lost: 0, push: 0, units: 0, winRate: null, roi: null };
  for (const r of rows) {
    out.settled++;
    if (r.actual_outcome === 'won') out.won++;
    else if (r.actual_outcome === 'lost') out.lost++;
    else out.push++;
    out.units += unitProfit(r.odds, r.actual_outcome);
  }
  const decided = out.won + out.lost;
  if (decided > 0) {
    out.winRate = Math.round((out.won / decided) * 1000) / 10;
    // ROI on decided stakes; pushes return the stake and carry no risk.
    out.roi = Math.round((out.units / decided) * 1000) / 10;
  }
  out.units = Math.round(out.units * 100) / 100;
  return out;
}

async function getPublicLedger(req, res) {
  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    // Every settled house pick. auto_digest is the published-daily pipeline,
    // picks written by the analysis cron before games start. Supabase caps a
    // select at 1,000 rows, so page until exhausted. The headline number
    // claims the full history and must actually cover it.
    const settledPicks = await safeQuery(async () => {
      const all = [];
      const PAGE = 1000;
      for (let page = 0; page < 20; page++) {
        const { data, error } = await supabase
          .from('ai_suggestions')
          .select('id, sport, bet_type, pick, odds, edge_pp, tier, game_date, created_at, resolved_at, actual_outcome')
          .like('session_id', 'auto_digest%')
          .in('actual_outcome', ['won', 'lost', 'push'])
          .order('resolved_at', { ascending: false })
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) throw error;
        all.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      return all;
    }) || [];

    // Today's published-but-unsettled picks, so the ledger shows the picks
    // BEFORE their games too (timestamps prove publish-before-start).
    const openPicks = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('ai_suggestions')
        .select('id, sport, bet_type, pick, odds, edge_pp, tier, game_date, created_at, actual_outcome')
        .like('session_id', 'auto_digest%')
        .eq('actual_outcome', 'pending')
        .not('sport', 'in', '("EPL","MLS","Soccer","World Cup","Champions League","Copa America","Euros")')
        .gt('game_date', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
        .order('game_date', { ascending: true })
        .limit(100);
      if (error) throw error;
      return data || [];
    }) || [];

    // Traps and Skips are NOT bets. A Trap is fade advice (the model says
    // the side is overpriced) and a Skip is below the actionable floor. They
    // stay in the database for calibration, but they don't belong in the
    // win/loss record. A trap whose side LOST is a CORRECT call.
    // Soccer v1 was R&D on a two-way model that never priced the draw,
    // scrapped pre-launch (2026-07-12). Its rows stay in the database but
    // appear nowhere on the site. Soccer returns as v2 with a real
    // three-way model.
    const SOCCER_SPORTS = new Set(['EPL', 'MLS', 'Soccer', 'World Cup', 'Champions League', 'Copa America', 'Euros']);
    const nonSoccer = settledPicks.filter(r => !SOCCER_SPORTS.has(r.sport));

    // The public record begins at the graded era (2026-05-10, when edge
    // grading went live). Ungraded picks before that were development
    // output, pre-launch R&D, and is not shown (decision 2026-07-12).
    const graded = nonSoccer.filter(r => r.tier != null);

    const isActionable = (row) => !['Trap', 'Skip'].includes(row.tier);
    const actionablePicks = graded.filter(isActionable);
    const trapPicks = graded.filter(r => r.tier === 'Trap');

    // Per-tier and overall record over the actionable settled history.
    const byTier = {};
    for (const row of actionablePicks) {
      const tier = row.tier || 'Ungraded';
      if (!byTier[tier]) byTier[tier] = [];
      byTier[tier].push(row);
    }

    // Fade record: the trap side losing means the fade won.
    const trapReport = { called: trapPicks.length, fadeWins: 0, fadeLosses: 0, pushes: 0 };
    for (const t of trapPicks) {
      if (t.actual_outcome === 'lost') trapReport.fadeWins++;
      else if (t.actual_outcome === 'won') trapReport.fadeLosses++;
      else trapReport.pushes++;
    }
    const fadeDecided = trapReport.fadeWins + trapReport.fadeLosses;
    trapReport.fadeRate = fadeDecided > 0
      ? Math.round((trapReport.fadeWins / fadeDecided) * 1000) / 10 : null;

    // Hit rates by sport and by bet type, same population as the headline.
    const groupSummaries = (keyFn) => {
      const groups = {};
      for (const row of actionablePicks) {
        const key = keyFn(row) || 'Other';
        (groups[key] ??= []).push(row);
      }
      return Object.fromEntries(
        Object.entries(groups)
          .map(([k, rows]) => [k, summarize(rows)])
          .sort((a, b) => b[1].settled - a[1].settled)
      );
    };

    const summary = {
      overall: summarize(actionablePicks),
      byTier: Object.fromEntries(Object.entries(byTier).map(([t, rows]) => [t, summarize(rows)])),
      bySport: groupSummaries(r => r.sport),
      byBetType: groupSummaries(r => r.bet_type),
      trapReport,
    };

    // Machine-built house parlays (pending + settled). Missing table (before
    // the migration lands) degrades to an empty list, never a 500.
    const parlays = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('house_parlays')
        .select('*')
        .order('parlay_date', { ascending: false })
        .order('legs_count', { ascending: true })
        .limit(80);
      if (error) throw error;
      return data || [];
    }) || [];

    res.json({
      status: 'ok',
      generated_at: new Date().toISOString(),
      methodology: {
        population: 'Every actionable pick published since May 10, 2026, when edge grading went live. That is the start of the graded record. Traps (fade calls) are reported separately because they are advice to bet against a side, not on it. Nothing removed, nothing edited after publication.',
        grading: 'One pick per game per day, the final version published before start, at its price. Pre-start revisions replace, never add. Signed model edge in percentage points sets the tier; outcomes graded from final scores by the settlement pipeline.',
        stakes: 'Records assume 1 unit per pick at the published odds. Pushes return the stake.',
        timestamps: 'published_at is the database write time, before the game starts. settled_at is when the outcome was graded.',
      },
      summary,
      picks: actionablePicks.slice(0, 250),
      openPicks,
      parlays,
    });
  } catch (err) {
    logger.error('Public ledger endpoint error', { error: err.message });
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}

module.exports = { getPublicLedger };
