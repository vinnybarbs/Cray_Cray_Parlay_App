/**
 * The weekly dial search (owner 2026-10-11: "a last week what dials would
 * have made the week profitable or more profitable and if that holds
 * against the larger data set for that sport and market turn the dials").
 *
 * Two stages per sport, both on the replay harness:
 *
 *   1. Search. Every replayable dial on the sport's board is tried one
 *      step down and one step up (25 percent of its value, the directive 8
 *      cap, or a fixed step for a dial sitting at zero) over the last
 *      recentDays. A variant that beats base by minDelta units or more is
 *      a winner, and the best `top` of them go on.
 *   2. Confirm. Base and the winners are replayed over the confirmDays
 *      BEFORE the searched week, so the check is out of sample, and that
 *      run goes through file_replay_candidates: the three tests, the
 *      bucket table and the 25 percent first step cap. A variant that
 *      passes is filed to build_queue with the evidence.
 *
 * Read only apart from replay_picks, build_queue (through the filing
 * function) and the caller's cron_job_logs row. It never writes a dial.
 */

'use strict';

const { runReplay, siteDate } = require('./replay-formula.js');
const { DIAL_DEFAULTS } = require('../services/edge-calculator.js');

/**
 * The dials the replay can move honestly. Left out on purpose: injury
 * weights (news_cache is empty as-of), the NHL goalie and lineup dials and
 * the weather weight (live page reads with no history), seed_weight (no
 * as-of seed), pitcher_anchor_damp (build queue 86, inert in replay),
 * leg_prob_floor (legs are not replayed), min_gate_pp (never raise the
 * gate), publish and trap flags (owner calls, not weights). A dial that
 * changes nothing in replay ties base and never wins, so a harmless extra
 * here costs replay time and nothing else.
 */
const SEARCH_DIALS = {
  form_weight: { zeroStep: 0.05, max: 1 },
  sos_sensitivity: { zeroStep: 0.05, max: 1 },
  venue_weight: { zeroStep: 0.05, max: 1 },
  max_net_adjustment: { zeroStep: 0.02, max: 0.5 },
  spread_claim_damp: { zeroStep: 0.1, max: 1 },
  total_claim_damp: { zeroStep: 0.1, max: 1 },
  home_margin_shift: { zeroStep: 0.25, min: -2, max: 2, signed: true },
  rest_per_day: { zeroStep: 0.001, max: 0.02 },
  rest_cap: { zeroStep: 0.005, max: 0.1 },
};

/** Per sport extras and exclusions on top of SEARCH_DIALS. */
const SPORT_EXCLUDE = {
  MLB: ['rest_per_day', 'rest_cap'],
  NHL: ['rest_per_day', 'rest_cap'],
};

const STEP = 0.25;

function round4(x) { return Math.round(x * 10000) / 10000; }

/**
 * The board for a sport: code defaults, then the __all__ row, then the
 * sport's own row, the same precedence the calculator uses.
 */
function boardFor(sport, rows) {
  const board = {};
  for (const [k, v] of Object.entries(DIAL_DEFAULTS)) if (typeof v === 'number') board[k] = v;
  for (const r of rows || []) if (r.sport === '__all__' && Number.isFinite(Number(r.value))) board[r.dial] = Number(r.value);
  for (const r of rows || []) if (r.sport === sport && Number.isFinite(Number(r.value))) board[r.dial] = Number(r.value);
  return board;
}

/**
 * Pure: the stage 1 variants for a sport's board. Each searchable dial
 * with a numeric value yields a down and an up variant, clamped to its
 * range, named <dial>_dn and <dial>_up, plus base.
 */
function searchVariants(sport, board) {
  const out = [{ name: 'base', kind: 'current', dials: {} }];
  const skip = new Set(SPORT_EXCLUDE[sport] || []);
  for (const [dial, spec] of Object.entries(SEARCH_DIALS)) {
    if (skip.has(dial)) continue;
    const cur = Number(board[dial]);
    if (!Number.isFinite(cur)) continue;
    const min = spec.min ?? 0;
    const max = spec.max ?? Infinity;
    const delta = cur === 0 ? spec.zeroStep : STEP * Math.abs(cur);
    const tries = [['dn', cur - delta], ['up', cur + delta]];
    for (const [tag, raw] of tries) {
      const v = round4(Math.min(max, Math.max(min, raw)));
      if (v === round4(cur)) continue;
      if (!spec.signed && v < 0) continue;
      out.push({ name: `${dial}_${tag}`, kind: 'current', dials: { [dial]: v } });
    }
  }
  return out;
}

/**
 * Pure: the stage 1 winners from a replay summary. A winner beats base
 * by minDelta units or more and actually published something. Best
 * first, at most `top`, at most one direction per dial.
 */
function stageOneWinners(summary, variants, { minDelta = 0.5, top = 4 } = {}) {
  const base = summary?.formulas?.base;
  if (!base) return [];
  const scored = [];
  for (const v of variants) {
    if (v.name === 'base') continue;
    const s = summary.formulas[v.name];
    if (!s || s.picks === 0) continue;
    const delta = Math.round((s.units - base.units) * 100) / 100;
    if (delta >= minDelta) scored.push({ ...v, delta, units: s.units, picks: s.picks, won: s.won, lost: s.lost });
  }
  scored.sort((a, b) => b.delta - a.delta);
  const seen = new Set();
  const out = [];
  for (const v of scored) {
    const dial = Object.keys(v.dials)[0];
    if (seen.has(dial)) continue;
    seen.add(dial);
    out.push(v);
    if (out.length >= top) break;
  }
  return out;
}

/**
 * Run both stages for one sport. Returns a summary for cron_job_logs.
 */
async function runDialSearch(supabase, { sport, recentDays = 7, confirmDays = 60, minDelta = 0.5, top = 4, file = true, stamp = null, log = () => {} } = {}) {
  const tag = stamp || siteDate(new Date()).replace(/-/g, '');
  const { data: rows, error } = await supabase.from('sport_dials').select('sport, dial, value').in('sport', ['__all__', sport]);
  if (error) throw error;
  const board = boardFor(sport, rows);
  const variants = searchVariants(sport, board);

  const searchRun = `dial_search_${sport.toLowerCase()}_${tag}_recent`;
  const recent = await runReplay(supabase, { sport, days: recentDays, variants, runId: searchRun, log });
  const winners = stageOneWinners(recent, variants, { minDelta, top });
  const out = {
    sport, recent_days: recentDays, confirm_days: confirmDays,
    search_run: searchRun, variants_searched: variants.length - 1,
    recent_base: recent.formulas.base ? { picks: recent.formulas.base.picks, units: recent.formulas.base.units } : null,
    winners: winners.map(w => ({ name: w.name, dials: w.dials, delta: w.delta, picks: w.picks })),
  };
  if (!winners.length) { out.note = 'no dial beat base on the searched week'; return out; }

  const confirmRun = `dial_search_${sport.toLowerCase()}_${tag}_confirm`;
  const confirmVariants = [{ name: 'base', kind: 'current', dials: {} }, ...winners.map(w => ({ name: w.name, kind: 'current', dials: w.dials }))];
  const confirm = await runReplay(supabase, { sport, days: confirmDays, offsetDays: recentDays, variants: confirmVariants, runId: confirmRun, log });
  out.confirm_run = confirmRun;
  out.confirm = Object.fromEntries(Object.entries(confirm.formulas).map(([k, s]) => [k, { picks: s.picks, won: s.won, lost: s.lost, units: s.units }]));
  if (file && confirm.picks_written > 0) {
    const { data, error: fErr } = await supabase.rpc('file_replay_candidates', { p_run_id: confirmRun, p_variants: confirmVariants });
    out.candidates_filed = fErr ? `error: ${fErr.message}` : data;
  }
  return out;
}

module.exports = { runDialSearch, searchVariants, stageOneWinners, boardFor, SEARCH_DIALS };
