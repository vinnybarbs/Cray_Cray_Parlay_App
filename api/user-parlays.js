import { supabase } from '../lib/middleware/supabaseAuth.js';
import logger from '../lib/utils/logger.js';

/**
 * Get user's parlay history
 * GET /api/user/parlays
 */
export async function getUserParlays(req, res) {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const { data, error, count } = await supabase
      .from('parlays')
      .select(`
        *,
        parlay_legs (*)
      `, { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      success: true,
      parlays: data,
      total: count,
      limit,
      offset
    });
  } catch (error) {
    logger.error('Error fetching user parlays', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch parlays' });
  }
}

/**
 * Get user's stats
 * GET /api/user/stats
 */
export async function getUserStats(req, res) {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('parlays')
      .select('final_outcome, profit_loss, total_legs')
      .eq('user_id', userId);

    if (error) throw error;

    const total = data.length;
    const wins = data.filter(p => p.final_outcome === 'win').length;
    const losses = data.filter(p => p.final_outcome === 'loss').length;
    const pending = data.filter(p => !p.final_outcome || p.final_outcome === 'pending').length;
    const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : 0;
    const totalProfit = data.reduce((sum, p) => sum + (parseFloat(p.profit_loss) || 0), 0);
    const avgLegs = total > 0 ? (data.reduce((sum, p) => sum + p.total_legs, 0) / total).toFixed(1) : 0;

    res.json({
      success: true,
      stats: {
        total,
        wins,
        losses,
        pending,
        winRate: parseFloat(winRate),
        totalProfit: parseFloat(totalProfit.toFixed(2)),
        avgLegs: parseFloat(avgLegs)
      }
    });
  } catch (error) {
    logger.error('Error fetching user stats', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
}

/**
 * Get single parlay details
 * GET /api/user/parlays/:id
 */
export async function getParlayById(req, res) {
  try {
    const userId = req.user.id;
    const parlayId = req.params.id;

    const { data, error } = await supabase
      .from('parlays')
      .select(`
        *,
        parlay_legs (*)
      `)
      .eq('id', parlayId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Parlay not found' });
      }
      throw error;
    }

    res.json({
      success: true,
      parlay: data
    });
  } catch (error) {
    logger.error('Error fetching parlay', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch parlay' });
  }
}

/**
 * Update parlay outcome (for manual tracking)
 * PATCH /api/user/parlays/:id
 */
export async function updateParlayOutcome(req, res) {
  try {
    const userId = req.user.id;
    const parlayId = req.params.id;
    const { final_outcome, profit_loss } = req.body;

    // Verify ownership
    const { data: existing } = await supabase
      .from('parlays')
      .select('id')
      .eq('id', parlayId)
      .eq('user_id', userId)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'Parlay not found' });
    }

    const { data, error } = await supabase
      .from('parlays')
      .update({
        final_outcome,
        profit_loss,
        status: final_outcome === 'pending' ? 'pending' : 'completed'
      })
      .eq('id', parlayId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      parlay: data
    });
  } catch (error) {
    logger.error('Error updating parlay', { error: error.message });
    res.status(500).json({ error: 'Failed to update parlay' });
  }
}
