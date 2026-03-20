/**
 * AI Instructions Loader
 * Reads the playbook from ai_instructions table and formats it for AI prompts.
 * Zero API cost — just a DB read cached in memory for 5 minutes.
 */

const { supabase } = require('../middleware/supabaseAuth');

let cachedInstructions = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function loadInstructions() {
  // Return cached if fresh
  if (cachedInstructions && (Date.now() - cacheTimestamp < CACHE_TTL)) {
    return cachedInstructions;
  }

  try {
    const { data, error } = await supabase
      .from('ai_instructions')
      .select('key, category, title, content, priority')
      .eq('active', true)
      .order('priority', { ascending: false });

    if (error) {
      console.warn('Failed to load ai_instructions:', error.message);
      return cachedInstructions || [];
    }

    cachedInstructions = data || [];
    cacheTimestamp = Date.now();
    return cachedInstructions;
  } catch (err) {
    console.warn('ai_instructions load error:', err.message);
    return cachedInstructions || [];
  }
}

/**
 * Get formatted instructions for a specific AI context.
 * @param {string[]} categories - Which categories to include (e.g., ['system', 'rules', 'context'])
 * @param {string[]} keys - Specific keys to include (optional, includes all if empty)
 * @returns {string} Formatted instruction text for injection into system prompt
 */
async function getInstructions(categories = null, keys = null) {
  const all = await loadInstructions();

  let filtered = all;
  if (categories) {
    filtered = filtered.filter(i => categories.includes(i.category));
  }
  if (keys) {
    filtered = filtered.filter(i => keys.includes(i.key));
  }

  if (filtered.length === 0) return '';

  return filtered.map(i => `### ${i.title}\n${i.content}`).join('\n\n');
}

/**
 * Get all instructions as a single system prompt block.
 */
async function getFullPlaybook() {
  return getInstructions(); // All categories, all keys
}

/**
 * Get instructions for a specific generation mode.
 */
async function getForMode(riskLevel) {
  const modeKey = riskLevel === 'Low' ? 'easy_money_rules'
    : riskLevel === 'High' ? 'high_risk_rules'
    : 'medium_risk_rules';

  return getInstructions(null, [
    'core_identity', 'data_sources', 'anti_hallucination',
    'reasoning_format', 'seasonal_context', 'betting_principles',
    'tone_style', modeKey
  ]);
}

/**
 * Get instructions for the chat bot (De-Genny).
 */
async function getForChat() {
  return getInstructions(null, [
    'core_identity', 'data_sources', 'anti_hallucination',
    'reasoning_format', 'seasonal_context', 'betting_principles',
    'tone_style', 'ncaab_specific', 'model_accuracy'
  ]);
}

/**
 * Get instructions for the pre-game analyst.
 */
async function getForPreAnalysis() {
  return getInstructions(null, [
    'data_sources', 'anti_hallucination', 'reasoning_format',
    'seasonal_context', 'betting_principles', 'ncaab_specific'
  ]);
}

/**
 * Get instructions for the fact-checker.
 */
async function getForFactCheck() {
  return getInstructions(null, [
    'data_sources', 'anti_hallucination'
  ]);
}

module.exports = {
  loadInstructions,
  getInstructions,
  getFullPlaybook,
  getForMode,
  getForChat,
  getForPreAnalysis,
  getForFactCheck
};
