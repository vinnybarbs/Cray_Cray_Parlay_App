/**
 * Cron: Settle pending house parlays
 *
 * Reads the outcome of each leg from ai_suggestions and settles the parlay.
 * A parlay is lost the moment any leg loses, even if other legs are pending.
 * A parlay with all legs settled and none lost is won if at least one leg won.
 * Pushed and void legs drop out of the payout math, which is standard
 * sportsbook push handling. If every leg pushed or voided the parlay pushes.
 */

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../../shared/logger');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// American odds string to decimal odds.
function americanToDecimal(price) {
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

// Decimal odds back to American.
function decimalToAmerican(dec) {
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}

async function settleHouseParlays(req, res) {
  const startTime = Date.now();
  let settled = 0;
  let won = 0;
  let lost = 0;
  let push = 0;
  let stillPending = 0;

  try {
    const { data: parlays, error } = await supabase
      .from('house_parlays')
      .select('id, legs, combined_odds, combined_decimal, status')
      .eq('status', 'pending');

    if (error) throw error;

    if (!parlays?.length) {
      return res.json({ success: true, settled: 0, won: 0, lost: 0, push: 0, stillPending: 0 });
    }

    // Fetch every referenced suggestion in one query.
    const allIds = [...new Set(
      parlays.flatMap(p => (p.legs || []).map(leg => leg.suggestion_id))
    )];

    const { data: suggestions, error: suggestionsError } = await supabase
      .from('ai_suggestions')
      .select('id, actual_outcome, odds')
      .in('id', allIds);

    if (suggestionsError) throw suggestionsError;

    const outcomeById = new Map((suggestions || []).map(s => [s.id, s]));

    for (const parlay of parlays) {
      try {
        const legs = parlay.legs || [];
        const legResults = legs.map(leg => {
          const suggestion = outcomeById.get(leg.suggestion_id);
          return {
            leg,
            outcome: suggestion ? suggestion.actual_outcome : 'pending'
          };
        });

        const anyLost = legResults.some(r => r.outcome === 'lost');
        const anyPending = legResults.some(r => r.outcome === 'pending' || !r.outcome);

        // One lost leg kills the parlay immediately, pending legs do not matter.
        if (anyLost) {
          const { error: updateError } = await supabase
            .from('house_parlays')
            .update({ status: 'lost', settled_at: new Date().toISOString() })
            .eq('id', parlay.id);
          if (updateError) throw updateError;
          settled++;
          lost++;
          continue;
        }

        // No losses yet but at least one leg is still open. Leave it pending.
        if (anyPending) {
          stillPending++;
          continue;
        }

        // All legs settled and none lost. Won legs pay, pushed and void legs
        // drop out of the payout math per standard sportsbook push handling.
        const wonLegs = legResults.filter(r => r.outcome === 'won').map(r => r.leg);

        if (wonLegs.length === 0) {
          // Every leg pushed or voided so the parlay pushes.
          const { error: updateError } = await supabase
            .from('house_parlays')
            .update({ status: 'push', settled_at: new Date().toISOString() })
            .eq('id', parlay.id);
          if (updateError) throw updateError;
          settled++;
          push++;
          continue;
        }

        // Recompute effective odds from the surviving won legs only.
        // combined_edge_pp stays as published, it is the graded score at post time.
        const effectiveDecimal = wonLegs.reduce(
          (acc, leg) => acc * americanToDecimal(parseInt(leg.odds, 10)),
          1
        );
        const effectiveOdds = decimalToAmerican(effectiveDecimal);

        const { error: updateError } = await supabase
          .from('house_parlays')
          .update({
            status: 'won',
            combined_odds: effectiveOdds,
            combined_decimal: effectiveDecimal,
            settled_at: new Date().toISOString()
          })
          .eq('id', parlay.id);
        if (updateError) throw updateError;
        settled++;
        won++;

      } catch (err) {
        logger.warn(`Settle failed for house parlay ${parlay.id}: ${err.message}`);
        stillPending++;
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`House parlay settlement: ${settled} settled (${won} won, ${lost} lost, ${push} push), ${stillPending} still pending`);
    res.json({ success: true, settled, won, lost, push, stillPending, duration: `${duration}ms` });

  } catch (error) {
    logger.error('Settle house parlays error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = settleHouseParlays;
