// API endpoint for parlay outcome management
const ParlayOutcomeChecker = require('../lib/services/parlay-outcome-checker');
const { supabaseAuth } = require('../lib/middleware/supabaseAuth');
const { logger } = require('../shared/logger');

/**
 * Check pending parlay outcomes
 * POST /api/check-parlays
 */
async function checkParlayOutcomes(req, res) {
  try {
    const checker = new ParlayOutcomeChecker();
    const result = await checker.checkAllPendingParlays();
    
    res.json({
      success: true,
      message: `Checked ${result.checked} parlays, updated ${result.updated}`,
      ...result
    });
    
  } catch (error) {
    logger.error('Error checking parlay outcomes:', error);
    res.status(500).json({ 
      error: 'Failed to check parlay outcomes',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

/**
 * Manual parlay outcome override
 * PATCH /api/parlays/:id/outcome
 */
async function manualParlayUpdate(req, res) {
  try {
    const parlayId = req.params.id;
    const { outcome, profit_loss } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!['won', 'lost', 'push'].includes(outcome)) {
      return res.status(400).json({ error: 'Invalid outcome. Must be: won, lost, or push' });
    }

    // Verify user owns this parlay
    const { supabase } = require('../lib/middleware/supabaseAuth');
    const { data: parlay, error: fetchError } = await supabase
      .from('parlays')
      .select('id, user_id, potential_payout')
      .eq('id', parlayId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !parlay) {
      return res.status(404).json({ error: 'Parlay not found' });
    }

    // Calculate profit/loss if not provided
    let calculatedProfitLoss = profit_loss;
    if (calculatedProfitLoss === undefined) {
      if (outcome === 'won') {
        calculatedProfitLoss = (parlay.potential_payout || 0) - 100; // Assuming $100 bet
      } else if (outcome === 'lost') {
        calculatedProfitLoss = -100;
      } else {
        calculatedProfitLoss = 0; // Push
      }
    }

    // Update parlay
    const { error: updateError } = await supabase
      .from('parlays')
      .update({
        status: 'completed',
        final_outcome: outcome,
        profit_loss: calculatedProfitLoss,
        updated_at: new Date().toISOString()
      })
      .eq('id', parlayId);

    if (updateError) throw updateError;

    logger.info(`Manual update: Parlay ${parlayId} marked as ${outcome} by user ${userId}`);

    res.json({
      success: true,
      message: `Parlay marked as ${outcome}`,
      parlayId,
      outcome,
      profitLoss: calculatedProfitLoss
    });

  } catch (error) {
    logger.error('Error with manual parlay update:', error);
    res.status(500).json({ error: 'Failed to update parlay' });
  }
}

/**
 * Get pending parlays for user
 * GET /api/parlays/pending
 */
async function getPendingParlays(req, res) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { supabase } = require('../lib/middleware/supabaseAuth');
    const { data: parlays, error } = await supabase
      .from('parlays')
      .select(`
        *,
        parlay_legs (*)
      `)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Add game status information
    const enrichedParlays = parlays.map(parlay => {
      const gameStatuses = parlay.parlay_legs.map(leg => {
        const gameDate = new Date(leg.game_date);
        const now = new Date();
        const hoursAfterGame = (now.getTime() - gameDate.getTime()) / (1000 * 60 * 60);
        
        return {
          ...leg,
          likely_completed: hoursAfterGame > 4,
          hours_since_game: Math.round(hoursAfterGame)
        };
      });

      return {
        ...parlay,
        parlay_legs: gameStatuses,
        all_games_likely_completed: gameStatuses.every(leg => leg.likely_completed)
      };
    });

    res.json({
      success: true,
      parlays: enrichedParlays
    });

  } catch (error) {
    logger.error('Error fetching pending parlays:', error);
    res.status(500).json({ error: 'Failed to fetch pending parlays' });
  }
}

module.exports = {
  checkParlayOutcomes,
  manualParlayUpdate: [supabaseAuth, manualParlayUpdate],
  getPendingParlays: [supabaseAuth, getPendingParlays]
};