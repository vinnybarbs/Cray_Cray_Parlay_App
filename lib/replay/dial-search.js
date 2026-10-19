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
 *   3. Apply (only with apply true, directive 8 as amended 2026-10-11,
 *      owner "Auto, bounded"). The one best passing move per sport per
 *      week lands on sport_dials as one 25 percent step, with a
 *      model_weight_changes row (source dial-search-auto) and a
 *      dial_search_moves row carrying a six week sunset.
 *   4. History (owner 2026-10-14). Before the apply, base and the passing
 *      variants are replayed over the same calendar span in each of the
 *      three prior seasons, from their closing prices (runHistoryReplay).
 *      With historyGate on, a variant that loses units to base there is
 *      dropped, as long as base made at least HISTORY_MIN_PICKS picks
 *      (too little history is no evidence either way). The result rides
 *      on the move's evidence either way.
 *
 * Every run first resolves the moves whose sunset has come: the weeks
 * since the move are replayed with the move against the old value, and
 * the move is reverted when the old value did at least as well. A dial
 * with an open move is not searched until its sunset resolves.
 *
 * Writes replay_picks, build_queue (through the filing function), and
 * with apply true sport_dials, model_weight_changes and dial_search_moves.
 */

'use strict';

const { runReplay, runHistoryReplay, priorSeasonWindows, siteDate } = require('./replay-formula.js');
const { DIAL_DEFAULTS } = require('../services/edge-calculator.js');

/**
 * The dials the replay can move honestly. injury_weight is NFL only (owner
 * 2026-10-19, build_queue 118): NFL reads replay the injury impact they
 * stored, every other sport's injury feed is empty as-of. Left out on
 * purpose: the other injury dials, the NHL goalie and lineup dials and
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
  injury_weight: { zeroStep: 0.25, max: 2, only: ['NFL'] },
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
function searchVariants(sport, board, { skipDials = [] } = {}) {
  const out = [{ name: 'base', kind: 'current', dials: {} }];
  const skip = new Set([...(SPORT_EXCLUDE[sport] || []), ...skipDials]);
  for (const [dial, spec] of Object.entries(SEARCH_DIALS)) {
    if (skip.has(dial)) continue;
    if (spec.only && !spec.only.includes(sport)) continue;
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

const SUNSET_WEEKS = 6;
const HISTORY_SEASONS = 3;
const HISTORY_MIN_PICKS = 30;

/**
 * Pure: the history verdict per passed variant from a history replay
 * summary. A variant holds when it made at least as many units as base.
 * With too few base picks the check is not run and everything holds.
 */
function historyVerdicts(summary, names, { minPicks = HISTORY_MIN_PICKS } = {}) {
  const base = summary?.formulas?.base;
  const enough = !!base && base.picks >= minPicks;
  const out = {};
  for (const name of names) {
    const s = summary?.formulas?.[name];
    const delta = s && base ? Math.round((s.units - base.units) * 100) / 100 : null;
    out[name] = {
      checked: enough,
      holds: !enough || (s != null && s.units >= base.units),
      picks: s ? s.picks : 0, won: s ? s.won : 0, lost: s ? s.lost : 0, units: s ? s.units : 0,
      base_units: base ? base.units : null, base_picks: base ? base.picks : 0, delta_units: delta,
    };
  }
  return out;
}
const SOURCE = 'dial-search-auto';

/** A Denver site date n days after another (noon anchored, so no day slip). */
function addDays(dateStr, n) {
  return siteDate(new Date(Date.parse(`${dateStr}T18:00:00Z`) + n * 86400000));
}

/**
 * Pure: the move to apply from a confirm run's filing result. The passed
 * variant with the largest out of sample gain that is still one of this
 * week's winners, so exactly one dial moves per sport per week.
 */
function bestPassedMove(filed, winners) {
  const passed = Array.isArray(filed?.passed) ? filed.passed : [];
  const byName = new Map(winners.map(w => [w.name, w]));
  const ranked = passed.filter(p => byName.has(p.name)).sort((a, b) => Number(b.delta_units) - Number(a.delta_units));
  if (!ranked.length) return null;
  const top = ranked[0];
  const w = byName.get(top.name);
  const [dial, value] = Object.entries(w.dials)[0];
  return { name: top.name, dial, value, confirm: top, recent: { delta: w.delta, picks: w.picks, won: w.won, lost: w.lost } };
}

/** Write one dial value with its evidence rows. */
async function writeDial(supabase, { sport, dial, before, after, reason }) {
  const { error: dErr } = await supabase.from('sport_dials').upsert({ sport, dial, value: after, updated_at: new Date().toISOString() }, { onConflict: 'sport,dial' });
  if (dErr) throw dErr;
  const { error: mErr } = await supabase.from('model_weight_changes').insert({
    sport, component: `${dial}: dial search`, before: { [dial]: before }, after: { [dial]: after }, reason, source: SOURCE,
  });
  if (mErr) throw mErr;
}

/**
 * Apply the best passing move. Returns what was applied, or null.
 */
async function applyBestMove(supabase, { sport, board, filed, winners, confirmRun, today, history = null }) {
  const move = bestPassedMove(filed, winners);
  if (!move) return null;
  const hist = history && history[move.name];
  const histText = hist && hist.checked
    ? ` Over the same weeks of the prior ${HISTORY_SEASONS} seasons it went ${hist.won}-${hist.lost}, ${hist.units}u, ${hist.delta_units}u over base.`
    : '';
  const before = Number.isFinite(Number(board[move.dial])) ? Number(board[move.dial]) : null;
  const sunset = addDays(today, SUNSET_WEEKS * 7);
  const reason = `Weekly dial search ${confirmRun}: ${move.dial} ${before} to ${move.value}. Last week the move beat base by ${move.recent.delta}u on ${move.recent.picks} picks. On the out of sample confirm window it went ${move.confirm.won}-${move.confirm.lost}, ${move.confirm.units}u, ${move.confirm.delta_units}u over base, and passed the three tests.${histText} One 25 percent step, directive 8 as amended 2026-10-11. Sunset ${sunset}: replayed against the old value then, reverted if the old value did at least as well.`;
  await writeDial(supabase, { sport, dial: move.dial, before, after: move.value, reason });
  const { error } = await supabase.from('dial_search_moves').insert({
    sport, dial: move.dial, before_value: before, after_value: move.value, sunset_on: sunset, confirm_run: confirmRun,
    evidence: { recent: move.recent, confirm: move.confirm, history: hist || null },
  });
  if (error) throw error;
  return { dial: move.dial, before, after: move.value, sunset_on: sunset, variant: move.name };
}

/**
 * Resolve the moves whose sunset has come: replay the days since the move
 * with the move (base) against the old value (revert) and revert when
 * revert did at least as well. Returns what happened per move.
 */
async function resolveSunsets(supabase, { sport, today, apply, tag, log }) {
  const { data: due, error } = await supabase.from('dial_search_moves').select('*').eq('sport', sport).eq('status', 'applied').lte('sunset_on', today);
  if (error) throw error;
  const out = [];
  for (const m of due || []) {
    const days = Math.min(120, Math.max(7, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(m.applied_at)) / 86400000)));
    const variants = [{ name: 'base', kind: 'current', dials: {} }];
    if (m.before_value != null) variants.push({ name: 'revert', kind: 'current', dials: { [m.dial]: Number(m.before_value) } });
    const runId = `dial_search_${sport.toLowerCase()}_${tag}_sunset_${m.id}`;
    const r = await runReplay(supabase, { sport, days, variants, runId, log });
    const kept = r.formulas.base, rev = r.formulas.revert;
    const revert = !!rev && rev.picks > 0 && rev.units >= kept.units;
    const evidence = { days, with_move: { picks: kept.picks, won: kept.won, lost: kept.lost, units: kept.units }, old_value: rev ? { picks: rev.picks, won: rev.won, lost: rev.lost, units: rev.units } : null };
    const row = { id: m.id, dial: m.dial, decision: revert ? 'revert' : 'keep', evidence };
    if (apply) {
      if (revert) {
        await writeDial(supabase, { sport, dial: m.dial, before: Number(m.after_value), after: Number(m.before_value),
          reason: `Dial search sunset ${runId}: the ${m.dial} move of ${String(m.applied_at).slice(0, 10)} reverted to ${m.before_value}. Over the ${days} days since, the old value went ${rev.won}-${rev.lost} ${rev.units}u against ${kept.won}-${kept.lost} ${kept.units}u with the move.` });
      }
      const { error: uErr } = await supabase.from('dial_search_moves').update({ status: revert ? 'reverted' : 'kept', resolved_at: new Date().toISOString(), resolve_run: runId, resolve_evidence: evidence }).eq('id', m.id);
      if (uErr) throw uErr;
    }
    out.push(row);
  }
  return out;
}

/**
 * Run the stages for one sport. Returns a summary for cron_job_logs.
 */
async function runDialSearch(supabase, { sport, recentDays = 7, confirmDays = 60, minDelta = 0.5, top = 4, file = true, apply = false, historyGate = true, stamp = null, log = () => {} } = {}) {
  const today = siteDate(new Date());
  const tag = stamp || today.replace(/-/g, '');
  const out = { sport, recent_days: recentDays, confirm_days: confirmDays, apply };
  out.sunsets = await resolveSunsets(supabase, { sport, today, apply, tag, log });

  const { data: rows, error } = await supabase.from('sport_dials').select('sport, dial, value').in('sport', ['__all__', sport]);
  if (error) throw error;
  const board = boardFor(sport, rows);
  const { data: open, error: oErr } = await supabase.from('dial_search_moves').select('dial').eq('sport', sport).eq('status', 'applied');
  if (oErr) throw oErr;
  const skipDials = (open || []).map(r => r.dial);
  if (skipDials.length) out.skipped_open_moves = skipDials;
  const variants = searchVariants(sport, board, { skipDials });

  const searchRun = `dial_search_${sport.toLowerCase()}_${tag}_recent`;
  const recent = await runReplay(supabase, { sport, days: recentDays, variants, runId: searchRun, log });
  const winners = stageOneWinners(recent, variants, { minDelta, top });
  Object.assign(out, {
    search_run: searchRun, variants_searched: variants.length - 1,
    recent_base: recent.formulas.base ? { picks: recent.formulas.base.picks, units: recent.formulas.base.units } : null,
    winners: winners.map(w => ({ name: w.name, dials: w.dials, delta: w.delta, picks: w.picks })),
  });
  if (!winners.length) { out.note = 'no dial beat base on the searched week'; return out; }

  const confirmRun = `dial_search_${sport.toLowerCase()}_${tag}_confirm`;
  const confirmVariants = [{ name: 'base', kind: 'current', dials: {} }, ...winners.map(w => ({ name: w.name, kind: 'current', dials: w.dials }))];
  const confirm = await runReplay(supabase, { sport, days: confirmDays, offsetDays: recentDays, variants: confirmVariants, runId: confirmRun, log });
  out.confirm_run = confirmRun;
  out.confirm = Object.fromEntries(Object.entries(confirm.formulas).map(([k, s]) => [k, { picks: s.picks, won: s.won, lost: s.lost, units: s.units }]));
  if (!(file && confirm.picks_written > 0)) return out;
  const { data: filed, error: fErr } = await supabase.rpc('file_replay_candidates', { p_run_id: confirmRun, p_variants: confirmVariants });
  if (fErr) { out.candidates_filed = `error: ${fErr.message}`; return out; }
  out.candidates_filed = filed;
  let passed = Array.isArray(filed?.passed) ? filed.passed : [];
  let history = null;
  if (passed.length) {
    const historyRun = `dial_search_${sport.toLowerCase()}_${tag}_history`;
    const windows = priorSeasonWindows(Date.now() - 4 * 3600 * 1000, recentDays + confirmDays, HISTORY_SEASONS);
    const names = passed.map(p => p.name);
    const histVariants = [{ name: 'base', kind: 'current', dials: {} }, ...winners.filter(w => names.includes(w.name)).map(w => ({ name: w.name, kind: 'current', dials: w.dials }))];
    try {
      const h = await runHistoryReplay(supabase, { sport, windows, variants: histVariants, runId: historyRun, log });
      history = historyVerdicts(h, names);
      out.history = { run: historyRun, games: h.games_with_results, unmatched: h.games_unmatched, gate: historyGate, verdicts: history };
      if (historyGate) passed = passed.filter(p => history[p.name]?.holds);
    } catch (err) {
      // A failed history replay blocks nothing: the three tests stand.
      out.history = { error: err.message };
    }
  }
  if (apply) out.applied = await applyBestMove(supabase, { sport, board, filed: { ...filed, passed }, winners, confirmRun, today, history });
  return out;
}

module.exports = { runDialSearch, searchVariants, stageOneWinners, boardFor, bestPassedMove, applyBestMove, resolveSunsets, addDays, historyVerdicts, SEARCH_DIALS, HISTORY_MIN_PICKS };
