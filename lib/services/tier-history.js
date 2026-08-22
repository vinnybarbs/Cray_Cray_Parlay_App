/**
 * Append-only tier path for a published pick.
 *
 * A pick's tier can legally change all day as prices and data move
 * (owner keeps promotions: a bet climbing to Sharp Take is a feature).
 * What was missing is the trail: on 2026-08-21 the Rays slipped out of
 * Sharp Take at 12:45 and the Padres climbed into it at 15:45, and a
 * morning reader had no way to know the evening board differed. Every
 * tier change now appends {tier, odds, edge_pp, at} so the UI can say
 * "promoted from Strong Play at 3:45 PM" and the weekly review can
 * measure how often the morning board differs from the board at lock.
 */

'use strict';

/**
 * Returns the updated history array when the tier changed, or null when
 * nothing needs writing (same tier, or nothing to record). A legacy row
 * that predates the column gets seeded with its previous tier (at: null,
 * meaning "since first publication") so the first recorded change still
 * shows a full path.
 */
function withTierHistory(previousTier, existingHistory, entry) {
  if (!entry || !entry.tier) return null;
  const hist = Array.isArray(existingHistory) ? existingHistory.slice() : [];
  const lastTier = hist.length > 0 ? hist[hist.length - 1].tier : previousTier;
  if (lastTier === entry.tier) return null;
  if (hist.length === 0 && previousTier) {
    hist.push({ tier: previousTier, at: null });
  }
  hist.push(entry);
  return hist;
}

/** History entry for now, from a pick payload. */
function historyEntry(tier, odds, edgePp) {
  return {
    tier,
    odds: odds ?? null,
    edge_pp: edgePp ?? null,
    at: new Date().toISOString(),
  };
}

module.exports = { withTierHistory, historyEntry };
