/**
 * The house parlay record, one per composition rule (owner 2026-10-15).
 * The gimme plus value slips are scored on their own from 2026-10-15,
 * never mixed with the heavy only slips before them (which went 59-59
 * for -6.09u), and house parlays never enter mv_public_record, so they
 * stay out of the straight pick record too. The digest and the House
 * Ledger both read this, so the two surfaces quote one record.
 */

'use strict';

const CURRENT_RULE = 'gimme_plus_value';
const CURRENT_SINCE = '2026-10-15';
const PRIOR_RULE = 'heavy_only';

function tally(rows) {
  let won = 0, lost = 0;
  for (const r of rows || []) {
    if (r.status === 'won') won++;
    else if (r.status === 'lost') lost++;
  }
  const settled = won + lost;
  return { won, lost, hitRate: settled > 0 ? Math.round((won / settled) * 1000) / 10 : null };
}

/**
 * { won, lost, hitRate, rule, since, prior: { rule, won, lost, hitRate } }.
 * The top level is the current rule, so a reader that only knows won,
 * lost and hitRate shows the new record.
 */
async function houseParlayRecord(supabase) {
  const { data, error } = await supabase
    .from('house_parlays')
    .select('status, rule')
    .in('status', ['won', 'lost']);
  if (error) throw error;
  const rows = data || [];
  const current = tally(rows.filter(r => r.rule === CURRENT_RULE));
  const prior = tally(rows.filter(r => r.rule !== CURRENT_RULE));
  return { ...current, rule: CURRENT_RULE, since: CURRENT_SINCE, prior: { rule: PRIOR_RULE, ...prior } };
}

module.exports = { houseParlayRecord, tally, CURRENT_RULE, CURRENT_SINCE, PRIOR_RULE };
