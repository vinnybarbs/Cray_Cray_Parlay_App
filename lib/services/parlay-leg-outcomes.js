/**
 * Enrich house parlay legs with each leg's live outcome (owner request
 * 2026-08-26: the ledger and the digest parlay view should show legs
 * settling one by one, then the whole ticket).
 *
 * Legs are stored as a jsonb snapshot carrying suggestion_id. The
 * snapshot never updates, which is correct for the published record, so
 * the live outcome is joined at read time from ai_suggestions. Fail-soft:
 * an error leaves legs unenriched rather than breaking the page.
 */

'use strict';

async function enrichParlayLegOutcomes(supabase, parlays) {
  const list = Array.isArray(parlays) ? parlays : [];
  const ids = [...new Set(list.flatMap(p =>
    (Array.isArray(p.legs) ? p.legs : [])
      .map(l => l && l.suggestion_id)
      .filter(Boolean)))];
  if (ids.length === 0) return list;
  try {
    const { data, error } = await supabase
      .from('ai_suggestions')
      .select('id, actual_outcome')
      .in('id', ids);
    if (error || !Array.isArray(data)) return list;
    const outcomeById = new Map(data.map(r => [r.id, r.actual_outcome]));
    for (const p of list) {
      if (!Array.isArray(p.legs)) continue;
      p.legs = p.legs.map(l => ({
        ...l,
        outcome: l && l.suggestion_id != null
          ? (outcomeById.get(l.suggestion_id) ?? null)
          : null,
      }));
    }
    return list;
  } catch {
    return list;
  }
}

module.exports = { enrichParlayLegOutcomes };
