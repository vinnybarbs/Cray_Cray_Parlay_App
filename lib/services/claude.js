/**
 * Shared Anthropic client + chat-completion convenience for every LLM call
 * in the app. Replaces the scattered raw fetch() calls to OpenAI's
 * chat/completions endpoint (migrated 2026-07-11).
 *
 * Model split by workload:
 *  - CHAT (claude-sonnet-5): user-facing chat (De-Genny).
 *  - NARRATION (claude-sonnet-5-5): game narration for Play, Strong Play,
 *    Sharp Take and Trap tiles, prop narration, the fact check and the
 *    parlay analyst.
 *  - NARRATION_SMALL (claude-haiku-5-5): game narration for Lean, Leg and
 *    Skip tiles (owner 2026-10-11, build_queue 91). narrationModelForTier()
 *    below is the one place that split lives.
 *  - JUDGMENT (claude-opus-4-8): post-mortem learning analysis, where
 *    getting the lesson right matters more than latency.
 *  - UTILITY (claude-haiku-4-5): mechanical extraction, parsing, and
 *    summarization. Fast and cheap, no thinking.
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const MODELS = {
  CHAT: 'claude-sonnet-5',
  NARRATION: 'claude-sonnet-5-5',
  NARRATION_SMALL: 'claude-haiku-5-5',
  JUDGMENT: 'claude-opus-4-8',
  UTILITY: 'claude-haiku-4-5',
};

// House writing rule for every user-facing word the models produce. Vince
// hates dash-styled AI prose. This used to live as seven hand-copied strings
// across the prompt sites, which drifted and got forgotten on new prompts
// (the article enricher and news summarizer shipped without it). complete()
// injects it automatically at the system level. Raw messages.create call
// sites import it into their prompts instead of keeping their own copy.
const WRITING_STYLE = 'WRITING STYLE: Plain punctuation only. Never use em dashes, en dashes, semicolons, or arrows in your output. Use periods and commas. Never reference your own prior passes, revisions, or what changed since an earlier version of this writeup. Phrases like "updated from the prior pass" or "still X from last time" are internal process and must not appear. Describe the current state as if writing once. Citing real market line movement with actual prices is encouraged, narrating your own editing history is banned.';

// The request param that turns thinking off differs by model. Sonnet 5.5
// rejects { type: 'disabled' } with a 400 and takes { type: 'between_tools' }
// instead (thinking only between tool calls, so none on a plain narration).
// Haiku 4.5 takes no thinking param and runs without. Everything else
// accepts disabled. null means send no thinking param at all.
const THINKING_OFF = {
  'claude-sonnet-5-5': { type: 'between_tools' },
  'claude-haiku-4-5': null,
};

function thinkingOff(model) {
  return Object.prototype.hasOwnProperty.call(THINKING_OFF, model)
    ? THINKING_OFF[model]
    : { type: 'disabled' };
}

// Narration model by the tier the math assigned (owner 2026-10-11,
// build_queue 91): Play and above plus Traps narrate on Sonnet, Lean, Leg
// and Skip tiles on Haiku. An unknown tier narrates on Sonnet.
const SMALL_NARRATION_TIERS = new Set(['Lean', 'Leg', 'Skip']);

function narrationModelForTier(tier) {
  return SMALL_NARRATION_TIERS.has(tier) ? MODELS.NARRATION_SMALL : MODELS.NARRATION;
}

// List rates in dollars per token, for the cost figure each narration run
// logs. Sonnet keeps the 3 and 15 per MTok it has always been logged at
// (the narration ceiling history is measured in it), the Haikus log at
// their own list rates.
const LOG_RATES = {
  'claude-haiku-5-5': { input: 0.10e-6, output: 0.50e-6 },
  'claude-haiku-4-5': { input: 1e-6, output: 5e-6 },
};
const DEFAULT_LOG_RATE = { input: 3e-6, output: 15e-6 };

function estimateCost(model, inputTokens, outputTokens) {
  const r = LOG_RATES[model] || DEFAULT_LOG_RATE;
  return (inputTokens || 0) * r.input + (outputTokens || 0) * r.output;
}

let _client = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 5 * 60 * 1000, // ms, generous for long narration batches
    });
  }
  return _client;
}

/**
 * Robust JSON extraction from model text. Handles markdown fences, leading
 * prose, and both object and array roots. Returns null when nothing parses.
 */
function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through to slicing */ }
  const firstObj = cleaned.indexOf('{');
  const firstArr = cleaned.indexOf('[');
  const useArr = firstArr !== -1 && (firstObj === -1 || firstArr < firstObj);
  const open = useArr ? '[' : '{';
  const close = useArr ? ']' : '}';
  const start = cleaned.indexOf(open);
  const end = cleaned.lastIndexOf(close);
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

/**
 * Chat-completions-shaped convenience: takes OpenAI-style messages (system
 * entries are hoisted into the Anthropic system param), returns the response
 * text, or a parsed object/array when json: true.
 *
 * Thinking stays off for Sonnet/Opus calls: these migrated call sites were
 * tuned for non-thinking models with small max_tokens budgets, and adaptive
 * thinking would eat the output budget. thinkingOff() picks the param each
 * model accepts.
 */
async function complete({ model = MODELS.UTILITY, system, messages = [], maxTokens = 1000, json = false }) {
  const client = getClient();
  if (!client) throw new Error('Server missing ANTHROPIC_API_KEY');

  const systemParts = [WRITING_STYLE, system, ...messages.filter(m => m.role === 'system').map(m => m.content)].filter(Boolean);
  const chatMessages = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.content }));
  if (chatMessages.length === 0) throw new Error('complete() needs at least one user/assistant message');

  const params = {
    model,
    max_tokens: maxTokens,
    messages: chatMessages,
  };
  params.system = systemParts.join('\n\n');
  const thinking = thinkingOff(model);
  if (thinking) params.thinking = thinking;

  const resp = await client.messages.create(params);
  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  if (!json) return text;
  return extractJson(text);
}

module.exports = { MODELS, WRITING_STYLE, getClient, complete, extractJson, thinkingOff, narrationModelForTier, estimateCost };
